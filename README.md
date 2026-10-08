# @ghayma/sdk

The runtime SDK for apps running on [Ghayma](https://ghayma.cloud) — the code your app calls at runtime, not the code that builds your infrastructure.

It has two entry points. **`@ghayma/sdk`** runs on your server: it holds a project API key and administers your auth app's end users, reads and writes storage objects, and hands you database connection details. **`@ghayma/sdk/client`** runs in the browser: it signs your end users in with an app slug, and never sees the key. Creating, deleting and resizing infrastructure is not in the SDK — that lives in the console at [dash.ghayma.cloud](https://dash.ghayma.cloud) and the `ghayma` CLI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4%2B-blue.svg)](https://typescriptlang.org)

## Install

```bash
npm install @ghayma/sdk
```

Zero runtime dependencies — the SDK uses native `fetch` (Node.js 18+, Deno, Bun, Cloudflare Workers, browsers).

## Server

```ts
import { Ghayma } from "@ghayma/sdk";

// With GHAYMA_API_KEY set in your site's environment variables, no arguments are needed.
const ghayma = new Ghayma();
// Anywhere else, pass a project API key (Project → Settings → API keys):
// const ghayma = new Ghayma({ apiKey: process.env.GHAYMA_API_KEY });

const { users } = await ghayma.auth.listUsers("my-app");
const { url } = await ghayma.storage.getDownloadUrl("bucket-id", "photos/1.jpg");
const conn = await ghayma.database.getConnection("db-id");
```

## Browser

```ts
import { GhaymaAuth } from "@ghayma/sdk/client";

const auth = new GhaymaAuth({ appSlug: "my-app" });

// Register
await auth.register({ email: "user@example.com", password: "securepass123", name: "John" });

// Login — resolves to a Session unless the app asks for a second factor
const result = await auth.login({ email: "user@example.com", password: "securepass123" });
if ("two_fa_required" in result) {
  await auth.verify2FA({ challenge_token: result.challenge_token, code: "123456" });
}

// Get profile (auto-refreshes the token if expired)
const me = await auth.getUser();

// Logout
await auth.logout();
```

### OAuth in the browser and on mobile

```ts
// Recommended: one-time code (PKCE). Tokens never appear in the URL.
await auth.signInWithOAuth("google", { redirectUri: "https://myapp.com/auth/callback", flow: "pkce" });

// On the callback page — handles ?code= (PKCE) and the legacy #access_token= fragment
if (await auth.handleOAuthRedirect()) {
  const me = await auth.getUser();
}

// Native sign-in (React Native, Capacitor): post the Google ID token the device obtained
await auth.signInWithIdToken({ provider: "google", idToken });
```

A mobile deep link (`com.example.app://callback`) works the same way, as long as that exact URL is listed in the app's **Allowed Origins**. On a server, where there is no browser to redirect, drive the flow yourself with `generatePkce()`, `getOAuthUrl()` and `exchangeCodeForSession()`.

The full walkthrough is in [OAuth on mobile](https://docs.ghayma.cloud/guides/oauth-mobile).

### Second factor on OAuth sign-in

When the app's 2FA policy applies to the user, an OAuth sign-in stores no session: `handleOAuthRedirect`, `handleOAuthFragment`, `exchangeCodeForSession` and `signInWithIdToken` throw a `TwoFactorRequiredError` whose `result` is the pending step `login()` would have returned.

```ts
import { TwoFactorRequiredError } from "@ghayma/sdk/client";

try { await auth.handleOAuthRedirect(); }
catch (e) {
  if (e instanceof TwoFactorRequiredError && "two_fa_required" in e.result) {
    const code = await askUserForCode();
    await auth.verify2FA({ challenge_token: e.result.challenge_token, code });
  }
}
```

A `two_fa_enrollment_required` result means the app enforces 2FA and the user has no factor yet: pass `e.result.enroll_token` to `enrollTotp`, then to `confirmTotp` with the first code, which completes the sign-in.

## What each entry can do

**`@ghayma/sdk` (server)**

- **Auth** — `listApps`, `getApp`, `getStats`, `listUsers`, `disableUser`, `enableUser`, `deleteUser`, `resetUser2FA`, `generatePasswordResetLink`, `updateUserAppMetadata`
- **Storage** — `listBuckets`, `getBucket`, `getCredentials`, `upload`, `listObjects`, `listAllObjects`, `deleteObject`, `download`, `getUploadUrl`, `getDownloadUrl`
- **Database** — `list`, `get`, `getCredentials`, `getConnection`, `getMetrics`
- **Visitor IP** — `getClientIp`

**`@ghayma/sdk/client` (browser)**

- **Sessions** — `register`, `login`, `logout`, `refreshToken`, `isAuthenticated`, `getAccessToken`, `onAuthStateChange`
- **Two-factor** — `verify2FA`, `enrollTotp`, `confirmTotp`, `disable2FA`, `regenerateRecoveryCodes`
- **Profile** — `getUser`, `updateUser`, `changePassword`, `changeEmail`, `cancelEmailChange`, `deleteAccount`
- **Passwords and email** — `forgotPassword`, `resetPassword`, `verifyResetToken`, `resendVerification`
- **OAuth** — `signInWithOAuth`, `handleOAuthRedirect`, `getOAuthUrl`, `getGoogleAuthUrl`, `getGitHubAuthUrl`, `exchangeCodeForSession`, `signInWithIdToken`, `generatePkce`, `handleOAuthCallback`, `handleOAuthFragment`
- **Visitor IP** — `getClientIp`, for server code that forwards it as `clientIp`

The project API key is a secret and **never ships to a browser**: the client entry authenticates with your app slug alone, so the key stays on your server where you created the `Ghayma` client.

## Keys

A **project API key** (`gsk_…`) is created in the console at **Project → Settings → API keys**. It is scoped to that one project, which is what an app running on Ghayma needs. Connected apps get it injected as `GHAYMA_API_KEY`, so `new Ghayma()` works with no arguments; elsewhere pass it as `apiKey`.

An **account token** (`gh_…`) still works, but it acts as you across every project you can reach. Passing one as `apiToken` logs a warning once per process:

```
@ghayma/sdk: you are using an account token. It acts as you across every project;
switch to a project API key (gsk_…) from Project → Settings → API keys.
```

Account tokens remain the CLI's credential; for an app, use a project API key.

## Migrating from 0.x

Everything that creates, destroys or reconfigures infrastructure left the SDK in 1.1.0. Each removed method has a home in the console or the CLI:

| Removed | Where it lives now |
|---|---|
| `auth.createApp()` | `ghayma auth create`, or the console's Auth page |
| `auth.updateApp()` | `ghayma auth config`, or the console's Auth page |
| `auth.deleteApp()` | `ghayma auth delete`, or the console's Auth page |
| `auth.rotateKeys()` | `ghayma auth rotate-keys`, or the console's Auth page |
| `storage.createBucket()` | `ghayma storage create` |
| `storage.deleteBucket()` | `ghayma storage delete` |
| `storage.rotateCredentials()` | `ghayma storage rotate` |
| `storage.makePublic()` | `ghayma storage expose` |
| `storage.makePrivate()` | `ghayma storage unexpose` |
| `database.create()` | `ghayma db create` |
| `database.delete()` | `ghayma db delete` |
| `database.stop()` / `database.start()` | `ghayma db stop` / `ghayma db start` |
| `database.rotateCredentials()` | `ghayma db rotate` |
| `database.expose()` / `database.unexpose()` | `ghayma db expose` / `ghayma db unexpose` |
| `database.createBackup()`, `listBackups()`, `restoreBackup()`, `deleteBackup()` | the console's database Backups tab |

The credential changed too:

```diff
- const client = new Ghayma({ apiToken: process.env.GHAYMA_TOKEN! });
+ const ghayma = new Ghayma({ apiKey: process.env.GHAYMA_API_KEY! });
+ // or, in an app connected on Ghayma:
+ const ghayma = new Ghayma();
```

`apiToken` still works and is deprecated; see [Keys](#keys).

## `@ghayma/auth`

`@ghayma/auth` is deprecated. It re-exports `@ghayma/sdk/client`, so existing code keeps working — migrate by changing the import:

```diff
- import { GhaymaAuth } from "@ghayma/auth";
+ import { GhaymaAuth } from "@ghayma/sdk/client";
```

---

## Storage

Read and write the objects in your app's buckets.

### Upload a file

```ts
// Node.js
import { readFileSync } from "fs";
const buffer = readFileSync("./photo.jpg");
await ghayma.storage.upload("bucket-id", "images/photo.jpg", new Blob([buffer]));

// Browser — from a file input
const file = inputElement.files[0];
await ghayma.storage.upload("bucket-id", `uploads/${file.name}`, file);
```

### Download a file

```ts
const file = await ghayma.storage.download("bucket-id", "images/photo.jpg");

// Save to disk (Node.js)
import { writeFileSync } from "fs";
writeFileSync("photo.jpg", Buffer.from(await file.arrayBuffer()));

// Serve from an API route (Next.js)
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key")!;
  const file = await ghayma.storage.download("bucket-id", key);
  return new Response(file.body, {
    headers: { "Content-Type": file.contentType },
  });
}
```

### List files

```ts
const result = await ghayma.storage.listObjects("bucket-id", { prefix: "images/" });

for (const obj of result.objects) {
  console.log(obj.key, obj.size);
}

// Paginate
if (result.is_truncated) {
  const next = await ghayma.storage.listObjects("bucket-id", {
    continuationToken: result.continuation_token,
  });
}

// Or traverse every page and folder in one call
const allFiles = await ghayma.storage.listAllObjects("bucket-id", "images/");
```

### Presigned URLs (best for the browser)

Presigned URLs let browsers reach private objects directly — no proxy route, no credential in the page.

```ts
// Download URL — use in <img src={url} />, expires in 1 hour
const { url } = await ghayma.storage.getDownloadUrl("bucket-id", "images/photo.jpg");

// Upload URL — let the browser PUT the bytes itself
const { url: uploadUrl } = await ghayma.storage.getUploadUrl("bucket-id", "uploads/photo.jpg");
await fetch(uploadUrl, { method: "PUT", body: file });
```

### Delete an object

```ts
await ghayma.storage.deleteObject("bucket-id", "images/old-photo.jpg");
```

### Bucket details and S3 credentials

```ts
const buckets = await ghayma.storage.listBuckets();
const info = await ghayma.storage.getBucket("bucket-id");

// Point any S3 client at the bucket
const creds = await ghayma.storage.getCredentials("bucket-id");
const s3 = new S3Client({
  endpoint: creds.endpoint,
  region: creds.region,
  credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key },
});
// creds.bucket is the underlying S3 bucket name to pass as `Bucket`
```

---

## Auth

Administer your auth app's end users. Signing users in happens in the browser with [`@ghayma/sdk/client`](#browser).

### Users

```ts
// List users with pagination (per_page is capped at 100)
const { users, total } = await ghayma.auth.listUsers("my-app", { page: 1, per_page: 50 });

// Disable / enable a user
await ghayma.auth.disableUser("my-app", "user-id");
await ghayma.auth.enableUser("my-app", "user-id");

// Delete a user
await ghayma.auth.deleteUser("my-app", "user-id");

// Clear a locked-out user's 2FA enrolment (lost phone) — admin or owner role
await ghayma.auth.resetUser2FA("my-app", "user-id");
```

### Roles and other app metadata

`app_metadata` is developer-owned data that rides in the user's JWT, so your server authorizes from the verified token without another round trip. It reaches the token at the user's next refresh.

```ts
await ghayma.auth.updateUserAppMetadata("my-app", "user-id", { roles: ["admin"] });
```

### Password reset links

For apps that send their own reset emails. The link is a live single-use credential that expires in an hour — send it to the user's verified address and never log it.

```ts
const { link } = await ghayma.auth.generatePasswordResetLink("my-app", "user@example.com");
```

### App details and statistics

```ts
const apps = await ghayma.auth.listApps();
const app = await ghayma.auth.getApp("my-app");

const stats = await ghayma.auth.getStats("my-app");
console.log(stats.total_users, stats.logins_today);
```

---

## Database

Connect your app to its managed PostgreSQL, MongoDB or Valkey.

### Get a connection string

```ts
const conn = await ghayma.database.getConnection("db-id");

// PostgreSQL with node-postgres
import { Pool } from "pg";
const pool = new Pool({ connectionString: conn.url });

// PostgreSQL with Prisma — set DATABASE_URL to conn.url

// MongoDB with mongoose
import mongoose from "mongoose";
await mongoose.connect(conn.url);
```

A Valkey (Redis protocol) has no shared credential: each connected site has its own login. Read it with the site's own key, the `GHAYMA_API_KEY` Ghayma injects into the site; the URL is the one the site already has as `REDIS_URL` (or `REDIS_URL_<NAME>` when the project has several Valkeys). An account token gets `409 no_shared_credential`.

```ts
// Valkey with ioredis
import Redis from "ioredis";
const cache = await ghayma.database.getConnection("valkey-id"); // redis://c_…@…:6379/0
const redis = new Redis(cache.url);
```

### Details, credentials and metrics

```ts
const databases = await ghayma.database.list();
const db = await ghayma.database.get("db-id");

const creds = await ghayma.database.getCredentials("db-id");
console.log(creds.host, creds.port, creds.username, creds.database);

const metrics = await ghayma.database.getMetrics("db-id");
console.log(metrics.active_connections, metrics.size_readable);
```

---

## Error handling

Every server method throws `GhaymaError` on failure:

```ts
import { GhaymaError } from "@ghayma/sdk";

try {
  await ghayma.storage.upload("bucket-id", "file.txt", blob);
} catch (err) {
  if (err instanceof GhaymaError) {
    console.error(err.message);  // "Bucket not found"
    console.error(err.status);   // 404
    console.error(err.code);     // "HTTP_404"
  }
}
```

The client entry throws `AuthError`, which carries `status`, `code` and — on a `429` — `retryAfter` in seconds.

## Configuration

```ts
const ghayma = new Ghayma({
  apiKey: "gsk_...",                    // Default: GHAYMA_API_KEY
  baseUrl: "https://api.ghayma.tech",   // Default
  timeout: 30000,                       // 30s default
  maxRetries: 2,                        // Retries on 5xx and network errors
});
```

```ts
const auth = new GhaymaAuth({
  appSlug: "my-app",                    // Required — your auth app's slug
  baseUrl: "https://auth.ghayma.tech",  // Default
  storage: "memory",                    // "memory" (default) or "localStorage"
  autoRefresh: true,                    // Refresh before expiry (default: true)
});
```

With `localStorage`, every tab of your site shares one session, and the tabs take turns refreshing it (through Web Locks where the browser has them), so a refresh token is never presented twice: the auth service treats a reused refresh token as stolen and ends every session of the user.

### Server-side calls to the auth service

When your own server calls the auth service, every request arrives from one IP and all of your users share a single rate-limit bucket. A **server key** (`ghs_…`) lets the service trust an end-user IP your server forwards and charge the limit to that address instead. Ghayma injects the key into connected apps as `GHAYMA_AUTH_SERVER_KEY_<SLUG>` (see [Environment variables](#environment-variables)), so the client picks it up on its own; pass `serverKey` explicitly only when hosting elsewhere.

```ts
// app/api/register/route.ts — a client per request, never module-level
const auth = new GhaymaAuth({ appSlug: "my-app", autoRefresh: false });
const clientIp = getClientIp(req);
await auth.register({ email, password }, { clientIp });
```

`getClientIp` reads the `X-Real-IP` header and returns it only when it holds one valid IP address; otherwise it returns `undefined`, and the call goes out without one. On Ghayma, the edge overwrites `X-Real-IP` on every request, so no visitor can forge it. If your app is also reachable another way (another host, its own proxy), that path must overwrite `X-Real-IP` too, or the value must not be trusted there.

The refreshes the SDK starts on its own (the auto-refresh timer, or an authenticated call such as `getUser()` finding the token expired) send no `clientIp`, so server code should call `refreshToken({ clientIp })` itself when a token may have expired. A call that joins a refresh already in flight shares that request's options.

The key is a secret: constructing a client with a `serverKey` in a browser throws.

## Imports

```ts
// Server
import { Ghayma, getClientIp } from "@ghayma/sdk";
import { StorageClient } from "@ghayma/sdk/storage";
import { AuthClient } from "@ghayma/sdk/auth";
import { DatabaseClient } from "@ghayma/sdk/database";

// Browser
import { GhaymaAuth, getClientIp } from "@ghayma/sdk/client";
```

## Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `GHAYMA_API_KEY` | server entry | The project API key. Connected apps get it injected, so `new Ghayma()` works with no arguments; elsewhere pass it as `apiKey` |
| `GHAYMA_API_URL` | server entry | Base URL override (an explicit `baseUrl` still wins) |
| `GHAYMA_AUTH_SERVER_KEY_<SLUG>` | client entry, server-side only | The auth app's server key, injected into connected apps. `<SLUG>` is the app slug uppercased, every other character turned into `_` (`my-app` → `MY_APP`) |
| `GHAYMA_AUTH_SERVER_KEY` | client entry, server-side only | The server key of the oldest auth app connected to the site, read when the slug-scoped one is unset |

An explicit `serverKey` wins over both server key variables, and a browser never reads either.

## Next.js

```ts
// lib/ghayma.ts — one shared server client
import { Ghayma } from "@ghayma/sdk";

export const ghayma = new Ghayma();
```

```ts
// app/api/upload/route.ts
import { ghayma } from "@/lib/ghayma";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  const obj = await ghayma.storage.upload("bucket-id", `uploads/${file.name}`, file);
  return Response.json({ key: obj.key });
}
```

```ts
// app/api/images/route.ts — list images with browser-ready URLs
import { ghayma } from "@/lib/ghayma";

export async function GET() {
  const result = await ghayma.storage.listObjects("bucket-id", { prefix: "images/" });

  const images = await Promise.all(
    result.objects
      .filter((obj) => !obj.is_folder)
      .map(async (obj) => ({
        key: obj.key,
        url: (await ghayma.storage.getDownloadUrl("bucket-id", obj.key)).url,
      }))
  );

  return Response.json({ images });
  // Frontend: <img src={image.url} /> — no proxy route needed
}
```

## Compatibility

- **Node.js** 18+ (native `fetch`)
- **Deno**, **Bun**, **Cloudflare Workers**
- **Browsers** — the client entry, and presigned-URL uploads

## Development

```bash
npm install
npm run build       # ESM + CJS + type declarations
npm run typecheck
npm test            # contract pin: typecheck:contract + build + node --test
npm run dev         # watch mode
```

## Links

- [Ghayma Dashboard](https://dash.ghayma.cloud)
- [Documentation](https://docs.ghayma.cloud)
- [GitHub Repository](https://github.com/bz-reda/Ghayma-Admin-SDK)
- [Report an Issue](https://github.com/bz-reda/Ghayma-Admin-SDK/issues)

## License

MIT © [Ghayma](https://ghayma.cloud)
