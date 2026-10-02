// Every tab of an origin shares the session in localStorage, and the auth
// service ends all of a user's sessions when a refresh token it already
// rotated comes back. Spending that token is a cross-tab critical section.

const LEASE_TTL_MS = 20_000; // outlives a refresh request (15 s timeout)
const SETTLE_MS = 100; // a racing tab's claim lands within this
const POLL_MS = 250; // clients in the same tab get no storage event

interface Lease {
  id: string;
  until: number; // Unix ms
}

/**
 * Run `fn` while no other tab holds the lock `name`: Web Locks where the
 * runtime has them, else a lease kept in `storage` under the same name.
 */
export async function withLock<T>(name: string, storage: Storage, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator?.locks;
  if (typeof locks?.request === "function") {
    return locks.request(name, fn);
  }
  return withLease(name, storage, fn);
}

/**
 * Best effort without Web Locks: localStorage has no compare-and-set, so a
 * tab claims the lease, lets a racing claim land, and goes ahead only if its
 * own claim is still the one stored. The others wait for the release.
 */
async function withLease<T>(key: string, storage: Storage, fn: () => Promise<T>): Promise<T> {
  const id = Math.random().toString(36).slice(2);
  for (;;) {
    const held = readLease(storage, key);
    if (held) {
      await leaseChanged(key, Math.min(held.until - Date.now(), POLL_MS));
      continue;
    }
    // A store that refuses writes cannot coordinate: go ahead unguarded
    if (!writeLease(storage, key, { id, until: Date.now() + LEASE_TTL_MS })) break;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const claim = readLease(storage, key);
    if (!claim || claim.id === id) break;
  }

  try {
    return await fn();
  } finally {
    if (readLease(storage, key)?.id === id) {
      try {
        storage.removeItem(key);
      } catch {
        // unavailable — the lease runs out on its own
      }
    }
  }
}

/** The live lease, or null. One past its time belongs to a tab that closed mid-refresh. */
function readLease(storage: Storage, key: string): Lease | null {
  try {
    const lease = JSON.parse(storage.getItem(key) ?? "null") as Lease | null;
    const now = Date.now();
    // Further out than any lease is written for: the clock moved back
    return lease && lease.until > now && lease.until <= now + LEASE_TTL_MS ? lease : null;
  } catch {
    return null;
  }
}

function writeLease(storage: Storage, key: string, lease: Lease): boolean {
  try {
    storage.setItem(key, JSON.stringify(lease));
    return true;
  } catch {
    return false;
  }
}

/** Resolve when another tab writes or removes `key`, or after `ms`. */
function leaseChanged(key: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const events = typeof globalThis.addEventListener === "function";
    const done = () => {
      clearTimeout(timer);
      if (events) globalThis.removeEventListener("storage", onStorage);
      resolve();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) done();
    };
    const timer = setTimeout(done, ms);
    if (events) globalThis.addEventListener("storage", onStorage);
  });
}
