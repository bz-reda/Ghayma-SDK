/** Lifecycle status of a bucket. */
export type BucketStatus = "provisioning" | "active" | "error";

/** Storage bucket (GET /storage, GET /storage/:id). */
export interface Bucket {
  id: string;
  user_id: string;
  /** Absent for buckets not attached to a project. */
  project_id?: string;
  team_id?: string;
  name: string;
  /** Underlying S3 bucket name — pass this as `Bucket` to an S3 client. */
  garage_bucket: string;
  /** The S3 endpoint the bucket is reached on. No key travels with it: an app's key is in its `STORAGE_*` variables. */
  endpoint?: string;
  status: BucketStatus;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  is_public: boolean;
  external_access: boolean;
  /** CORS allow-list pushed to the S3 layer. */
  allowed_origins: string[];
  created_at: string;
  updated_at: string;
}

/**
 * A site's own S3 key for a bucket (GET /storage/:id/credentials): the key
 * its `STORAGE_*` variables carry, never the bucket's own key. Feed it
 * straight into any S3 client (`accessKeyId: access_key`,
 * `secretAccessKey: secret_key`).
 */
export interface BucketCredentials {
  endpoint: string;
  region: string;
  /** Underlying S3 bucket name (not the Ghayma bucket id). */
  bucket: string;
  access_key: string;
  secret_key: string;
  /** The connection's level (a site's managed key); a `read` key cannot write. */
  level?: "read" | "read-write";
  /** Always "connection": the site's own credential. */
  credential?: "connection";
}

/** An object (file) in a bucket */
export interface StorageObject {
  key: string;
  size: number;
  last_modified: string;
  etag?: string;
  is_folder: boolean;
}

/** Result of listing objects */
export interface ListObjectsResult {
  objects: StorageObject[];
  folders: string[];
  is_truncated: boolean;
  continuation_token: string;
}

/** Options for listing objects */
export interface ListObjectsOptions {
  /** Prefix to filter keys (e.g., "images/") */
  prefix?: string;
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Max keys to return per page (default: 100) */
  maxKeys?: number;
}

/** Presigned URL response */
export interface PresignedUrl {
  /** The presigned URL — use directly in browser */
  url: string;
  /** Object key this URL is for */
  key: string;
  /** Seconds until the URL expires (default: 3600) */
  expires_in: number;
}

/** Result of an object upload */
export interface UploadResult {
  message: string;
  /** The key the object was stored under. */
  key: string;
}

/** Upload options */
export interface UploadOptions {
  /** Custom content type (auto-detected if omitted) */
  contentType?: string;
  /** Upload timeout in ms (default: 5 minutes) */
  timeout?: number;
}

/** Result of downloading an object */
export interface DownloadResult {
  /** Raw response body stream */
  body: ReadableStream<Uint8Array> | null;
  /** Get full content as ArrayBuffer */
  arrayBuffer: () => Promise<ArrayBuffer>;
  /** Get full content as Blob */
  blob: () => Promise<Blob>;
  /** MIME type of the file */
  contentType: string;
  /** File size in bytes (0 if unknown) */
  size: number;
}
