# Changelog

Releases before 0.6.0 are documented in the git history.

## 1.5.0

The client entry reads the auth server key under its Ghayma names.

### Added

- **`GHAYMA_AUTH_SERVER_KEY_<SLUG>`** and **`GHAYMA_AUTH_SERVER_KEY`** — with
  no `serverKey` option, a `GhaymaAuth` built in server code reads the
  slug-scoped name, then the bare one. `<SLUG>` is the app slug uppercased,
  every other character turned into `_` (`my-app` → `MY_APP`). Ghayma injects
  both into connected apps; the bare one holds the key of the oldest auth app
  connected to the site.

### Notes

- The variable names used before are still read, after the Ghayma ones, so
  an app deployed before Ghayma injected the new names keeps its key without
  a change. The same goes for `GHAYMA_API_URL` on the server entry.
- An empty variable counts as unset, so it never hides the one after it.
- Browsers still never read a key from the environment. No API changes.
- `@ghayma/auth` depends on `@ghayma/sdk` `^1.1.0`, so a fresh install or a
  lockfile update resolves this release.

## 1.4.0

Tabs that share a session no longer sign the user out everywhere. The auth
service rotates refresh tokens, and a rotated one presented again ends every
session of the user. Two tabs refreshing the same stored session did exactly
that, intermittently, since every tab timed its refresh for the same moment
and background tabs run their timers late.

### Fixed

- **`refreshToken()`** sends one request at a time per client. Concurrent
  calls share it, including the refreshes `getUser()` and the other
  authenticated methods start for an expired token.
- With `storage: "localStorage"`, tabs take turns refreshing, and each one
  re-reads the stored session first. A tab that finds a pair another tab
  already rotated in takes it over instead of spending the old token; one
  that finds the session gone signs out (`SIGNED_OUT`) without a request.
  The turns use Web Locks (`navigator.locks`), or, where a browser has none
  (an insecure context, an old browser), a lease in localStorage that the
  waiting tabs watch through `storage` events.
- **`logout()`** revokes the newest refresh token, which another tab may
  have rotated in, rather than this tab's older copy.
- A pair that cannot be written to localStorage (quota exceeded) no longer
  leaves the spent one there for another tab to present.
- `storage: "localStorage"` on Node 26+ started without
  `--localstorage-file` no longer throws from the constructor; the session
  is kept in memory.

### Notes

- No API changes. Taking over another tab's pair emits `TOKEN_REFRESHED`,
  as a refresh would; finding the session gone rejects with "No refresh
  token available", as calling `refreshToken()` without a session does.
- Memory sessions (the default, and the only kind on servers and React
  Native) take no lock and read no storage.
- A tab still running an older build takes no part until it reloads.
- `@ghayma/auth` 0.8.0 depends on `@ghayma/sdk` `^1.1.0`, so a fresh install
  or a lockfile update resolves this release; the alias needs no release.

## 1.3.0

The auth service now asks the app's second factor on OAuth sign-in too, as
`POST /login` always has. The client entry surfaces that step as an error
instead of a session.

### Added

- **`TwoFactorRequiredError`** — an `AuthError` whose `code` is
  `two_fa_required` or `two_fa_enrollment_required` and whose `result` holds
  the pending step, the shape `login()` resolves to. Finish with `verify2FA`,
  or with `enrollTotp` + `confirmTotp`.

### Changed

- **`exchangeCodeForSession`**, **`signInWithIdToken`**,
  **`handleOAuthFragment`** and **`handleOAuthRedirect`** throw
  `TwoFactorRequiredError` when the app's 2FA policy applies to the user. No
  session is stored and no `SIGNED_IN` fires; a fragment carrying the step is
  cleared from the address bar all the same.

### Fixed

- `handleOAuthRedirect` clears the PKCE verifier and the spent `?code=`
  whatever the exchange answers, not only when it succeeds, so running it
  again on the callback page returns `false` instead of throwing
  `invalid_grant`.

### Notes

- Signatures are unchanged, and nothing changes for users without a second
  factor. An app with 2FA should catch the error on its callback page (see
  the README): 1.2.0 read the fragment as a failed sign-in, and the PKCE and
  ID-token answers as a session without tokens.
- `AuthError.code` now documents `email_not_verified`, the 403
  `signInWithIdToken` answers when Google has not verified the email.

## 1.2.0

The client entry gains the mobile OAuth flows the auth service already
speaks: PKCE one-time codes, and native sign-in with a provider ID token.

### Added

- **`generatePkce()` / `pkceChallenge()`** — RFC 7636 verifier and S256
  challenge, plus `PKCE_STORAGE_KEY`. WebCrypto only, no dependencies.
- **`getOAuthUrl(provider, params)`** — one builder for both providers.
  `getGoogleAuthUrl` and `getGitHubAuthUrl` now accept an optional
  `codeChallenge`, which switches the callback from a token fragment to a
  one-time `?code=`.
- **`signInWithOAuth(provider, { redirectUri, flow })`** — starts the
  redirect from the browser; `flow: "pkce"` parks the verifier in
  `sessionStorage` for the callback page.
- **`handleOAuthRedirect()`** — finishes the callback whichever way the
  provider came back: `?code=`, `?error=`, or the token fragment. Scrubs the
  spent code out of the address bar.
- **`exchangeCodeForSession({ code, codeVerifier })`** and
  **`signInWithIdToken({ provider, idToken, nonce })`** — the two new auth
  service endpoints, both taking `clientIp` like the other rate-limited calls.
- **`AuthApp.google_native_client_ids`** — the native client IDs the service
  accepts on `POST /oauth/id-token`.

### Notes

- Nothing changes for existing code: the default flow stays implicit,
  `handleOAuthFragment()` is untouched, and an OAuth URL built without a
  `codeChallenge` is byte-for-byte the one 1.1.0 produced.
- PKCE needs WebCrypto — a browser, or Node 19+.

## 1.1.0

First release of the runtime SDK on npm (1.0.0 was never published).

`@ghayma/sdk` is now the runtime SDK an app imports: a **server** entry that
holds a project API key, and a **client** entry for the browser. Managing
infrastructure moved out of the package to the console and the `ghayma` CLI,
which is why this release is breaking.

### Added

- **`@ghayma/sdk/client`** — the browser half of the SDK: `GhaymaAuth` signs
  your end users in with an app slug (login, registration, sessions, 2FA,
  OAuth, profile). It is the code that shipped as `@ghayma/auth`, moved in
  unchanged, and it never sees the project API key.
- **`apiKey`** — a project API key (`gsk_…`) from **Project → Settings → API
  keys**. Scoped to one project, which is what an app needs.
- **Zero-argument init** — `new Ghayma()` reads `GHAYMA_API_KEY`, the variable
  you set in your site's environment variables, so the app passes nothing at all. (Automatic injection arrives with Connections.)
- **Account-token warning** — passing a `gh_…` (or legacy `et_…`) credential
  logs one warning per process saying it acts as you across every project and
  pointing at project API keys.

### Removed

Each removed method has a home in the console at
[dash.ghayma.cloud](https://dash.ghayma.cloud) or in the `ghayma` CLI. Nothing
about the backend changed — these are still the same REST endpoints, they are
simply not part of an app's runtime surface.

**Auth**

- `auth.createApp()` → `ghayma auth create`, or the console's Auth page
- `auth.updateApp()` → `ghayma auth config`, or the console's Auth page
- `auth.deleteApp()` → `ghayma auth delete`, or the console's Auth page
- `auth.rotateKeys()` → `ghayma auth rotate-keys`, or the console's Auth page
- Types `CreateAuthAppOptions` and `UpdateAuthAppOptions` went with them.

**Storage**

- `storage.createBucket()` → `ghayma storage create`
- `storage.deleteBucket()` → `ghayma storage delete`
- `storage.rotateCredentials()` → `ghayma storage rotate`
- `storage.makePublic()` → `ghayma storage expose`
- `storage.makePrivate()` → `ghayma storage unexpose`
- Types `CreateBucketOptions` and `ExposeResult` went with them.

**Database**

- `database.create()` → `ghayma db create`
- `database.delete()` → `ghayma db delete`
- `database.stop()` / `database.start()` → `ghayma db stop` / `ghayma db start`
- `database.rotateCredentials()` → `ghayma db rotate`
- `database.expose()` / `database.unexpose()` → `ghayma db expose` / `ghayma db unexpose`
- `database.createBackup()`, `database.listBackups()`,
  `database.restoreBackup()`, `database.deleteBackup()` → the console's
  database Backups tab
- Types `CreateDatabaseOptions` and `DatabaseBackup` went with them.
  `BackupTierSlug` stays: it is the type of `Database.backup_tier_slug`.

### Deprecated

- **`apiToken`** — an account token still authenticates and now warns once per
  process. It acts as you across every project you can reach, so an app should
  hold a project API key instead:

  ```diff
  - const client = new Ghayma({ apiToken: process.env.GHAYMA_TOKEN! });
  + const ghayma = new Ghayma({ apiKey: process.env.GHAYMA_API_KEY! });
  + // or, in an app connected on Ghayma:
  + const ghayma = new Ghayma();
  ```

- **`@ghayma/auth`** — the package is deprecated and re-exports
  `@ghayma/sdk/client`. Existing code keeps working; migrate by changing the
  import:

  ```diff
  - import { GhaymaAuth } from "@ghayma/auth";
  + import { GhaymaAuth } from "@ghayma/sdk/client";
  ```

## 0.6.0

### Removed

- `database.link()` and `database.unlink()`. A managed database now belongs to
  exactly one project for its whole life, so there is nothing to link or
  unlink — the project is chosen at creation (`database.create({ project_id })`)
  and never changes. The backend endpoints `POST /api/v1/databases/:id/link`
  and `POST /api/v1/databases/:id/unlink` are removed in the same release, so
  these methods could only ever return a 404.

  There is no replacement. Create the database in the project that needs it.
