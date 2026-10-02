import { withLock } from "./lock.js";
import type { TokenPair } from "./types.js";

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

/** localStorage, or null where the runtime has none that works. */
function localStorageOrNull(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage : null;
  } catch {
    // Node 26+ throws from the getter when started without --localstorage-file
    return null;
  }
}

function parse(raw: string | null): StoredSession | null {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted
  }
}

export class TokenManager {
  private session: StoredSession | null = null;
  // Internal localStorage key — kept unchanged across the Ghayma rebrand so
  // existing end-users of apps built on this SDK stay signed in. Do not rename.
  private storageKey = "espace_auth_session";
  // Tabs coordinate their refreshes under this name, whatever SDK version
  // each one runs. Do not rename.
  private lockName = "espace_auth_session:lock";
  private store: Storage | null;
  // The stored value as this instance last read or wrote it
  private seen: string | null = null;

  constructor(storage: "memory" | "localStorage" = "memory") {
    this.store = storage === "localStorage" ? localStorageOrNull() : null;
    this.sync();
  }

  /** Store tokens from a login/register/refresh response */
  setTokens(tokens: TokenPair): void {
    this.session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    this.persist();
  }

  /** Get the current access token, or null if not authenticated */
  getAccessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  /** Get the current refresh token */
  getRefreshToken(): string | null {
    return this.session?.refreshToken ?? null;
  }

  /** The held tokens as a pair, or null if not authenticated */
  getTokenPair(): TokenPair | null {
    if (!this.session) return null;
    return {
      access_token: this.session.accessToken,
      refresh_token: this.session.refreshToken,
      expires_in: Math.floor(this.expiresIn() / 1000),
      token_type: "Bearer",
    };
  }

  /** Check if the access token has expired (with a 30-second buffer) */
  isExpired(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt - 30_000;
  }

  /** Check if there is any session stored (expired or not) */
  hasSession(): boolean {
    return this.session !== null;
  }

  /** Clear all stored tokens */
  clear(): void {
    this.session = null;
    this.removeStored();
  }

  /** Milliseconds until the access token expires */
  expiresIn(): number {
    if (!this.session) return 0;
    return Math.max(0, this.session.expiresAt - Date.now());
  }

  /**
   * Re-read the stored session, which other tabs share. Returns true when
   * another tab wrote or removed it since this instance last read or wrote
   * it, and takes that state over.
   */
  sync(): boolean {
    if (!this.store) return false;
    let raw: string | null;
    try {
      raw = this.store.getItem(this.storageKey);
    } catch {
      return false; // unavailable
    }
    if (raw === this.seen) return false;
    this.seen = raw;
    this.session = parse(raw);
    return true;
  }

  /**
   * Run `fn` while no other tab sharing the stored session runs one. A
   * memory session belongs to this instance alone.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.store ? withLock(this.lockName, this.store, fn) : fn();
  }

  private persist(): void {
    if (!this.session || !this.store) return;
    const raw = JSON.stringify(this.session);
    try {
      this.store.setItem(this.storageKey, raw);
      this.seen = raw;
    } catch {
      // Quota exceeded or unavailable. The stored pair is now stale, and
      // another tab taking it over would spend a rotated token
      this.removeStored();
    }
  }

  private removeStored(): void {
    if (!this.store) return;
    try {
      this.store.removeItem(this.storageKey);
      this.seen = null;
    } catch {
      // ignore
    }
  }
}
