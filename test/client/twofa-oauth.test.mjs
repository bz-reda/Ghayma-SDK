import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GhaymaAuth, AuthError, TwoFactorRequiredError, PKCE_STORAGE_KEY } from "../../dist/client/index.js";
import { APP_SLUG, BASE_URL, clearBrowser, fakeBrowser, sessionResponse, stubFetch } from "./helpers.mjs";

// OAuth sign-in asks the app's second factor the way POST /login does: the
// service answers a pending step instead of a session (the TwoFARequired and
// TwoFAEnrollmentRequired bodies of auth.v1.yaml). The SDK throws it and
// stores nothing.

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const CHALLENGE = { two_fa_required: true, challenge_token: "ch-1", methods: ["totp"], phone_hint: "" };
const ENROLMENT = { two_fa_enrollment_required: true, enroll_token: "en-1", methods: ["totp"] };

// The implicit redirect's fragment forms; they never carry the phone hint.
const CHALLENGE_FRAGMENT = "#two_fa_required=true&challenge_token=ch-1&methods=totp";
const ENROLMENT_FRAGMENT = "#two_fa_enrollment_required=true&enroll_token=en-1&methods=totp";

/** A client and the auth events it emits. */
function watched() {
  const auth = new GhaymaAuth({ appSlug: APP_SLUG, baseUrl: BASE_URL, autoRefresh: false });
  const events = [];
  auth.onAuthStateChange((e) => events.push(e));
  return { auth, events };
}

/** Validator for a TwoFactorRequiredError carrying `result` under `code`. */
function pending(code, result) {
  return (err) => {
    assert.ok(err instanceof TwoFactorRequiredError);
    assert.ok(err instanceof AuthError);
    assert.equal(err.name, "TwoFactorRequiredError");
    assert.equal(err.code, code);
    assert.equal(err.status, 200);
    assert.deepEqual(err.result, result);
    return true;
  };
}

function assertNoSession(auth, events) {
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(auth.getAccessToken(), null);
  assert.deepEqual(events, []);
}

afterEach(clearBrowser);

describe("exchangeCodeForSession and a second factor", () => {
  test("a challenge rejects with two_fa_required and stores no session", async () => {
    stubFetch({ "/oauth/exchange": CHALLENGE });
    const { auth, events } = watched();

    await assert.rejects(
      auth.exchangeCodeForSession({ code: "c1", codeVerifier: VERIFIER }),
      pending("two_fa_required", CHALLENGE)
    );
    assertNoSession(auth, events);
  });

  test("an enrolment rejects with two_fa_enrollment_required and stores no session", async () => {
    stubFetch({ "/oauth/exchange": ENROLMENT });
    const { auth, events } = watched();

    await assert.rejects(
      auth.exchangeCodeForSession({ code: "c1", codeVerifier: VERIFIER }),
      pending("two_fa_enrollment_required", ENROLMENT)
    );
    assertNoSession(auth, events);
  });

  test("a session is still stored", async () => {
    stubFetch({ "/oauth/exchange": sessionResponse("access-x") });
    const { auth, events } = watched();

    const session = await auth.exchangeCodeForSession({ code: "c1", codeVerifier: VERIFIER });

    assert.equal(session.access_token, "access-x");
    assert.equal(auth.getAccessToken(), "access-x");
    assert.deepEqual(events, ["SIGNED_IN"]);
  });
});

describe("signInWithIdToken and a second factor", () => {
  test("a challenge rejects with two_fa_required and stores no session", async () => {
    stubFetch({ "/oauth/id-token": CHALLENGE });
    const { auth, events } = watched();

    await assert.rejects(
      auth.signInWithIdToken({ provider: "google", idToken: "eyJ.x.y" }),
      pending("two_fa_required", CHALLENGE)
    );
    assertNoSession(auth, events);
  });

  test("an enrolment rejects with two_fa_enrollment_required and stores no session", async () => {
    stubFetch({ "/oauth/id-token": ENROLMENT });
    const { auth, events } = watched();

    await assert.rejects(
      auth.signInWithIdToken({ provider: "google", idToken: "eyJ.x.y" }),
      pending("two_fa_enrollment_required", ENROLMENT)
    );
    assertNoSession(auth, events);
  });

  test("a session is still stored", async () => {
    stubFetch({ "/oauth/id-token": sessionResponse("access-n") });
    const { auth, events } = watched();

    const session = await auth.signInWithIdToken({ provider: "google", idToken: "eyJ.x.y" });

    assert.equal(session.access_token, "access-n");
    assert.equal(auth.getAccessToken(), "access-n");
    assert.deepEqual(events, ["SIGNED_IN"]);
  });
});

describe("handleOAuthFragment and a second factor", () => {
  test("a challenge throws, clears the fragment and stores no session", () => {
    fakeBrowser({ search: "?x=1", hash: CHALLENGE_FRAGMENT });
    const { auth, events } = watched();

    assert.throws(
      () => auth.handleOAuthFragment(),
      pending("two_fa_required", { two_fa_required: true, challenge_token: "ch-1", methods: ["totp"] })
    );
    assert.equal(globalThis.history.url, "/cb?x=1");
    assertNoSession(auth, events);
  });

  test("an enrolment throws two_fa_enrollment_required and clears the fragment", () => {
    fakeBrowser({ hash: ENROLMENT_FRAGMENT });
    const { auth, events } = watched();

    assert.throws(
      () => auth.handleOAuthFragment(),
      pending("two_fa_enrollment_required", ENROLMENT)
    );
    assert.equal(globalThis.history.url, "/cb");
    assertNoSession(auth, events);
  });

  test("methods are URL-decoded and split on commas, empty entries dropped", () => {
    fakeBrowser({ hash: "#two_fa_required=true&challenge_token=ch-1&methods=totp%2C%2Cwhatsapp%2C" });

    assert.throws(
      () => watched().auth.handleOAuthFragment(),
      (err) => {
        assert.deepEqual(err.result.methods, ["totp", "whatsapp"]);
        return true;
      }
    );
  });

  test("tokens still sign in and clear the fragment", () => {
    fakeBrowser({ hash: "#access_token=access-f&refresh_token=refresh-f&expires_in=900" });
    const { auth, events } = watched();

    assert.equal(auth.handleOAuthFragment(), true);
    assert.equal(auth.getAccessToken(), "access-f");
    assert.deepEqual(events, ["SIGNED_IN"]);
    assert.equal(globalThis.history.url, "/cb");
  });

  test("neither tokens nor a pending step still returns false", () => {
    fakeBrowser({ hash: "#state=abc" });
    const { auth, events } = watched();

    assert.equal(auth.handleOAuthFragment(), false);
    assert.equal(globalThis.history.url, null);
    assertNoSession(auth, events);
  });
});

describe("handleOAuthRedirect and a second factor", () => {
  test("pkce: a challenge rejects and leaves neither verifier nor code behind", async () => {
    const store = fakeBrowser({ search: "?code=c1&next=%2Fhome" });
    store.set(PKCE_STORAGE_KEY, VERIFIER);
    const calls = stubFetch({ "/oauth/exchange": CHALLENGE });
    const { auth, events } = watched();

    await assert.rejects(auth.handleOAuthRedirect(), pending("two_fa_required", CHALLENGE));

    assert.deepEqual(calls[0].body, { code: "c1", code_verifier: VERIFIER });
    assert.equal(store.has(PKCE_STORAGE_KEY), false);
    assert.equal(globalThis.history.url, "/cb?next=%2Fhome");
    assertNoSession(auth, events);

    // A re-run (refresh, StrictMode) must not throw over the 2FA prompt
    assert.equal(await auth.handleOAuthRedirect(), false);
    assert.equal(calls.length, 1);
  });

  test("pkce: a failed exchange drops the verifier and the code too", async () => {
    const store = fakeBrowser({ search: "?code=c1" });
    store.set(PKCE_STORAGE_KEY, VERIFIER);
    stubFetch({ "/oauth/exchange": { status: 400, error: "invalid or expired code", code: "invalid_grant" } });

    await assert.rejects(
      watched().auth.handleOAuthRedirect(),
      (err) => err instanceof AuthError && err.code === "invalid_grant"
    );
    assert.equal(store.has(PKCE_STORAGE_KEY), false);
    assert.equal(globalThis.history.url, "/cb");
  });

  test("implicit: a challenge fragment rejects and is cleared", async () => {
    fakeBrowser({ hash: CHALLENGE_FRAGMENT });
    const { auth, events } = watched();

    await assert.rejects(
      auth.handleOAuthRedirect(),
      pending("two_fa_required", { two_fa_required: true, challenge_token: "ch-1", methods: ["totp"] })
    );
    assert.equal(globalThis.history.url, "/cb");
    assertNoSession(auth, events);
  });
});
