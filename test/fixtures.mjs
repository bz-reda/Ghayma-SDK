/**
 * Response payloads transcribed from the backend Go structs they are
 * cited against. Keep these in sync with paas-api — they are the
 * definition of "what the wire actually looks like" for both the
 * runtime tests and the type-level pin in test/types.contract.ts.
 *
 * Fields tagged `omitempty` in Go are omitted here when blank, exactly
 * as the backend omits them.
 */

/** paas-api internal/authapps/models.go — AuthApp */
export const AUTH_APP = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  project_id: "33333333-3333-3333-3333-333333333333",
  name: "My App Auth",
  app_id: "my-app",
  jwt_expiry_seconds: 900,
  refresh_expiry_seconds: 604800,
  allowed_origins: ["https://example.com"],
  email_verification_required: false,
  google_oauth_enabled: true,
  github_oauth_enabled: false,
  auth_tier_slug: "1k",
  two_fa_enabled: false,
  sms_enabled: false,
  reset_url: "",
  email_locale: "en",
  two_fa_policy: "disabled",
  status: "active",
  created_at: "2026-07-31T10:00:00Z",
  updated_at: "2026-07-31T10:00:00Z",
};

/** paas-api internal/authapps/models.go — AuthUser */
export const AUTH_USER = {
  id: "44444444-4444-4444-4444-444444444444",
  app_id: "11111111-1111-1111-1111-111111111111",
  email: "user@example.com",
  name: "Jane",
  email_verified: true,
  provider: "email",
  disabled: false,
  app_metadata: { roles: ["admin"] },
  phone_verified: false,
  totp_enabled: false,
  whatsapp_otp_enabled: false,
  last_login_at: "2026-07-31T09:00:00Z",
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-31T09:00:00Z",
};

/** paas-api internal/authapps/service.go — GetStats return map */
export const AUTH_STATS = {
  total_users: 12,
  verified_users: 9,
  active_sessions: 3,
  signups_today: 1,
  signups_week: 4,
  signups_month: 12,
  events_today: 20,
  events_week: 88,
  logins_today: 0,
  provider_breakdown: [
    { provider: "email", count: 10 },
    { provider: "google", count: 2 },
  ],
  recent_events: [
    {
      id: "55555555-5555-5555-5555-555555555555",
      app_id: "11111111-1111-1111-1111-111111111111",
      user_id: "44444444-4444-4444-4444-444444444444",
      event: "login",
      ip: "10.0.0.1",
      user_agent: "curl/8.0",
      success: true,
      created_at: "2026-07-31T09:00:00Z",
    },
  ],
};

/** paas-api 856337f internal/databases/model.go + response.go — ManagedDatabaseAPIResponse (no username, no external_*) */
export const DATABASE = {
  id: "66666666-6666-6666-6666-666666666666",
  user_id: "22222222-2222-2222-2222-222222222222",
  project_id: "33333333-3333-3333-3333-333333333333",
  name: "my-postgres",
  type: "postgres",
  version: "16",
  status: "running",
  host: "my-postgres.databases.svc.cluster.local",
  port: 5432,
  db_name: "app",
  storage_mb: 1024,
  storage_used_bytes: 12582912,
  cpu_milli: 250,
  memory_mb: 512,
  max_connections: 25,
  disk_gb: 1,
  backup_tier_slug: "weekly",
  replica_set: false,
  cpu_request: "50m",
  cpu_limit: "250m",
  memory_request: "128Mi",
  memory_limit: "512Mi",
  tier_slug: "xs",
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-31T10:00:00Z",
};

/** paas-api internal/databases/explorer.go — DatabaseMetrics */
export const DATABASE_METRICS = {
  status: "running",
  uptime_hours: 72.5,
  size_bytes: 12582912,
  size_readable: "12.0 MB",
  active_connections: 3,
  max_connections: 25,
  extra: {
    table_count: 8,
    total_rows: 1420,
    cache_hit_ratio: "99.2%",
    index_usage_ratio: "87.4%",
    dead_tuples: 12,
  },
};

/** paas-api 856337f internal/databases/model.go + valkey_provision.go — a Valkey row */
export const VALKEY_DATABASE = {
  id: "77777777-7777-7777-7777-777777777777",
  user_id: "22222222-2222-2222-2222-222222222222",
  project_id: "33333333-3333-3333-3333-333333333333",
  name: "cache",
  type: "valkey",
  version: "9.1",
  status: "running",
  host: "vk-cache-77777777.pdb-33333333-3333-3333-3333-333333333333.svc.cluster.local",
  port: 6379,
  storage_mb: 1024,
  storage_used_bytes: 0,
  cpu_milli: 250,
  memory_mb: 256,
  disk_gb: 1,
  backup_tier_slug: "weekly",
  replica_set: false,
  valkey_mode: "cache",
  cpu_request: "50m",
  cpu_limit: "250m",
  memory_request: "128Mi",
  memory_limit: "256Mi",
  tier_slug: "s",
  created_at: "2026-10-08T09:00:00Z",
  updated_at: "2026-10-08T09:00:00Z",
};

/** paas-api 787d352 internal/databases/valkey_start.go — a Valkey that never became ready */
export const VALKEY_DATABASE_ERROR = {
  ...VALKEY_DATABASE,
  status: "error",
  valkey_mode: "store",
  status_message: "the database did not become ready within 10 minutes",
};

/** paas-api 787d352 internal/databases/explorer.go — Metrics on a database that is not running */
export const DATABASE_METRICS_RESIZING = {
  status: "resizing",
  size_bytes: 0,
  size_readable: "",
  active_connections: 0,
};

/** paas-api 787d352 internal/databases/explorer.go — valkeyMetrics */
export const VALKEY_METRICS = {
  status: "running",
  size_bytes: 2048,
  size_readable: "2.0 KB",
  active_connections: 2,
  extra: {
    keys: 42,
    maxmemory_bytes: 187904819,
    evicted_keys: 0,
    keyspace_hits: 310,
    keyspace_misses: 7,
    mode: "cache",
  },
};

/** paas-api 856337f internal/databases/handler.go — siteCredentialBody, a Valkey site key */
export const VALKEY_SITE_CREDENTIALS = {
  type: "valkey",
  host: VALKEY_DATABASE.host,
  port: 6379,
  username: "c_9a8b7c6d",
  password: "s1te-pw",
  database: "",
  internal_url: `redis://c_9a8b7c6d:s1te-pw@${VALKEY_DATABASE.host}:6379/0`,
  level: "connect",
  credential: "connection",
};

/** paas-api 856337f internal/databases/handler.go — siteCredentialBody, a Postgres site key */
export const DATABASE_CREDENTIALS_SITE_KEY = {
  type: "postgres",
  host: DATABASE.host,
  port: 5432,
  username: "c_3f1a2b3c",
  password: "s1te-pw",
  database: "app",
  internal_url: `postgresql://c_3f1a2b3c:s1te-pw@${DATABASE.host}:5432/app`,
  level: "connect",
  credential: "connection",
};

/** paas-api 856337f internal/databases/handler.go — siteCredentialBody, a MongoDB site key (connectionString: always a replica set) */
export const MONGO_CREDENTIALS_SITE_KEY = {
  type: "mongodb",
  host: "my-mongo.databases.svc.cluster.local",
  port: 27017,
  username: "c_3f1a2b3c",
  password: "s1te-pw",
  database: "app",
  internal_url:
    "mongodb://c_3f1a2b3c:s1te-pw@my-mongo.databases.svc.cluster.local:27017/app?authSource=admin&replicaSet=rs0&directConnection=true",
  level: "read-only",
  credential: "connection",
};

/** paas-api 856337f internal/projectkeys/site_credentials.go — RefuseNoOwnCredential, a database */
export const NO_OWN_CREDENTIAL = {
  error: "this site's connection to that database has no credential of its own yet — the platform gives it one as soon as the service can (it retries every ten minutes); retry later, or reconnect the site",
  code: "no_own_credential",
};

/** paas-api 856337f internal/databases/handler.go — GetCredentials, a person (retiredDBCredentialsMessage) */
export const DATABASE_CREDENTIALS_RETIRED = {
  error:
    "A database's own login is no longer shown to anyone: every app connected to my-postgres has its own credential in its variables. " +
    "From your laptop: ghayma connect --local. For a system outside Ghayma: ghayma access add database my-postgres --name <principal>. " +
    "Host, port and the variable names, without any password: ghayma db credentials my-postgres (CLI 0.14.0 or later).",
  code: "shared_credentials_retired",
};

/** paas-api 856337f internal/storage/model.go — StorageBucket, through withPublicURL */
export const BUCKET = {
  id: "88888888-8888-8888-8888-888888888888",
  user_id: "22222222-2222-2222-2222-222222222222",
  project_id: "33333333-3333-3333-3333-333333333333",
  name: "my-assets",
  garage_bucket: "u22222222-my-assets",
  storage_used_bytes: 4096,
  storage_limit_bytes: 1073741824,
  is_public: false,
  external_access: false,
  status: "active",
  endpoint: "https://s3.ghayma.tech",
  allowed_origins: ["https://example.com"],
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-31T10:00:00Z",
};

/** paas-api 856337f internal/storage/handler.go — siteCredentialBody */
export const BUCKET_CREDENTIALS_SITE_KEY = {
  access_key: "GK1234567890abcdef",
  secret_key: "s1te-s3cr3t",
  bucket: "u22222222-my-assets",
  endpoint: "https://s3.ghayma.tech",
  region: "garage",
  level: "read-write",
  credential: "connection",
};

/** paas-api 856337f internal/storage/handler.go — GetCredentials, a person (retiredBucketCredentialsMessage) */
export const BUCKET_CREDENTIALS_RETIRED = {
  error:
    "A bucket's own key is no longer shown to anyone: every app connected to my-assets has its own key in its STORAGE_* variables. " +
    "From your laptop: ghayma env pull (your site's STORAGE_* variables; the S3 endpoint is public). For a system outside Ghayma: ghayma access add bucket my-assets --name <principal>. " +
    "Endpoint, bucket and the variable names, without any key: ghayma storage credentials my-assets (CLI 0.14.0 or later).",
  code: "shared_credentials_retired",
};
