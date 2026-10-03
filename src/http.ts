/**
 * Ghayma SDK — Base HTTP Client
 *
 * Handles authentication, request building, error handling,
 * and optional retries for all SDK modules.
 */

export interface ClientConfig {
  /** Project API key (`gsk_…`) from Project → Settings → API keys. Defaults to GHAYMA_API_KEY. */
  apiKey?: string;
  /** @deprecated account token (`gh_…`). Acts as you across every project; use a project API key. */
  apiToken?: string;
  /** Base URL override (default: https://api.ghayma.tech) */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retries on 5xx errors (default: 2) */
  maxRetries?: number;
}

/** Reads process.env where it exists (Node, Bun, Deno); undefined in a browser. */
function readEnv(name: string): string | undefined {
  try {
    return (globalThis as any).process?.env?.[name];
  } catch {
    return undefined;
  }
}

/** An account token warns on the first client that uses one, not on every one. */
let accountTokenWarned = false;

export class GhaymaError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "GhaymaError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @deprecated use GhaymaError */
export { GhaymaError as EspaceError };

interface ErrorResponse {
  error?: string;
  code?: string;
  details?: unknown;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly credential: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: ClientConfig = {}) {
    // A hosted app sets GHAYMA_API_KEY in its environment, so `new Ghayma()` works
    // there with no arguments; the deprecated account token still resolves.
    const credential = config.apiKey || config.apiToken || readEnv("GHAYMA_API_KEY") || "";
    if (!credential) {
      throw new Error(
        "@ghayma/sdk: no credential. Create a project API key in the console (Project → Settings → API keys) and pass it as apiKey or set GHAYMA_API_KEY."
      );
    }
    if ((credential.startsWith("gh_") || credential.startsWith("et_")) && !accountTokenWarned) {
      accountTokenWarned = true;
      console.warn(
        "@ghayma/sdk: you are using an account token. It acts as you across every project; switch to a project API key (gsk_…) from Project → Settings → API keys."
      );
    }
    this.credential = credential;
    // Dual-read: prefer GHAYMA_API_URL, fall back to legacy ESPACE_API_URL
    // so existing deployments setting the old var keep working post-rebrand.
    // An empty value counts as unset, as for the auth server key.
    const envUrl = readEnv("GHAYMA_API_URL") || readEnv("ESPACE_API_URL");
    this.baseUrl = (config.baseUrl || envUrl || "https://api.ghayma.tech").replace(/\/$/, "");
    this.timeout = config.timeout ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      formData?: FormData;
      query?: Record<string, string | number | boolean | undefined>;
      timeout?: number;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (options?.query) {
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined && val !== "") {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credential}`,
    };

    let body: BodyInit | undefined;
    if (options?.formData) {
      body = options.formData;
      // Don't set Content-Type — browser/runtime sets multipart boundary
    } else if (options?.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const timeout = options?.timeout ?? this.timeout;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(url.toString(), {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          // Handle empty responses (204 No Content)
          if (res.status === 204) return undefined as T;
          return (await res.json()) as T;
        }

        // Parse error response
        let errData: ErrorResponse = {};
        try {
          errData = (await res.json()) as ErrorResponse;
        } catch {
          // Response wasn't JSON
        }

        const error = new GhaymaError(
          errData.error || `Request failed with status ${res.status}`,
          res.status,
          errData.code || `HTTP_${res.status}`,
          errData.details
        );

        // Only retry on 5xx (server) errors
        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = error;
          await this.backoff(attempt);
          continue;
        }

        throw error;
      } catch (err) {
        if (err instanceof GhaymaError) throw err;

        if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new GhaymaError("Request timed out", 408, "TIMEOUT");
        } else {
          lastError = new GhaymaError(
            err instanceof Error ? err.message : "Network error",
            0,
            "NETWORK_ERROR"
          );
        }

        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
      }
    }

    throw lastError || new GhaymaError("Request failed", 0, "UNKNOWN");
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async upload<T>(path: string, formData: FormData, timeout?: number): Promise<T> {
    return this.request<T>("POST", path, { formData, timeout });
  }

  /** Raw fetch with auth headers — for streaming responses (downloads) */
  async rawFetch(path: string, options?: { timeout?: number }): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const timeout = options?.timeout ?? 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.credential}` },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `Request failed with status ${res.status}`;
      try {
        const cloned = res.clone();
        const data = (await cloned.json()) as { error?: string };
        if (data.error) errMsg = data.error;
      } catch { /* not JSON */ }
      throw new GhaymaError(errMsg, res.status, `HTTP_${res.status}`);
    }

    return res;
  }

  private backoff(attempt: number): Promise<void> {
    const ms = Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 500;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
