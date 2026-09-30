import { HttpClient } from "./client.js";
import { PKCE_STORAGE_KEY, generatePkce, pkceChallenge } from "./pkce.js";
import { TokenManager } from "./token.js";
import { AuthError, TwoFactorRequiredError } from "./types.js";
import type {
  AuthConfig,
  AuthEvent,
  AuthStateListener,
  CancelEmailChangeResponse,
  ChangeEmailParams,
  ChangeEmailResponse,
  ChangePasswordParams,
  DeleteAccountParams,
  ExchangeCodeParams,
  IdTokenParams,
  LoginParams,
  LoginResult,
  OAuthCallbackParams,
  OAuthFlow,
  OAuthProvider,
  OAuthRedirectParams,
  RegisterParams,
  RequestOptions,
  Session,
  SignInWithOAuthParams,
  TokenPair,
  TotpEnrollment,
  TwoFAEnrollmentRequired,
  TwoFARequired,
  UpdateUserParams,
  User,
} from "./types.js";

export { AuthError, PKCE_STORAGE_KEY, TwoFactorRequiredError, generatePkce, pkceChallenge };
export type { PkcePair } from "./pkce.js";
export type {
  AuthConfig,
  AuthEvent,
  AuthStateListener,
  CancelEmailChangeResponse,
  ChangeEmailParams,
  ChangeEmailResponse,
  ChangePasswordParams,
  DeleteAccountParams,
  ExchangeCodeParams,
  IdTokenParams,
  LoginParams,
  LoginResult,
  OAuthCallbackParams,
  OAuthFlow,
  OAuthProvider,
  OAuthRedirectParams,
  RegisterParams,
  RequestOptions,
  Session,
  SignInWithOAuthParams,
  TokenPair,
  TotpEnrollment,
  TwoFAEnrollmentRequired,
  TwoFARequired,
  UpdateUserParams,
  User,
};

const DEFAULT_BASE_URL = "https://auth.ghayma.tech";
const SERVER_KEY_ENV = "ESPACETECH_AUTH_SERVER_KEY";

/** `my-app.2` → `MY_APP_2` — the suffix Ghayma injects server keys under. */
function envSuffix(appSlug: string): string {
  return appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/**
 * Explicit option → `ESPACETECH_AUTH_SERVER_KEY_<SLUG>` → bare
 * `ESPACETECH_AUTH_SERVER_KEY`. Browsers get no key at all: env is never
 * read there, and an explicit one is a bug worth failing loudly on.
 */
function resolveServerKey(appSlug: string, explicit?: string): string | null {
  if (typeof window !== "undefined") {
    if (explicit) {
      throw new Error(
        "serverKey must never ship to browsers — create this client only in server code (a Next.js route handler, server action, or API route)."
      );
    }
    return null;
  }

  if (explicit) return explicit;

  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (!env) return null;

  return env[`${SERVER_KEY_ENV}_${envSuffix(appSlug)}`] || env[SERVER_KEY_ENV] || null;
}

/**
 * The pending second-factor step an implicit redirect carries in its
 * fragment instead of tokens, or null. The fragment never holds a phone hint.
 */
function pendingSecondFactor(params: URLSearchParams): TwoFARequired | TwoFAEnrollmentRequired | null {
  const methods = (params.get("methods") ?? "").split(",").filter(Boolean) as TwoFARequired["methods"];
  if (params.get("two_fa_required") === "true") {
    return { two_fa_required: true, challenge_token: params.get("challenge_token") ?? "", methods };
  }
  if (params.get("two_fa_enrollment_required") === "true") {
    return { two_fa_enrollment_required: true, enroll_token: params.get("enroll_token") ?? "", methods };
  }
  return null;
}

/** Drop the fragment from the address bar, keeping the path and query. */
function clearFragment(): void {
  if (typeof globalThis.history !== "undefined") {
    globalThis.history.replaceState(null, "", globalThis.location.pathname + globalThis.location.search);
  }
}

export class GhaymaAuth {
  private http: HttpClient;
  private tokens: TokenManager;
  private listeners: Set<AuthStateListener> = new Set();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRefresh: boolean;
  private appSlug: string;
  private baseUrl: string;

  constructor(config: AuthConfig) {
    if (!config.appSlug) {
      throw new Error("appSlug is required");
    }

    this.appSlug = config.appSlug;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.autoRefresh = config.autoRefresh !== false;
    this.tokens = new TokenManager(config.storage ?? "memory");
    this.http = new HttpClient(
      this.appSlug,
      this.baseUrl,
      this.tokens,
      resolveServerKey(this.appSlug, config.serverKey)
    );

    // If restoring from localStorage with auto-refresh, schedule a refresh
    if (this.tokens.hasSession() && this.autoRefresh) {
      this.scheduleRefresh();
    }
  }

  // ==================== Auth ====================

  /**
   * Register a new user with email and password.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async register(params: RegisterParams, options?: RequestOptions): Promise<Session> {
    const data = await this.http.post<Session>("/register", params, false, options);
    if (data.access_token) {
      this.setSession(data, "SIGNED_IN");
    }
    return data;
  }

  /**
   * Log in with email and password.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async login(params: LoginParams, options?: RequestOptions): Promise<LoginResult> {
    const data = await this.http.post<LoginResult>("/login", params, false, options);
    // Pending-2FA shapes carry no tokens — only a full Session is stored.
    if ("two_fa_required" in data || "two_fa_enrollment_required" in data) {
      return data;
    }
    this.setSession(data as Session, "SIGNED_IN");
    return data;
  }

  // ==================== Two-factor authentication ====================

  /** Complete a pending 2FA login with a TOTP or recovery code. */
  async verify2FA(params: { challenge_token: string; code: string }): Promise<Session> {
    const data = await this.http.post<Session>("/2fa/verify", params);
    this.setSession(data, "SIGNED_IN");
    return data;
  }

  /**
   * Start TOTP enrolment. Authenticated users need no enroll_token; pass
   * the one from `two_fa_enrollment_required` on the enforced path.
   * Render `otpauth_uri` as a QR code for the authenticator app.
   */
  async enrollTotp(params?: { enroll_token?: string }): Promise<TotpEnrollment> {
    const forced = Boolean(params?.enroll_token);
    if (!forced) await this.ensureToken();
    // Server reads the Bearer header first and never falls back to the
    // enroll_token — a leftover JWT would hijack the enforced path.
    return this.http.post("/2fa/totp/enroll", params ?? {}, !forced);
  }

  /**
   * Confirm TOTP with a code from the authenticator. Returns the recovery
   * codes — THE ONLY TIME they are shown; tell the user to store them.
   * On the enforced path this also completes the login (session stored).
   */
  async confirmTotp(params: { code: string; enroll_token?: string }): Promise<{
    enabled: boolean;
    recovery_codes?: string[];
  } & Partial<Session>> {
    const forced = Boolean(params.enroll_token);
    if (!forced) await this.ensureToken();
    const data = await this.http.post<{ enabled: boolean; recovery_codes?: string[] } & Partial<Session>>(
      "/2fa/totp/confirm",
      params,
      !forced
    );
    if (data.access_token && data.refresh_token) {
      this.setSession(data as Session, "SIGNED_IN");
    }
    return data;
  }

  /** Disable 2FA — requires the password and a currently-valid code. */
  async disable2FA(params: { password: string; code: string }): Promise<{ message: string }> {
    await this.ensureToken();
    return this.http.post("/2fa/disable", params, true);
  }

  /** Mint a fresh set of 10 recovery codes, invalidating all previous ones. */
  async regenerateRecoveryCodes(params: { password: string; code: string }): Promise<{ recovery_codes: string[] }> {
    await this.ensureToken();
    return this.http.post("/2fa/recovery/regenerate", params, true);
  }

  /** Log out and revoke the refresh token */
  async logout(): Promise<void> {
    const refreshToken = this.tokens.getRefreshToken();
    if (refreshToken) {
      try {
        await this.http.post("/logout", { refresh_token: refreshToken });
      } catch {
        // Best effort — clear local state regardless
      }
    }
    this.clearSession();
  }

  /** Refresh the access token using the stored refresh token */
  async refreshToken(): Promise<TokenPair> {
    const refreshToken = this.tokens.getRefreshToken();
    if (!refreshToken) {
      this.clearSession();
      throw new Error("No refresh token available");
    }

    try {
      const data = await this.http.post<TokenPair>("/refresh", {
        refresh_token: refreshToken,
      });
      this.tokens.setTokens(data);
      this.emit("TOKEN_REFRESHED");
      this.scheduleRefresh();
      return data;
    } catch (err) {
      this.clearSession();
      throw err;
    }
  }

  /**
   * Request a password reset email.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async forgotPassword(params: { email: string }, options?: RequestOptions): Promise<{ message: string }> {
    return this.http.post("/forgot-password", params, false, options);
  }

  /**
   * Reset password using a token from the reset email.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async resetPassword(
    params: { token: string; password: string },
    options?: RequestOptions
  ): Promise<{ message: string }> {
    return this.http.post("/reset-password", params, false, options);
  }

  /**
   * Pre-check a reset token without consuming it, so a custom reset page
   * can show "link expired" before asking for a new password. Returns the
   * account email for display. Throws AuthError on invalid/expired tokens.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async verifyResetToken(
    params: { token: string },
    options?: RequestOptions
  ): Promise<{ valid: boolean; email: string }> {
    return this.http.post("/verify-reset-token", params, false, options);
  }

  /**
   * Resend the email verification link.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   */
  async resendVerification(
    params: { email: string },
    options?: RequestOptions
  ): Promise<{ message: string }> {
    return this.http.post("/resend-verification", params, false, options);
  }

  // ==================== User ====================

  /** Get the current authenticated user's profile */
  async getUser(): Promise<User> {
    await this.ensureToken();
    const data = await this.http.get<{ user: User }>("/me");
    return data.user;
  }

  /** Update the current user's profile */
  async updateUser(params: UpdateUserParams): Promise<User> {
    await this.ensureToken();
    const data = await this.http.patch<{ user: User }>("/me", params);
    this.emit("USER_UPDATED");
    return data.user;
  }

  /** Delete the current user's account */
  async deleteAccount(params?: DeleteAccountParams): Promise<{ message: string }> {
    await this.ensureToken();
    const result = await this.http.del<{ message: string }>("/me", params);
    this.clearSession();
    return result;
  }

  /** Change the current user's password (email accounts only) */
  async changePassword(params: ChangePasswordParams): Promise<{ message: string }> {
    await this.ensureToken();
    const result = await this.http.post<{ message: string }>("/change-password", params, true);
    // All refresh tokens are revoked server-side, clear local session
    this.clearSession();
    return result;
  }

  /**
   * Request an email change for the current user.
   *
   * The server emails a confirmation link to the new address. The change does
   * NOT take effect until the user clicks that link — the user stays signed in
   * with their existing email in the meantime. All refresh tokens are revoked
   * server-side on confirm.
   *
   * @throws {AuthError} 400 — OAuth account (change email via provider), same
   *   email as current, or generic failure (enumeration-masked)
   * @throws {AuthError} 401 — Wrong password
   * @throws {AuthError} 429 — Rate limited (3/hour per user+app)
   */
  async changeEmail(params: ChangeEmailParams): Promise<ChangeEmailResponse> {
    await this.ensureToken();
    return this.http.post<ChangeEmailResponse>("/email/change-request", params, true);
  }

  /**
   * Cancel a pending email change request for the current user.
   *
   * @throws {AuthError} 401 — Not authenticated
   */
  async cancelEmailChange(): Promise<CancelEmailChangeResponse> {
    await this.ensureToken();
    return this.http.del<CancelEmailChangeResponse>("/email/change-request");
  }

  // ==================== OAuth ====================

  /** Provider sign-in URL. With `codeChallenge` the callback returns a one-time `?code=` instead of tokens. */
  getOAuthUrl(provider: OAuthProvider, params: OAuthRedirectParams): string {
    // encodeURIComponent rather than URLSearchParams: form encoding would
    // change the bytes of redirect URIs holding `~`, `!`, `(`, `)` or a space.
    const redirectUri = encodeURIComponent(params.redirectUri);
    let url = `${this.baseUrl}/v1/${this.appSlug}/auth/${provider}?redirect_uri=${redirectUri}`;
    if (params.codeChallenge) {
      url += `&code_challenge=${encodeURIComponent(params.codeChallenge)}&code_challenge_method=S256`;
    }
    return url;
  }

  /** Get the Google OAuth redirect URL */
  getGoogleAuthUrl(params: OAuthRedirectParams): string {
    return this.getOAuthUrl("google", params);
  }

  /** Get the GitHub OAuth redirect URL */
  getGitHubAuthUrl(params: OAuthRedirectParams): string {
    return this.getOAuthUrl("github", params);
  }

  /**
   * Start a provider sign-in from the browser by navigating to the provider.
   *
   * The default `implicit` flow brings the tokens back in the URL fragment;
   * `pkce` brings back a one-time code instead, parking the verifier in
   * `sessionStorage` until `handleOAuthRedirect()` picks it up. Resolves to
   * the URL it navigated to. Server code should use `getOAuthUrl` instead.
   */
  async signInWithOAuth(provider: OAuthProvider, params: SignInWithOAuthParams): Promise<string> {
    if (typeof globalThis.location === "undefined") {
      throw new Error("signInWithOAuth needs a browser; use getOAuthUrl on the server");
    }

    const redirect: OAuthRedirectParams = { redirectUri: params.redirectUri };

    if (params.flow === "pkce") {
      if (typeof globalThis.sessionStorage === "undefined") {
        throw new Error("the pkce flow needs sessionStorage to hold the verifier across the redirect");
      }
      const { codeVerifier, codeChallenge } = await generatePkce();
      globalThis.sessionStorage.setItem(PKCE_STORAGE_KEY, codeVerifier);
      redirect.codeChallenge = codeChallenge;
    }

    const url = this.getOAuthUrl(provider, redirect);
    globalThis.location.assign(url);
    return url;
  }

  /**
   * Trade the one-time code from a PKCE redirect for a session.
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   * @throws {TwoFactorRequiredError} the app's 2FA policy applies — no
   *   session was stored; finish with the token in `result`
   */
  async exchangeCodeForSession(params: ExchangeCodeParams, options?: RequestOptions): Promise<Session> {
    const data = await this.http.post<LoginResult>(
      "/oauth/exchange",
      { code: params.code, code_verifier: params.codeVerifier },
      false,
      options
    );
    return this.oauthSession(data);
  }

  /**
   * Sign in with a provider ID token obtained natively (Google Sign-In SDK).
   *
   * @param options.clientIp — the end user's IP, forwarded so the service
   *   rate-limits per end user instead of per calling server. Needs a
   *   `serverKey`; without one it is ignored and nothing extra is sent.
   * @throws {TwoFactorRequiredError} the app's 2FA policy applies — no
   *   session was stored; finish with the token in `result`
   */
  async signInWithIdToken(params: IdTokenParams, options?: RequestOptions): Promise<Session> {
    const body: Record<string, string> = { provider: params.provider, id_token: params.idToken };
    if (params.nonce) body.nonce = params.nonce;
    const data = await this.http.post<LoginResult>("/oauth/id-token", body, false, options);
    return this.oauthSession(data);
  }

  /** Handle the OAuth callback by storing the tokens from the URL fragment */
  handleOAuthCallback(params: OAuthCallbackParams): void {
    const tokenPair: TokenPair = {
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      expires_in: params.expiresIn,
      token_type: "Bearer",
    };
    this.tokens.setTokens(tokenPair);
    this.emit("SIGNED_IN");
    this.scheduleRefresh();
  }

  /**
   * Parse OAuth tokens from the current URL fragment.
   * Call this on your callback page: `auth.handleOAuthFragment()`
   * Returns true if tokens were found.
   *
   * @throws {TwoFactorRequiredError} the fragment carries a pending second
   *   factor instead of tokens — it is cleared and no session is stored
   */
  handleOAuthFragment(): boolean {
    if (typeof globalThis.location === "undefined") return false;

    const hash = globalThis.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    const pending = pendingSecondFactor(params);
    if (pending) {
      clearFragment();
      throw new TwoFactorRequiredError(pending);
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");

    if (!accessToken || !refreshToken || !expiresIn) return false;

    this.handleOAuthCallback({
      accessToken,
      refreshToken,
      expiresIn: parseInt(expiresIn, 10),
    });

    clearFragment();
    return true;
  }

  /**
   * Finish a sign-in on your callback page, whichever way the provider came
   * back: a PKCE `?code=`, a provider `?error=`, or the implicit
   * `#access_token=` fragment. Returns true when a session was stored.
   * A `?code=` gets one attempt: whatever the answer, it and its verifier are
   * cleared, so running this again on the same page returns false.
   *
   * @throws {AuthError} 400 `oauth_error` — the provider refused
   * @throws {AuthError} 400 `invalid_grant` — no verifier for this redirect,
   *   or a code the service has already spent
   * @throws {TwoFactorRequiredError} the app's 2FA policy applies — no
   *   session was stored; finish with the token in `result`
   */
  async handleOAuthRedirect(): Promise<boolean> {
    if (typeof globalThis.location === "undefined") return false;

    const query = new URLSearchParams(globalThis.location.search);

    const error = query.get("error");
    if (error) throw new AuthError(error, 400, "oauth_error");

    const code = query.get("code");
    if (!code) return this.handleOAuthFragment();

    const codeVerifier = globalThis.sessionStorage?.getItem(PKCE_STORAGE_KEY);
    if (!codeVerifier) {
      throw new AuthError("missing PKCE verifier for this redirect", 400, "invalid_grant");
    }

    try {
      await this.exchangeCodeForSession({ code, codeVerifier });
    } finally {
      // Single use, whatever the answer: drop the verifier, and the spent
      // code from the address bar, keeping the rest of the query
      globalThis.sessionStorage.removeItem(PKCE_STORAGE_KEY);
      if (typeof globalThis.history !== "undefined") {
        query.delete("code");
        const search = query.toString();
        globalThis.history.replaceState(null, "", globalThis.location.pathname + (search ? `?${search}` : ""));
      }
    }

    return true;
  }

  // ==================== Session state ====================

  /** Check if the user is currently authenticated */
  isAuthenticated(): boolean {
    return this.tokens.hasSession();
  }

  /** Get the current access token (or null) */
  getAccessToken(): string | null {
    return this.tokens.getAccessToken();
  }

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==================== Internal ====================

  /** Ensure we have a valid access token, refreshing if needed */
  private async ensureToken(): Promise<void> {
    if (!this.tokens.hasSession()) {
      throw new Error("Not authenticated");
    }
    if (this.tokens.isExpired()) {
      await this.refreshToken();
    }
  }

  private setSession(data: Session | TokenPair, event: AuthEvent): void {
    this.tokens.setTokens(data);
    this.emit(event);
    this.scheduleRefresh();
  }

  /** An OAuth sign-in answers like login(); a pending second factor stores nothing. */
  private oauthSession(data: LoginResult): Session {
    if ("two_fa_required" in data || "two_fa_enrollment_required" in data) {
      throw new TwoFactorRequiredError(data);
    }
    this.setSession(data, "SIGNED_IN");
    return data;
  }

  private clearSession(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.tokens.clear();
    this.emit("SIGNED_OUT");
  }

  private emit(event: AuthEvent): void {
    const session: Session | null = this.tokens.hasSession()
      ? ({
          access_token: this.tokens.getAccessToken()!,
          refresh_token: this.tokens.getRefreshToken()!,
          expires_in: Math.floor(this.tokens.expiresIn() / 1000),
          token_type: "Bearer",
          user: {} as User, // user not always available in events
        } as Session)
      : null;

    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch {
        // Don't let listener errors break the SDK
      }
    }
  }

  private scheduleRefresh(): void {
    if (!this.autoRefresh) return;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 60 seconds before expiry
    const ms = this.tokens.expiresIn() - 60_000;
    if (ms <= 0) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshToken().catch(() => {
        // Refresh failed — session will expire naturally
      });
    }, ms);
  }
}

/** @deprecated use GhaymaAuth */
export { GhaymaAuth as EspaceAuth };
