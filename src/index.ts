/**
 * @ghayma/sdk
 *
 * The runtime SDK for apps running on Ghayma — the server half. It holds a
 * project API key, so it belongs in server code only; the browser half is
 * `@ghayma/sdk/client`, which signs end users in with an app slug and never
 * sees the key. Creating and deleting infrastructure is not here: that is
 * the console and the `ghayma` CLI.
 *
 * @example
 * ```ts
 * import { Ghayma } from "@ghayma/sdk";
 *
 * // With GHAYMA_API_KEY set in the site's environment variables, no arguments are needed.
 * const ghayma = new Ghayma();
 * // Anywhere else, pass a project API key (Project → Settings → API keys):
 * // const ghayma = new Ghayma({ apiKey: process.env.GHAYMA_API_KEY });
 *
 * // Storage
 * await ghayma.storage.upload("bucket-id", "photo.jpg", file);
 * const { url } = await ghayma.storage.getDownloadUrl("bucket-id", "photo.jpg");
 *
 * // Auth — administer an auth app's end users
 * const { users } = await ghayma.auth.listUsers("my-app");
 *
 * // Database — get connection details
 * const conn = await ghayma.database.getConnection("db-id");
 * ```
 *
 * @packageDocumentation
 */

import { HttpClient, type ClientConfig } from "./http.js";
import { StorageClient } from "./storage/index.js";
import { AuthClient } from "./auth/index.js";
import { DatabaseClient } from "./database/index.js";

/**
 * Main Ghayma client.
 *
 * Initialize with a project API key (`gsk_…`) from Project → Settings →
 * API keys, or with no arguments at all in an app connected on Ghayma,
 * where `GHAYMA_API_KEY` is set in the site's environment variables.
 */
export class Ghayma {
  /** Storage — upload/download objects, list them, presigned URLs */
  public readonly storage: StorageClient;
  /** Auth — administer an auth app's end users */
  public readonly auth: AuthClient;
  /** Database — connection details and live metrics */
  public readonly database: DatabaseClient;

  private readonly http: HttpClient;

  constructor(config: ClientConfig = {}) {
    this.http = new HttpClient(config);
    this.storage = new StorageClient(this.http);
    this.auth = new AuthClient(this.http);
    this.database = new DatabaseClient(this.http);
  }
}

/** @deprecated use Ghayma */
export { Ghayma as EspaceTech };

// Re-export everything
export { GhaymaError } from "./http.js";
/** @deprecated use GhaymaError */
export { EspaceError } from "./http.js";
export type { ClientConfig } from "./http.js";

export { getClientIp } from "./client-ip.js";
export type { ClientIpSource } from "./client-ip.js";

export { StorageClient } from "./storage/index.js";
export type {
  Bucket,
  BucketCredentials,
  BucketStatus,
  DownloadResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedUrl,
  StorageObject,
  UploadOptions,
} from "./storage/index.js";

export { AuthClient } from "./auth/index.js";
export type {
  AuthApp,
  AuthEvent,
  AuthProviderCount,
  AuthStats,
  AuthUser,
  EmailLocale,
  ListUsersOptions,
  ListUsersResult,
  TwoFAPolicy,
} from "./auth/index.js";

export { DatabaseClient } from "./database/index.js";
export type {
  BackupTierSlug,
  ConnectionConfig,
  Database,
  DatabaseCredentials,
  DatabaseEngine,
  DatabaseMetrics,
  DatabaseStatus,
  DatabaseType,
  ValkeyMode,
} from "./database/index.js";
