import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GhaymaAuth } from "../../dist/client/index.js";
import {
  APP_SLUG,
  BASE_URL,
  authHeader,
  clearTabs,
  sessionResponse,
  setNavigator,
  sharedStorage,
  stubFetch,
  webLocks,
} from "./helpers.mjs";

// The auth service rotates refresh tokens, and since backend #405 a rotated
// one coming back ends every session of the user. Tabs share one session
// through localStorage, so each token must be spent once across all of them.

const CREDENTIALS = { email: "user@test.local", password: "pw" };
const SESSION_KEY = "espace_auth_session";
const LOCK = "espace_auth_session:lock";

/**
 * The service's rotation: a refresh token is spent once, and one presented
 * again after its rotation is a 403 that ends every session.
 */
function rotatingServer({ expiresIn = 3600, routes = {} } = {}) {
  const live = new Set(["refresh-1"]);
  const spent = new Set();
  const server = { expiresIn, reuse: 0, minted: 1 };
  server.calls = stubFetch({
    "/login": () => sessionResponse("access-1", server.expiresIn),
    "/refresh": ({ body }) => {
      const token = body.refresh_token;
      if (spent.has(token)) {
        server.reuse++;
        live.clear();
        return { status: 403, error: "refresh token reuse detected, all sessions revoked" };
      }
      if (!live.delete(token)) return { status: 401, error: "invalid refresh token" };
      spent.add(token);
      const n = ++server.minted;
      live.add(`refresh-${n}`);
      return {
        access_token: `access-${n}`,
        refresh_token: `refresh-${n}`,
        expires_in: server.expiresIn,
        token_type: "Bearer",
      };
    },
    "/logout": ({ body }) => {
      live.delete(body.refresh_token);
      spent.delete(body.refresh_token);
      return { message: "logged out" };
    },
    ...routes,
  });
  /** The refresh tokens presented, in order. */
  server.presented = () => server.calls.filter((c) => c.path === "/refresh").map((c) => c.body.refresh_token);
  return server;
}

/** A client in its own tab: the session lives in localStorage. */
function tab(config = {}) {
  return new GhaymaAuth({
    appSlug: APP_SLUG,
    baseUrl: BASE_URL,
    storage: "localStorage",
    autoRefresh: false,
    ...config,
  });
}

/** Sign in on one tab, then open more that load the stored session. */
async function signedInTabs(count = 2, config) {
  const first = tab(config);
  await first.login(CREDENTIALS);
  return [first, ...Array.from({ length: count - 1 }, () => tab(config))];
}

/** A client that keeps its session in memory, as on a server. */
function memoryClient() {
  return new GhaymaAuth({ appSlug: APP_SLUG, baseUrl: BASE_URL, autoRefresh: false });
}

/** The auth events a client emits from now on. */
function eventsOf(auth) {
  const events = [];
  auth.onAuthStateChange((event) => events.push(event));
  return events;
}

/** The next auth event a client emits; rejects after `ms`. */
function nextEvent(auth, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("no auth event"));
    }, ms);
    const off = auth.onAuthStateChange((event) => {
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

afterEach(clearTabs);

// ==================== One client ====================

describe("one client", () => {
  test("concurrent refreshes share one request", async () => {
    const server = rotatingServer();
    const auth = memoryClient();
    await auth.login(CREDENTIALS);

    const pairs = await Promise.all([auth.refreshToken(), auth.refreshToken(), auth.refreshToken()]);

    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(server.reuse, 0);
    assert.deepEqual(
      pairs.map((p) => p.refresh_token),
      ["refresh-2", "refresh-2", "refresh-2"]
    );
    assert.equal(auth.getAccessToken(), "access-2");
  });

  test("calls racing an expired token share one refresh", async () => {
    const server = rotatingServer({ expiresIn: 1, routes: { "/me": { user: { id: "u1" } } } });
    const auth = memoryClient();
    await auth.login(CREDENTIALS);
    server.expiresIn = 3600;

    await Promise.all([auth.getUser(), auth.getUser()]);

    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.deepEqual(
      server.calls.filter((c) => c.path === "/me").map(authHeader),
      ["Bearer access-2", "Bearer access-2"]
    );
  });

  test("a memory session takes no cross-tab lock and writes nothing", async () => {
    const names = webLocks();
    const storage = sharedStorage();
    const server = rotatingServer();
    const auth = memoryClient();
    await auth.login(CREDENTIALS);

    await Promise.all([auth.refreshToken(), auth.refreshToken()]);

    assert.deepEqual(names, []);
    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(storage.getItem(SESSION_KEY), null);
  });
});

// ==================== Tabs sharing localStorage ====================

const LOCK_MODES = [
  ["with Web Locks", () => webLocks()],
  ["without Web Locks (storage lease)", () => setNavigator({})],
];

for (const [mode, installLocks] of LOCK_MODES) {
  describe(`tabs sharing localStorage, ${mode}`, () => {
    let storage;
    beforeEach(() => {
      storage = sharedStorage();
      installLocks();
    });

    test("a tab takes over the pair another tab already rotated", async () => {
      const server = rotatingServer();
      const [a, b] = await signedInTabs();
      await a.refreshToken();
      const events = eventsOf(b);

      const pair = await b.refreshToken();

      assert.deepEqual(server.presented(), ["refresh-1"]);
      assert.equal(server.reuse, 0);
      assert.equal(pair.access_token, "access-2");
      assert.equal(pair.refresh_token, "refresh-2");
      assert.equal(pair.token_type, "Bearer");
      assert.ok(pair.expires_in > 3500 && pair.expires_in <= 3600, `got ${pair.expires_in}`);
      assert.equal(b.getAccessToken(), "access-2");
      assert.deepEqual(events, ["TOKEN_REFRESHED"]);
    });

    test("tabs refreshing at once spend the token once", async () => {
      const server = rotatingServer();
      const tabs = await signedInTabs(3);

      const pairs = await Promise.all(tabs.map((t) => t.refreshToken()));

      assert.deepEqual(server.presented(), ["refresh-1"]);
      assert.equal(server.reuse, 0);
      assert.deepEqual(
        pairs.map((p) => p.refresh_token),
        ["refresh-2", "refresh-2", "refresh-2"]
      );
      assert.deepEqual(
        tabs.map((t) => t.getAccessToken()),
        ["access-2", "access-2", "access-2"]
      );
    });

    test("scheduled refreshes firing together spend the token once", async () => {
      // Each tab's timer fires 60 s before the shared expiry: a second from now
      const server = rotatingServer({ expiresIn: 61 });
      const tabs = await signedInTabs(2, { autoRefresh: true });
      server.expiresIn = 60; // the new pair arms no further timer

      const events = await Promise.all(tabs.map((t) => nextEvent(t)));

      assert.deepEqual(events, ["TOKEN_REFRESHED", "TOKEN_REFRESHED"]);
      assert.deepEqual(server.presented(), ["refresh-1"]);
      assert.equal(server.reuse, 0);
      assert.deepEqual(
        tabs.map((t) => t.getAccessToken()),
        ["access-2", "access-2"]
      );
    });

    test("a session another tab signed out ends here without a request", async () => {
      const server = rotatingServer();
      const [a, b] = await signedInTabs();
      await a.logout();
      const events = eventsOf(b);

      await assert.rejects(b.refreshToken(), /No refresh token available/);

      assert.deepEqual(server.presented(), []);
      assert.equal(b.isAuthenticated(), false);
      assert.deepEqual(events, ["SIGNED_OUT"]);
    });

    test("a taken-over pair that is about to expire is refreshed with the newest token", async () => {
      const server = rotatingServer();
      const [a, b] = await signedInTabs();
      server.expiresIn = 10; // inside the 30 s expiry buffer
      await a.refreshToken();
      server.expiresIn = 3600;

      await b.refreshToken();
      await a.refreshToken();

      assert.deepEqual(server.presented(), ["refresh-1", "refresh-2"]);
      assert.equal(server.reuse, 0);
      assert.equal(a.getAccessToken(), "access-3");
      assert.equal(b.getAccessToken(), "access-3");
    });

    test("logout revokes the newest token, not this tab's copy", async () => {
      const server = rotatingServer();
      const [a, b] = await signedInTabs();
      await a.refreshToken();

      await b.logout();

      assert.deepEqual(
        server.calls.filter((c) => c.path === "/logout").map((c) => c.body.refresh_token),
        ["refresh-2"]
      );
      assert.equal(storage.getItem(SESSION_KEY), null);
    });

    test("a pair that could not be stored is not left for another tab to spend", async () => {
      const server = rotatingServer();
      const [a, b] = await signedInTabs();
      storage.failWrites = true; // quota exceeded from here on
      await a.refreshToken();

      await assert.rejects(b.refreshToken(), /No refresh token available/);
      await a.refreshToken();

      assert.deepEqual(server.presented(), ["refresh-1", "refresh-2"]);
      assert.equal(server.reuse, 0);
      assert.equal(a.getAccessToken(), "access-3");
    });

    test("a store that refuses every write still refreshes", async () => {
      storage.failWrites = true; // as in a legacy private window
      const server = rotatingServer();
      const auth = tab();
      await auth.login(CREDENTIALS);

      await auth.refreshToken();
      await auth.refreshToken();

      assert.deepEqual(server.presented(), ["refresh-1", "refresh-2"]);
      assert.equal(auth.getAccessToken(), "access-3");
    });
  });
}

// ==================== Lock mechanics ====================

describe("Web Locks", () => {
  test("the lock is named after the storage key, and no lease is written", async () => {
    const storage = sharedStorage();
    const names = webLocks();
    const server = rotatingServer();
    const [auth] = await signedInTabs(1);
    const fetch = globalThis.fetch;
    let lease = "unread";
    globalThis.fetch = (url, init) => {
      lease = storage.getItem(LOCK);
      return fetch(url, init);
    };

    await auth.refreshToken();

    assert.deepEqual(names, [LOCK]);
    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(lease, null);
  });
});

describe("storage lease (no Web Locks)", () => {
  let storage;
  beforeEach(() => {
    storage = sharedStorage();
    setNavigator({});
  });

  test("is held under the lock key while the token is spent, then released", async () => {
    const server = rotatingServer();
    const [auth] = await signedInTabs(1);
    const fetch = globalThis.fetch;
    let lease;
    globalThis.fetch = (url, init) => {
      lease = JSON.parse(storage.getItem(LOCK));
      return fetch(url, init);
    };

    await auth.refreshToken();

    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(typeof lease.id, "string");
    assert.ok(lease.until > Date.now(), "the lease was live during the request");
    assert.equal(storage.getItem(LOCK), null);
  });

  for (const [left, until] of [
    ["an expired lease left by a closed tab", () => Date.now() - 1],
    ["a lease too far out to be live (clock moved back)", () => Date.now() + 3_600_000],
  ]) {
    test(`${left} does not hold the refresh up`, async () => {
      const server = rotatingServer();
      const [auth] = await signedInTabs(1);
      storage.setItem(LOCK, JSON.stringify({ id: "gone", until: until() }));
      const started = Date.now();

      await auth.refreshToken();

      assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
      assert.deepEqual(server.presented(), ["refresh-1"]);
      assert.equal(storage.getItem(LOCK), null);
    });
  }

  test("a live lease is waited out, then the pair it produced taken over", async () => {
    const server = rotatingServer();
    const [auth] = await signedInTabs(1);
    storage.setItem(LOCK, JSON.stringify({ id: "other-tab", until: Date.now() + 20_000 }));
    const started = Date.now();

    const pending = auth.refreshToken();
    // The other tab lands its rotation and lets go
    setTimeout(() => {
      storage.setItem(
        SESSION_KEY,
        JSON.stringify({ accessToken: "access-9", refreshToken: "refresh-9", expiresAt: Date.now() + 3_600_000 })
      );
      storage.removeItem(LOCK);
    }, 50);
    const pair = await pending;

    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
    assert.deepEqual(server.presented(), []);
    assert.equal(pair.refresh_token, "refresh-9");
    assert.equal(auth.getAccessToken(), "access-9");
  });
});

// ==================== Runtimes without a usable localStorage ====================

describe("runtimes without a usable localStorage", () => {
  test("a localStorage getter that throws (Node 26 without --localstorage-file) falls back to memory", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Cannot initialize local storage without a `--localstorage-file` path", "SecurityError");
      },
    });
    const server = rotatingServer();
    const auth = tab();
    await auth.login(CREDENTIALS);

    await auth.refreshToken();

    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(auth.getAccessToken(), "access-2");
  });

  test("no navigator and no localStorage: refresh works in memory", async () => {
    setNavigator(undefined);
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true, writable: true });
    const server = rotatingServer();
    const auth = tab();
    await auth.login(CREDENTIALS);

    await Promise.all([auth.refreshToken(), auth.refreshToken()]);

    assert.deepEqual(server.presented(), ["refresh-1"]);
    assert.equal(auth.getAccessToken(), "access-2");
  });
});
