/**
 * Wire-contract tests. Every case here pins something the published
 * 0.4.0 got wrong: a request field the backend requires, a query
 * parameter it reads under another name, or a response shape it returns
 * under a different wrapper.
 *
 * Runs against the built dist/ so it verifies the artifact that ships.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Ghayma, GhaymaError } from "../dist/index.js";
import {
  AUTH_APP,
  AUTH_STATS,
  AUTH_USER,
  BUCKET,
  BUCKET_CREDENTIALS,
  DATABASE,
  DATABASE_METRICS,
  NO_SHARED_CREDENTIAL,
  VALKEY_DATABASE,
  VALKEY_DATABASE_ERROR,
  VALKEY_METRICS,
  VALKEY_SITE_CREDENTIALS,
} from "./fixtures.mjs";

/** Stub globalThis.fetch with a fixed response; returns the recorded calls. */
function stubFetch(body, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

const client = () => new Ghayma({ apiKey: "gsk_test", maxRetries: 0 });

const sentBody = (call) => JSON.parse(call.init.body);

// ── Requests the backend requires ──────────────────────────────

test("auth.listUsers sends per_page, the parameter the handler reads", async () => {
  const calls = stubFetch({ users: [AUTH_USER], total: 1, page: 2, per_page: 50 });

  const res = await client().auth.listUsers("app-1", { page: 2, per_page: 50 });

  assert.equal(calls[0].url.searchParams.get("per_page"), "50");
  assert.equal(calls[0].url.searchParams.get("page"), "2");
  assert.equal(calls[0].url.searchParams.has("limit"), false);
  assert.equal(res.per_page, 50);
});

// ── Responses the backend actually returns ─────────────────────

test("storage.getCredentials returns the backend's key names", async () => {
  stubFetch({ credentials: BUCKET_CREDENTIALS });

  const creds = await client().storage.getCredentials("bucket-1");

  assert.equal(creds.access_key, BUCKET_CREDENTIALS.access_key);
  assert.equal(creds.secret_key, BUCKET_CREDENTIALS.secret_key);
  assert.equal(creds.bucket, BUCKET_CREDENTIALS.bucket);
  assert.deepEqual(Object.keys(creds).sort(), Object.keys(BUCKET_CREDENTIALS).sort());
});

test("storage.upload returns the key the backend echoes back", async () => {
  stubFetch({ message: "uploaded", key: "images/photo.jpg" });

  const res = await client().storage.upload(
    "bucket-1",
    "images/photo.jpg",
    new Blob(["x"]),
  );

  assert.equal(res.key, "images/photo.jpg");
});

test("storage.getBucket surfaces the real usage/limit fields", async () => {
  stubFetch({ bucket: BUCKET });

  const bucket = await client().storage.getBucket("bucket-1");

  assert.equal(bucket.storage_used_bytes, BUCKET.storage_used_bytes);
  assert.equal(bucket.storage_limit_bytes, BUCKET.storage_limit_bytes);
  assert.equal(bucket.status, "active");
});

test("database.get surfaces type + tier fields, not the invented ones", async () => {
  stubFetch({ database: DATABASE });

  const db = await client().database.get("db-1");

  assert.equal(db.type, "postgres");
  assert.equal(db.storage_used_bytes, DATABASE.storage_used_bytes);
  assert.equal(db.external_access, false);
  assert.equal(db.tier_slug, "xs");
  assert.equal(db.disk_gb, 1);
  assert.equal(db.backup_tier_slug, "weekly");
});

test("database.getMetrics reads the { metrics } wrapper", async () => {
  stubFetch({ metrics: DATABASE_METRICS });

  const metrics = await client().database.getMetrics("db-1");

  assert.equal(metrics.active_connections, 3);
  assert.equal(metrics.size_readable, "12.0 MB");
  assert.equal(metrics.status, "running");
});

// ── Valkey ─────────────────────────────────────────────────────

test("database.get surfaces a Valkey's type and mode", async () => {
  stubFetch({ database: VALKEY_DATABASE });

  const db = await client().database.get("db-vk");

  assert.equal(db.type, "valkey");
  assert.equal(db.valkey_mode, "cache");
  assert.equal(db.port, 6379);
  assert.equal(db.status_message, undefined);
});

test("database.get surfaces why a Valkey is in error", async () => {
  stubFetch({ database: VALKEY_DATABASE_ERROR });

  const db = await client().database.get("db-vk");

  assert.equal(db.status, "error");
  assert.equal(db.valkey_mode, "store");
  assert.equal(db.status_message, VALKEY_DATABASE_ERROR.status_message);
});

test("database.list keeps every engine", async () => {
  stubFetch({ databases: [DATABASE, VALKEY_DATABASE] });

  const dbs = await client().database.list();

  assert.deepEqual(dbs.map((d) => d.type), ["postgres", "valkey"]);
});

test("database.getMetrics passes a Valkey's counters through", async () => {
  stubFetch({ metrics: VALKEY_METRICS });

  const metrics = await client().database.getMetrics("db-vk");

  assert.deepEqual(metrics.extra, VALKEY_METRICS.extra);
  assert.equal(metrics.max_connections, undefined);
});

test("database.getConnection with a site key returns the site's own Valkey URL", async () => {
  const calls = stubFetch(VALKEY_SITE_CREDENTIALS);

  const conn = await client().database.getConnection("db-vk");

  assert.equal(calls[0].url.pathname, "/api/v1/databases/db-vk/credentials");
  assert.equal(conn.url, VALKEY_SITE_CREDENTIALS.internal_url);
  assert.match(conn.url, /^redis:\/\/c_9a8b7c6d:/);
  assert.equal(conn.host, VALKEY_DATABASE.host);
  assert.equal(conn.port, 6379);
  assert.equal(conn.username, "c_9a8b7c6d");
  assert.equal(conn.database, "");
});

test("database.getCredentials on a Valkey without a site key throws no_shared_credential", async () => {
  stubFetch(NO_SHARED_CREDENTIAL, 409);

  await assert.rejects(client().database.getCredentials("db-vk"), (err) => {
    assert.ok(err instanceof GhaymaError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "no_shared_credential");
    assert.equal(err.message, NO_SHARED_CREDENTIAL.error);
    return true;
  });
});

test("auth.getStats reads the { stats } wrapper", async () => {
  stubFetch({ stats: AUTH_STATS });

  const stats = await client().auth.getStats("app-1");

  assert.equal(stats.total_users, 12);
  assert.ok(Array.isArray(stats.provider_breakdown));
  assert.deepEqual(stats.provider_breakdown[0], { provider: "email", count: 10 });
});

test("auth.getApp surfaces app_id and the flat oauth flags", async () => {
  stubFetch({ auth_app: AUTH_APP });

  const app = await client().auth.getApp("app-1");

  assert.equal(app.app_id, "my-app");
  assert.equal(app.google_oauth_enabled, true);
  assert.equal(app.jwt_expiry_seconds, 900);
});

test("auth.listUsers surfaces email_verified and last_login_at", async () => {
  stubFetch({ users: [AUTH_USER], total: 1, page: 1, per_page: 20 });

  const { users } = await client().auth.listUsers("app-1");

  assert.equal(users[0].email_verified, true);
  assert.equal(users[0].last_login_at, AUTH_USER.last_login_at);
});

// ── Credentials ────────────────────────────────────────────────

test("apiKey is sent as the bearer credential", async () => {
  const calls = stubFetch({ buckets: [] });
  await new Ghayma({ apiKey: "gsk_test", maxRetries: 0 }).storage.listBuckets();
  assert.equal(calls[0].init.headers.Authorization, "Bearer gsk_test");
});

test("zero-argument init reads GHAYMA_API_KEY", async () => {
  process.env.GHAYMA_API_KEY = "gsk_env";
  try {
    const calls = stubFetch({ buckets: [] });
    await new Ghayma().storage.listBuckets();
    assert.equal(calls[0].init.headers.Authorization, "Bearer gsk_env");
  } finally {
    delete process.env.GHAYMA_API_KEY;
  }
});

test("missing credential throws a message that points at project keys", () => {
  delete process.env.GHAYMA_API_KEY;
  assert.throws(() => new Ghayma(), /Project → Settings → API keys|GHAYMA_API_KEY/);
});

test("an account token still works but warns once", async () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const calls = stubFetch({ buckets: [] });
    const c = new Ghayma({ apiToken: "gh_old", maxRetries: 0 });
    await c.storage.listBuckets();
    await c.storage.listBuckets();
    assert.equal(calls[0].init.headers.Authorization, "Bearer gh_old");
    assert.equal(warnings.filter((w) => w.includes("account token")).length, 1);
  } finally {
    console.warn = orig;
  }
});

// ── Base URL ───────────────────────────────────────────────────

const INTERNAL = "https://api.internal.test";
const LEGACY = "https://legacy.internal.test";

/** Origin a client sends to with `env` set; ESPACE_API_URL is the legacy name. */
async function requestOrigin(env, config = {}) {
  const names = ["GHAYMA_API_URL", "ESPACE_API_URL"];
  for (const name of names) delete process.env[name];
  Object.assign(process.env, env);
  try {
    const calls = stubFetch({ buckets: [] });
    await new Ghayma({ apiKey: "gsk_test", maxRetries: 0, ...config }).storage.listBuckets();
    return calls[0].url.origin;
  } finally {
    for (const name of names) delete process.env[name];
  }
}

test("without a base URL variable the default is used", async () => {
  assert.equal(await requestOrigin({}), "https://api.ghayma.tech");
});

test("GHAYMA_API_URL overrides the default base URL", async () => {
  assert.equal(await requestOrigin({ GHAYMA_API_URL: INTERNAL }), INTERNAL);
});

test("GHAYMA_API_URL beats the legacy variable", async () => {
  assert.equal(await requestOrigin({ GHAYMA_API_URL: INTERNAL, ESPACE_API_URL: LEGACY }), INTERNAL);
});

test("the legacy variable is still read as a fallback", async () => {
  assert.equal(await requestOrigin({ ESPACE_API_URL: LEGACY }), LEGACY);
});

test("an empty GHAYMA_API_URL does not hide the legacy variable", async () => {
  assert.equal(await requestOrigin({ GHAYMA_API_URL: "", ESPACE_API_URL: LEGACY }), LEGACY);
});

test("an explicit baseUrl beats both variables", async () => {
  const origin = await requestOrigin(
    { GHAYMA_API_URL: INTERNAL, ESPACE_API_URL: LEGACY },
    { baseUrl: "https://explicit.test" }
  );
  assert.equal(origin, "https://explicit.test");
});
