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
 * Read the databases this key can see, get your site's own credential and a
 * ready-to-use connection config, and read live metrics. Creating,
 * deleting, starting, stopping and backing up a database, and access from
 * outside Ghayma, are management: they live in the console and the `ghayma`
 * CLI.
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

  /**
   * Get your site's own credential for a database.
   *
   * With the site's `GHAYMA_API_KEY`: that site's own credential.
   * `409 no_own_credential` while the connection waits for one (retry in a
   * few minutes). A deprecated account token gets `410`: a database's own
   * login is never handed out. A project-wide key gets
   * `403 site_key_required`, and a site not connected to the database
   * `403 not_connected`.
   */
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
   * The site's own login on the in-cluster address, as `getCredentials`
   * reads it: it works from the site's pods. From a laptop, use
   * `ghayma connect --local`.
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
   * // With ioredis
   * const conn = await client.database.getConnection("valkey-id");
   * const redis = new Redis(conn.url);
   * ```
   */
  async getConnection(databaseId: string): Promise<ConnectionConfig> {
    const creds = await this.getCredentials(databaseId);
    return {
      url: creds.internal_url,
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      database: creds.database,
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
