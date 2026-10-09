import { HttpClient } from "../http.js";
import type {
  Bucket,
  BucketCredentials,
  DownloadResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedUrl,
  StorageObject,
  UploadOptions,
  UploadResult,
} from "./types.js";

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
  UploadResult,
} from "./types.js";

/**
 * Storage — read and write the objects in your app's buckets.
 *
 * Upload, download, list and delete objects, mint presigned URLs for the
 * browser, and read your site's own S3 key for a bucket. Creating and
 * deleting buckets, switching them public or private and rotating an app's
 * key are management: they live in the console and the `ghayma` CLI.
 *
 * @example
 * ```ts
 * import { Ghayma } from "@ghayma/sdk";
 *
 * const ghayma = new Ghayma();
 *
 * // Upload a file
 * await ghayma.storage.upload("bucket-id", "images/photo.jpg", file);
 *
 * // List files
 * const { objects } = await ghayma.storage.listObjects("bucket-id", { prefix: "images/" });
 *
 * // Get download URL
 * const { url } = await ghayma.storage.getDownloadUrl("bucket-id", "images/photo.jpg");
 * ```
 */
export class StorageClient {
  constructor(private readonly http: HttpClient) {}

  // ── Bucket Operations ──────────────────────────────────────

  /** List all buckets */
  async listBuckets(): Promise<Bucket[]> {
    const res = await this.http.get<{ buckets: Bucket[] }>("/api/v1/storage");
    return res.buckets || [];
  }

  /** Get bucket details */
  async getBucket(bucketId: string): Promise<Bucket> {
    const res = await this.http.get<{ bucket: Bucket }>(`/api/v1/storage/${bucketId}`);
    return res.bucket;
  }

  /**
   * Get your site's own S3 key for a bucket, for direct access.
   *
   * With the site's `GHAYMA_API_KEY`: that site's own key.
   * `409 no_own_credential` while the connection waits for one (retry in a
   * few minutes), and `409 credentials_not_ready` while the bucket is still
   * being provisioned. A deprecated account token gets `410`: a bucket's own
   * key is never handed out. A project-wide key gets
   * `403 site_key_required`, and a site not connected to the bucket
   * `403 not_connected`.
   */
  async getCredentials(bucketId: string): Promise<BucketCredentials> {
    const res = await this.http.get<{ credentials: BucketCredentials }>(
      `/api/v1/storage/${bucketId}/credentials`
    );
    return res.credentials;
  }

  // ── Object Operations ──────────────────────────────────────

  /**
   * Upload a file to a bucket.
   *
   * @param bucketId - Bucket ID
   * @param key - Object key (path), e.g. "images/photo.jpg"
   * @param data - File content as Blob, Buffer, ReadableStream, or string
   * @param options - Upload options
   *
   * @example
   * ```ts
   * // Node.js — upload from buffer
   * import { readFileSync } from "fs";
   * const buffer = readFileSync("./photo.jpg");
   * await storage.upload("bucket-id", "photos/photo.jpg", new Blob([buffer]));
   *
   * // Browser — upload from File input
   * const file = inputElement.files[0];
   * await storage.upload("bucket-id", `uploads/${file.name}`, file);
   * ```
   */
  async upload(
    bucketId: string,
    key: string,
    data: Blob | File,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const formData = new FormData();
    formData.append("key", key);

    if (options?.contentType) {
      formData.append("file", new Blob([data], { type: options.contentType }), key.split("/").pop());
    } else {
      formData.append("file", data, key.split("/").pop());
    }

    return this.http.upload<UploadResult>(
      `/api/v1/storage/${bucketId}/objects/upload`,
      formData,
      options?.timeout ?? 300_000 // 5 min default for uploads
    );
  }

  /**
   * List objects in a bucket with pagination.
   *
   * @example
   * ```ts
   * // List all images
   * const result = await storage.listObjects("bucket-id", { prefix: "images/" });
   * console.log(result.objects); // files
   * console.log(result.folders); // subfolders
   *
   * // Paginate
   * if (result.is_truncated) {
   *   const next = await storage.listObjects("bucket-id", {
   *     continuationToken: result.continuation_token,
   *   });
   * }
   * ```
   */
  async listObjects(
    bucketId: string,
    options?: ListObjectsOptions
  ): Promise<ListObjectsResult> {
    return this.http.get<ListObjectsResult>(`/api/v1/storage/${bucketId}/objects`, {
      prefix: options?.prefix,
      continuation_token: options?.continuationToken,
      max_keys: options?.maxKeys,
    });
  }

  /**
   * List ALL objects recursively (traverses all folders).
   * Useful for analytics or full bucket operations.
   *
   * ⚠️ For large buckets, this may take a while. Use `listObjects()` for paginated access.
   */
  async listAllObjects(
    bucketId: string,
    prefix = ""
  ): Promise<StorageObject[]> {
    const all: StorageObject[] = [];

    const traverse = async (pfx: string) => {
      let token: string | undefined;
      let truncated = true;

      while (truncated) {
        const result = await this.listObjects(bucketId, {
          prefix: pfx,
          continuationToken: token,
        });

        all.push(...result.objects);

        // Recurse into subfolders
        for (const folder of result.folders) {
          await traverse(folder);
        }

        token = result.continuation_token || undefined;
        truncated = result.is_truncated;
      }
    };

    await traverse(prefix);
    return all;
  }

  /** Delete an object from a bucket */
  async deleteObject(bucketId: string, key: string): Promise<void> {
    await this.http.request("DELETE", `/api/v1/storage/${bucketId}/objects`, {
      body: { key },
    });
  }

  /**
   * Download a file from a bucket.
   *
   * @example
   * ```ts
   * // Next.js API route — serve a private image
   * import { ghayma } from "@/lib/ghayma";
   *
   * export async function GET(req: Request) {
   *   const key = new URL(req.url).searchParams.get("key")!;
   *   const file = await ghayma.storage.download("bucket-id", key);
   *   return new Response(file.body, {
   *     headers: {
   *       "Content-Type": file.contentType,
   *       "Cache-Control": "public, max-age=3600",
   *     },
   *   });
   * }
   *
   * // Node.js — save to disk
   * import { writeFileSync } from "fs";
   * const file = await client.storage.download("bucket-id", "report.pdf");
   * writeFileSync("report.pdf", Buffer.from(await file.arrayBuffer()));
   * ```
   */
  async download(bucketId: string, key: string): Promise<DownloadResult> {
    const res = await this.http.rawFetch(
      `/api/v1/storage/${bucketId}/objects/download?key=${encodeURIComponent(key)}`
    );

    return {
      body: res.body,
      arrayBuffer: () => res.arrayBuffer(),
      blob: () => res.blob(),
      contentType: res.headers.get("Content-Type") || "application/octet-stream",
      size: parseInt(res.headers.get("Content-Length") || "0", 10),
    };
  }

  // ── Presigned URLs ─────────────────────────────────────────

  /**
   * Get a presigned upload URL. Useful for client-side uploads
   * without exposing your API token.
   *
   * @example
   * ```ts
   * const { url } = await storage.getUploadUrl("bucket-id", "uploads/photo.jpg");
   * // Use the URL to upload directly from a browser
   * await fetch(url, { method: "PUT", body: file });
   * ```
   */
  async getUploadUrl(
    bucketId: string,
    key: string,
    contentType?: string
  ): Promise<PresignedUrl> {
    const res = await this.http.post<Record<string, unknown>>(
      `/api/v1/storage/${bucketId}/presign/upload`,
      { key, content_type: contentType },
    );
    return {
      url: (res.upload_url || res.url) as string,
      key,
      expires_in: (res.expires_in as number) || 3600,
    };
  }

  /**
   * Get a presigned download URL. Useful for serving private files
   * to users without exposing credentials.
   *
   * @example
   * ```ts
   * const { url } = await storage.getDownloadUrl("bucket-id", "reports/q4.pdf");
   * // Redirect user to this URL or use in <img src={url} />
   * ```
   */
  async getDownloadUrl(bucketId: string, key: string): Promise<PresignedUrl> {
    const res = await this.http.post<Record<string, unknown>>(
      `/api/v1/storage/${bucketId}/presign/download`,
      { key },
    );
    return {
      url: (res.download_url || res.url) as string,
      key,
      expires_in: (res.expires_in as number) || 3600,
    };
  }
}
