// Test helpers — stub `fetch` and record what the SDK actually sends.
// Tests import the BUILT output (dist/) so they verify the shipped artifact.

const BASE_URL = "https://auth.test.local";
const APP_SLUG = "testapp";

/**
 * Replace global fetch with a recorder. `routes` maps a path suffix
 * (e.g. "/2fa/disable") to a response body or a function returning one.
 * A route may set `status` and `__headers` (extra response headers, e.g.
 * `Retry-After`); everything else is the JSON body. Pass `slug` when the
 * client under test uses an app slug other than the default.
 * Returns the array of recorded requests.
 */
export function stubFetch(routes, slug = APP_SLUG) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(`/v1/${slug}`, "");
    const call = {
      url,
      path,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const route = routes[path];
    if (route === undefined) {
      throw new Error(`unexpected request to ${path}`);
    }
    const { status = 200, __headers, ...body } =
      typeof route === "function" ? route(call) : route;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...__headers },
    });
  };
  return calls;
}

/** Authorization header of a recorded request (undefined when absent). */
export function authHeader(call) {
  return call.headers["Authorization"];
}

/** A login response that establishes a session. */
export function sessionResponse(accessToken = "access-1", expiresIn = 3600) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-1",
    expires_in: expiresIn,
    token_type: "Bearer",
    user: { id: "u1", email: "user@test.local" },
  };
}

// The client entry never imports node:, so a browser is simulated with the
// three globals its OAuth helpers touch: location, sessionStorage and history.

/** Install fake browser globals; returns the sessionStorage backing map. */
export function fakeBrowser({ search = "", hash = "" } = {}) {
  const store = new Map();
  globalThis.location = {
    pathname: "/cb",
    search,
    hash,
    assigned: null,
    assign(url) {
      this.assigned = url;
    },
  };
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  globalThis.history = {
    url: null,
    // Like a browser: the new URL replaces the location's path, query and fragment
    replaceState(_state, _title, url) {
      this.url = url;
      const next = new URL(url, "https://app.test");
      globalThis.location.pathname = next.pathname;
      globalThis.location.search = next.search;
      globalThis.location.hash = next.hash;
    },
  };
  return store;
}

/** Remove what fakeBrowser installed. */
export function clearBrowser() {
  delete globalThis.location;
  delete globalThis.sessionStorage;
  delete globalThis.history;
}

// Tabs of one origin share localStorage and Web Locks. A test simulates them
// with several clients over one fake store in this one process. Newer Node
// releases define some of these globals themselves, so they are saved here
// and put back by clearTabs.

const TAB_GLOBALS = ["localStorage", "navigator", "addEventListener", "removeEventListener"];
const originalGlobals = new Map(
  TAB_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
);

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/**
 * Install a localStorage shared by every client, delivering `storage` events
 * the way a browser does to the other tabs. Setting `failWrites` makes
 * setItem throw, like a full quota.
 */
export function sharedStorage() {
  const map = new Map();
  const listeners = new Set();
  const notify = (key) => setTimeout(() => listeners.forEach((listener) => listener({ key })));
  const storage = {
    failWrites: false,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      if (storage.failWrites) throw new DOMException("quota exceeded", "QuotaExceededError");
      map.set(key, String(value));
      notify(key);
    },
    removeItem(key) {
      map.delete(key);
      notify(key);
    },
  };
  setGlobal("localStorage", storage);
  setGlobal("addEventListener", (type, listener) => type === "storage" && listeners.add(listener));
  setGlobal("removeEventListener", (type, listener) => type === "storage" && listeners.delete(listener));
  return storage;
}

/** Replace `navigator`; `{}` is a browser without Web Locks. */
export function setNavigator(value) {
  setGlobal("navigator", value);
}

/** Install a Web Locks stand-in granting each name in turn; returns the names requested. */
export function webLocks() {
  const names = [];
  const tails = new Map();
  setNavigator({
    locks: {
      request(name, callback) {
        names.push(name);
        const granted = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: "exclusive" }));
        tails.set(name, granted.catch(() => {}));
        return granted;
      },
    },
  });
  return names;
}

/** Put back the globals sharedStorage, setNavigator and webLocks replaced. */
export function clearTabs() {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

export { BASE_URL, APP_SLUG };
