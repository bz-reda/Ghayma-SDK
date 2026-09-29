/**
 * Type-level pin for the response types.
 *
 * Each literal below is a real backend payload. Assigning a fresh object
 * literal to an SDK type is checked in both directions: a missing
 * required property means the SDK invented a field the backend never
 * sends, and an excess property means the SDK is missing one it does.
 *
 * This file is type-checked (npm run typecheck:contract) and never built.
 */
import type {
  AuthApp,
  AuthStats,
  AuthUser,
  Bucket,
  BucketCredentials,
  Database,
  DatabaseMetrics,
} from "../src/index.js";
import { AuthError, TwoFactorRequiredError } from "../src/client/index.js";
import type { GhaymaAuth, TwoFAEnrollmentRequired, TwoFARequired } from "../src/client/index.js";

/** paas-api internal/authapps/models.go — AuthApp */
export const authApp: AuthApp = {
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
  google_native_client_ids: [],
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
export const authUser: AuthUser = {
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
export const authStats: AuthStats = {
  total_users: 12,
  verified_users: 9,
  active_sessions: 3,
  signups_today: 1,
  signups_week: 4,
  signups_month: 12,
  events_today: 20,
  events_week: 88,
  logins_today: 0,
  provider_breakdown: [{ provider: "email", count: 10 }],
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

/** paas-api internal/databases/model.go + response.go */
export const database: Database = {
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
  username: "app",
  storage_mb: 1024,
  storage_used_bytes: 12582912,
  cpu_milli: 250,
  memory_mb: 512,
  max_connections: 25,
  disk_gb: 1,
  backup_tier_slug: "weekly",
  external_access: false,
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
export const databaseMetrics: DatabaseMetrics = {
  status: "running",
  uptime_hours: 72.5,
  size_bytes: 12582912,
  size_readable: "12.0 MB",
  active_connections: 3,
  max_connections: 25,
  extra: { table_count: 8, total_rows: 1420 },
};

/** paas-api internal/storage/model.go — StorageBucket */
export const bucket: Bucket = {
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
  allowed_origins: ["https://example.com"],
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-31T10:00:00Z",
};

/** paas-api internal/storage/service.go — GetCredentials return map */
export const bucketCredentials: BucketCredentials = {
  access_key: "GK1234567890abcdef",
  secret_key: "s3cr3t",
  bucket: "u22222222-my-assets",
  endpoint: "https://s3.ghayma.tech",
  region: "garage",
};

/** paas-api api/openapi/auth.v1.yaml — TwoFARequired (POST /login, /oauth/exchange, /oauth/id-token) */
export const twoFARequired: TwoFARequired = {
  two_fa_required: true,
  challenge_token: "4c1d8ab2e3f5",
  methods: ["totp"],
  phone_hint: "",
};

/** paas-api api/openapi/auth.v1.yaml — TwoFAEnrollmentRequired */
export const twoFAEnrollmentRequired: TwoFAEnrollmentRequired = {
  two_fa_enrollment_required: true,
  enroll_token: "7b2e9c40a1d6",
  methods: ["totp"],
};

// The OAuth sign-in methods throw a pending step as a TwoFactorRequiredError.
export const twoFactorRequired: AuthError = new TwoFactorRequiredError(twoFARequired);
export const pendingStep: TwoFARequired | TwoFAEnrollmentRequired =
  new TwoFactorRequiredError(twoFAEnrollmentRequired).result;

/** The README's callback-page pattern must compile. */
export async function finishOAuthSignIn(auth: GhaymaAuth, askUserForCode: () => Promise<string>) {
  try {
    await auth.handleOAuthRedirect();
  } catch (e) {
    if (e instanceof TwoFactorRequiredError && "two_fa_required" in e.result) {
      const code = await askUserForCode();
      await auth.verify2FA({ challenge_token: e.result.challenge_token, code });
    }
  }
}
