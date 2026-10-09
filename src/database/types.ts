/** Database type slug, matching the backend's `type` field (create + responses). */
export type DatabaseType = "postgres" | "mongodb" | "valkey";

/** Valkey mode: `cache` evicts least-recently-used keys when memory is full; `store` never evicts and keeps an append-only file. */
export type ValkeyMode = "cache" | "store";

/** @deprecated use DatabaseType — retained so pre-0.5 imports keep resolving. */
export type DatabaseEngine = DatabaseType;

/** Lifecycle status of a managed database; `resizing` while its disk moves to a new size. */
export type DatabaseStatus = "provisioning" | "running" | "stopped" | "error" | "resizing";

/** Scheduled-backup cadence (backup_tiers.slug). `weekly` is free. */
export type BackupTierSlug = "weekly" | "daily" | "sixhourly";

/** Database instance (GET /databases, GET /databases/:id). */
export interface Database {
  id: string;
  user_id: string;
  /** Absent for databases not attached to a project. */
  project_id?: string;
  team_id?: string;
  name: string;
  type: DatabaseType;
  version: string;
  status: DatabaseStatus;
  /** Why the database is in `error`, e.g. a Valkey that never became ready. */
  status_message?: string;
  host: string;
  port: number;
  /** Absent for Valkey. */
  db_name?: string;
  /** @deprecated not sent since October 2026 — the database's own login is never handed out. */
  username?: string;
  /** Sizing bracket from database_tiers — the persisted sizing decision. */
  tier_slug: string;
  /** Kubernetes resource shape resolved from (tier_slug, type). */
  cpu_request: string;
  cpu_limit: string;
  memory_request: string;
  memory_limit: string;
  /** Compute commitment recorded for the project's plan bucket. */
  cpu_milli: number;
  memory_mb: number;
  /** Tracked storage allowance, in MB. */
  storage_mb: number;
  storage_used_bytes: number;
  /** Persistent-disk footprint in GB — the points-priced disk blocks. */
  disk_gb: number;
  backup_tier_slug: BackupTierSlug;
  max_connections?: number;
  /** MongoDB single-node replica-set mode. */
  replica_set: boolean;
  /** Present only for Valkey. */
  valkey_mode?: ValkeyMode;
  created_at: string;
  updated_at: string;
}

/**
 * A site's own connection credential (GET /databases/:id/credentials): the
 * login its runtime variables carry, never the database's own login. A
 * Valkey's `database` is empty.
 */
export interface DatabaseCredentials {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  /** In-cluster connection string — always present. */
  internal_url: string;
  /** The connection's level (a site's managed key). */
  level?: "read-only" | "connect";
  /** Always "connection": the site's own credential. */
  credential?: "connection";
}

/** Live database metrics (GET /databases/:id/metrics). */
export interface DatabaseMetrics {
  /** The database's lifecycle status — the only field set when it isn't running. */
  status: DatabaseStatus;
  uptime_hours?: number;
  size_bytes: number;
  /** Human-readable form of size_bytes, e.g. "12.4 MB". */
  size_readable: string;
  active_connections: number;
  max_connections?: number;
  /**
   * Engine-specific counters.
   * postgres: table_count, total_rows, cache_hit_ratio, index_usage_ratio, dead_tuples.
   * mongodb: data_size, objects, collections, indexes.
   * valkey: keys, maxmemory_bytes, evicted_keys, keyspace_hits, keyspace_misses, mode.
   */
  extra?: Record<string, unknown>;
}

/** Connection string helpers */
export interface ConnectionConfig {
  /** Full connection string (e.g., postgresql://user:pass@host:port/db, redis://user:pass@host:6379/0) */
  url: string;
  /** Individual components */
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}
