import { HttpClient } from "../http.js";
import type {
  ConnectionConfig,
  Database,
  DatabaseCredentials,
  DatabaseMetrics,
} from "./types.js";

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
} from "./types.js";

/**
 * Database — connect your app to its managed PostgreSQL, MongoDB or Valkey.
 *
 * Read the databases this key can see, get their credentials and a
 * ready-to-use connection config, and read live metrics. Creating,
 * deleting, starting, stopping, exposing and backing up a database are
 * management: they live in the console and the `ghayma` CLI.
 *
 * @example
 * ```ts
 * import { Ghayma } from "@ghayma/sdk";
 *
 * const ghayma = new Ghayma();
 *
 * // Get connection string for your app
 * const conn = await ghayma.database.getConnection("db-id");
 * console.log(conn.url); // postgresql://user:pass@host:port/db
 * ```
 */
export class DatabaseClient {
  constructor(private readonly http: HttpClient) {}

  // ── Databases ──────────────────────────────────────────────

  /** List all databases */
  async list(): Promise<Database[]> {
    const res = await this.http.get<{ databases: Database[] }>(
      "/api/v1/databases",
    );
    return res.databases || [];
  }

  /** Get database details */
  async get(databaseId: string): Promise<Database> {
    const res = await this.http.get<{ database: Database }>(
      `/api/v1/databases/${databaseId}`,
    );
    return res.database;
  }

  // ── Credentials & Connection ───────────────────────────────

  /** Get raw database credentials */
  async getCredentials(databaseId: string): Promise<DatabaseCredentials> {
    const res = await this.http.get<Record<string, unknown>>(
      `/api/v1/databases/${databaseId}/credentials`,
    );
    // Handle both { credentials: { ... } } and flat { host, port, ... } responses
    const creds = (res.credentials || res) as DatabaseCredentials;
    return creds;
  }

  /**
   * Get a parsed connection config — ready to use with your ORM or driver.
   *
   * @example
   * ```ts
   * // With pg (node-postgres)
   * const conn = await client.database.getConnection("db-id");
   * const pool = new Pool({ connectionString: conn.url });
   *
   * // With Prisma — use conn.url in DATABASE_URL
   *
   * // With mongoose
   * const conn = await client.database.getConnection("mongo-id");
   * await mongoose.connect(conn.url);
   *
   * // With ioredis — a Valkey answers only a site's own key, with that site's login
   * const conn = await client.database.getConnection("valkey-id");
   * const redis = new Redis(conn.url);
   * ```
   */
  async getConnection(databaseId: string): Promise<ConnectionConfig> {
    const creds = await this.getCredentials(databaseId);

    // External access is opt-in; when it's enabled, return the externally-
    // reachable URL/host/port so the connection works off-cluster. Otherwise
    // use the in-cluster ones. The backend always provides internal_url, so the
    // URL is never empty (the old manual fallback read a non-existent field).
    const external = creds.external_access && !!creds.external_url;
    return {
      url: (external ? creds.external_url : creds.internal_url) || "",
      host: (external ? creds.external_host : creds.host) || "",
      port: (external ? creds.external_port : creds.port) || 0,
      username: creds.username || "",
      password: creds.password || "",
      database: creds.database || "",
    };
  }

  // ── Metrics ────────────────────────────────────────────────

  /** Get live database metrics (connections, size, performance) */
  async getMetrics(databaseId: string): Promise<DatabaseMetrics> {
    const res = await this.http.get<{ metrics: DatabaseMetrics }>(
      `/api/v1/databases/${databaseId}/metrics`,
    );
    return res.metrics;
  }
}
