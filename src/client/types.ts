// ==================== Configuration ====================

export interface AuthConfig {
  /** The app slug from your Ghayma auth app */
  appSlug: string;
  /** Base URL of the auth service. Default: https://auth.ghayma.tech */
  baseUrl?: string;
  /** Token storage strategy. Default: "memory" */
  storage?: "memory" | "localStorage";
  /** Auto-refresh tokens before they expire. Default: true */
  autoRefresh?: boolean;
  /**
   * This app's server key (`ghs_…`), the credential that lets the auth
   * service trust an end-user IP forwarded with `clientIp` instead of
   * rate-limiting everything behind your server's own address. It is a
   * secret: pass it only in server code — constructing a client with a
   * `serverKey` in a browser throws, since a leaked key would let anyone
   * spoof the address a rate limit is charged to.
   *
   * On Ghayma-hosted apps the key is injected into the pod as
   * `GHAYMA_AUTH_SERVER_KEY_<SLUG>` (the slug uppercased, every other
   * character turned into `_`), and as `GHAYMA_AUTH_SERVER_KEY` for the
   * oldest auth app connected to the site. When this option is unset the
   * client reads the slug-scoped name, then the bare one, so you rarely
   * need to set it by hand.
   */
  serverKey?: string;
}

/** Per-call options for the operations the auth service rate-limits by IP. */
export interface RequestOptions {
  /**
   * The end user's IP address, forwarded to the auth service so it charges
   * the rate limit to that address rather than to your server — without it,
   * every user of a server-side integration shares one bucket. The service
   * only honours it from a caller holding a valid `serverKey`, so the header
   * is omitted entirely when no key was resolved (the request still runs,
   * just rate-limited by your server's IP).
   *
   * Must be a single IP literal, not a whole `x-forwarded-for` chain;
   * anything else is dropped rather than sent.
   */
  clientIp?: string;
}

// ==================== Auth responses ====================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  email_verified: boolean;
  provider: "email" | "google" | "github";
  /**
   * Developer-owned data (roles, plan, tenant id) set by the app's
   * backend/dashboard — READ-ONLY here. It is also embedded in the JWT
   * as the `app_metadata` claim, so servers can authorize from the
   * verified token without calling the auth service. Not to be confused
   * with `metadata` (updateUser), which the user controls.
   */
  app_metadata?: Record<string, unknown>;
  created_at: string;
  last_login_at?: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: User;
}

/**
 * login() resolves to a Session when no second factor applies, or one of
 * the pending-2FA shapes: `two_fa_required` (enrolled user — call
 * verify2FA with the challenge_token) or `two_fa_enrollment_required`
 * (app enforces 2FA and the user isn't enrolled — run TOTP enrolment
 * with the enroll_token, which also completes the login).
 */
export type LoginResult = Session | TwoFARequired | TwoFAEnrollmentRequired;

export interface TwoFARequired {
  two_fa_required: true;
  challenge_token: string;
  methods: ("totp" | "whatsapp")[];
  phone_hint?: string;
}

export interface TwoFAEnrollmentRequired {
  two_fa_enrollment_required: true;
  enroll_token: string;
  methods: ("totp" | "whatsapp")[];
}

export interface TotpEnrollment {
  secret: string;
  otpauth_uri: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// ==================== Request types ====================

export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface UpdateUserParams {
  name?: string;
  avatar_url?: string;
  metadata?: Record<string, unknown>;
}

export interface ChangePasswordParams {
  current_password: string;
  new_password: string;
}

export interface ChangeEmailParams {
  new_email: string;
  current_password: string;
}

export interface ChangeEmailResponse {
  message: string;
  expires_at: string;
}

export interface CancelEmailChangeResponse {
  message: string;
}

export interface DeleteAccountParams {
  password?: string;
}

export type OAuthProvider = "google" | "github";

export interface OAuthRedirectParams {
  redirectUri: string;
  /** S256 challenge from `generatePkce()`; switches the callback to `?code=`. */
  codeChallenge?: string;
}

export interface OAuthCallbackParams {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type OAuthFlow = "implicit" | "pkce";

export interface SignInWithOAuthParams {
  redirectUri: string;
  /** `implicit` (default, tokens in the URL fragment) or `pkce` (one-time code, recommended). */
  flow?: OAuthFlow;
}

export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
}

export interface IdTokenParams {
  provider: "google";
  idToken: string;
  nonce?: string;
}

// ==================== Events ====================

export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

export type AuthStateListener = (event: AuthEvent, session: Session | null) => void;

// ==================== Errors ====================

export class AuthError extends Error {
  public readonly status: number;
  /**
   * The service's error code — `invalid_credentials`, `rate_limited`,
   * `invalid_request`, `invalid_grant` (expired or replayed one-time code),
   * `invalid_token` (rejected provider ID token), `email_not_verified` (403
   * on `signInWithIdToken`: Google has not verified the email) — or
   * `oauth_error` for a provider error handed back on the redirect.
   * Defaults to `auth_error`. A `TwoFactorRequiredError` carries
   * `two_fa_required` or `two_fa_enrollment_required`.
   */
  public readonly code: string;
  /**
   * Seconds to wait before retrying, read from the response's `Retry-After`
   * header. Present on rate-limited responses (`status` 429, `code`
   * `"rate_limited"`); `undefined` when the server sent no header.
   */
  public readonly retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code ?? "auth_error";
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown by the OAuth sign-in methods when the app's 2FA policy applies to
 * the user: no session was created. Finish with `verify2FA` (a
 * `two_fa_required` result) or with `enrollTotp` + `confirmTotp` (a
 * `two_fa_enrollment_required` result), passing the token in `result`.
 */
export class TwoFactorRequiredError extends AuthError {
  public readonly result: TwoFARequired | TwoFAEnrollmentRequired;
  constructor(result: TwoFARequired | TwoFAEnrollmentRequired) {
    const enrol = "two_fa_enrollment_required" in result;
    super(
      enrol ? "two-factor enrolment required" : "two-factor code required",
      200,
      enrol ? "two_fa_enrollment_required" : "two_fa_required"
    );
    this.name = "TwoFactorRequiredError";
    this.result = result;
  }
}
