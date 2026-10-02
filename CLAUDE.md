# CLAUDE.md

> **Source of truth — Ghayma-Architect.** Before changing platform behavior, read the relevant page in the Ghayma-Architect repo (sibling folder `Ghayma-Architect/`); update it in the same work-cycle after merging a behavior change. Every PR here carries the `Ghayma-Architect updated / not needed` checkbox.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Ghayma SDK (`@ghayma/sdk`) is the runtime SDK an app running on Ghayma imports. Two entry points: the **server** entry (`@ghayma/sdk`, holds a project API key `gsk_…`: auth-app user administration, storage helpers, database connection details) and the **client** entry (`@ghayma/sdk/client`, browser: `GhaymaAuth` end-user login, sessions, 2FA — the code that shipped as `@ghayma/auth`). Infrastructure management (creating or deleting buckets, databases and auth apps, rotation, expose, backups) is NOT in this package: it lives in the console and the `ghayma` CLI. Zero runtime dependencies — uses native `fetch` (Node 18+).

## Commands

```bash
npm run build              # Production build via tsup (ESM + CJS + .d.ts)
npm run dev                # Watch mode for development
npm run typecheck          # Type-check src without emitting
npm run typecheck:contract # Also type-check test/types.contract.ts
npm test                   # Contract pin: typecheck:contract + build + node --test
```

No linter is configured.

**Contract tests (`test/`).** Zero-dependency, using Node's built-in test
runner — there is no test framework to install.

- `test/contract.test.mjs` stubs `globalThis.fetch` and runs the **built
  `dist/`**, asserting the request the SDK sends and the value it returns
  from a real backend payload. Add a case here whenever a method touches a
  request field, query parameter, or response wrapper key.
- `test/types.contract.ts` assigns real backend payloads to the SDK's
  response types. Object-literal excess-property checking makes this a
  two-way pin: a missing property means the SDK invented a field, an
  excess one means the SDK is missing a field the backend sends.
- `test/fixtures.mjs` holds the payloads, each cited to the Go struct it
  was transcribed from. Update these when `paas-api` changes a response.

## Architecture

```
src/
├── http.ts             # HttpClient base class + GhaymaError + ClientConfig (credential resolution, warning)
├── index.ts            # Ghayma facade class (server entry), re-exports the server public API
├── client/             # Browser entry (@ghayma/sdk/client): GhaymaAuth, TokenManager, AuthError, types
│   ├── index.ts        #   moved in verbatim from @ghayma/auth; never imports http.ts or the server modules
│   ├── client.ts       #   auth-service HTTP client (X-Ghayma-Server-Key / X-Ghayma-Client-IP)
│   ├── token.ts        #   TokenManager (memory / localStorage)
│   └── types.ts
├── storage/
│   ├── index.ts        # StorageClient (list/get buckets, credentials, objects, presigned URLs, download)
│   └── types.ts        # Bucket, StorageObject, PresignedUrl, etc.
├── auth/
│   ├── index.ts        # AuthClient (auth-app USER administration: users, roles, reset links, stats)
│   └── types.ts        # AuthApp, AuthUser, etc.
└── database/
    ├── index.ts        # DatabaseClient (list/get, credentials, connection, metrics)
    └── types.ts        # Database, DatabaseCredentials, DatabaseEngine, etc.
```

**Key pattern:** `Ghayma` is the server facade. It creates an `HttpClient` and injects it into `StorageClient`, `AuthClient`, and `DatabaseClient`. All HTTP concerns (credential header, retries, timeouts, error parsing) live in `HttpClient`. The credential is `apiKey` → deprecated `apiToken` → `GHAYMA_API_KEY`; a `gh_`/`et_` account token still works but warns once per process. The client entry is independent: it talks to the auth service with an app slug and never holds the project key.

**Backward-compat aliases:** `Ghayma` is re-exported as the deprecated `EspaceTech`, and `GhaymaError` as the deprecated `EspaceError`, so consumers migrate with only a package-name change.

## Build System

- **tsup** builds five entry points (`index`, `storage/index`, `auth/index`, `database/index`, `client/index`) into both ESM and CJS with type declarations, source maps, tree-shaking, and code splitting.
- Package exports allow importing submodules directly: `@ghayma/sdk/storage`, and the browser half as `@ghayma/sdk/client`.
- `npm test` also runs the client suites under `test/client/` (copied with the client code).

## Key Conventions

- All API paths follow `/api/v1/{resource}/{id}/{action}`.
- `GhaymaError` carries structured info: `message`, `status`, `code`, `details`.
- Retries use exponential backoff with jitter, only on 5xx or network errors.
- `rawFetch` is used for streaming responses (file downloads) — separate from the JSON `request` method.
- Environment variable `GHAYMA_API_URL` overrides the default base URL (for internal cluster routing) — an explicitly-passed `baseUrl` always wins; the legacy `ESPACE_API_URL` is still read as a fallback.
- The client entry resolves its server key as: explicit `serverKey` → `GHAYMA_AUTH_SERVER_KEY_<SLUG>` → `GHAYMA_AUTH_SERVER_KEY` → legacy `ESPACETECH_AUTH_SERVER_KEY_<SLUG>` → `ESPACETECH_AUTH_SERVER_KEY`, and never in a browser. An empty variable counts as unset.
- Legacy `ESPACE*` env names are silent fallbacks: keep them in code and tests, never in the README, public JSDoc, error messages or CHANGELOG. The storage key `espace_auth_session` and lock name `espace_auth_session:lock` are never renamed — that would sign every user out.
- The server entry targets Node and edge runtimes; the client entry targets browsers (and servers holding a `serverKey`). Both use `globalThis` and guard `process.env` access.
- Publishing is the operator's step (`npm publish`, 2FA). After a release that changes the client entry, the `@ghayma/auth` alias package (Ghayma-Auth-SDK) re-exports `@ghayma/sdk/client` and follows.
