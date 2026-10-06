/**
 * Shape guard, not a full validator: the characters an IPv4/IPv6 literal can
 * use, plus an optional zone id. Enough to drop a comma-joined
 * `x-forwarded-for` chain, "unknown", or anything carrying control characters.
 */
export const IP_LITERAL = /^[0-9a-fA-F.:]+(%[0-9a-zA-Z._-]+)?$/;

/** Anything an incoming request's headers can be read from. */
export type ClientIpSource =
  | Request
  | Headers
  | { headers: Headers | Record<string, string | string[] | undefined> };

/**
 * The visitor's IP for a request your app received on Ghayma, read from the
 * `x-real-ip` header. Ghayma's edge overwrites that header on every request,
 * so no visitor can forge it there. If the app is also reachable another way
 * (another host, its own proxy), that path must overwrite it too, or the
 * value must not be trusted there.
 *
 * `undefined` unless the header holds one valid IPv4 or IPv6 address — never
 * a guess from `x-forwarded-for` or the socket, which on Ghayma name the
 * platform.
 */
export function getClientIp(source: ClientIpSource): string | undefined {
  const raw = readHeader(source, "x-real-ip")?.trim();
  return raw && (isIPv4(raw) || isIPv6(raw)) ? raw : undefined;
}

/** Four decimal octets, each 0–255, with no leading zeros. */
function isIPv4(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
}

/** No zone id; the URL parser checks the rest (not node:net, so this runs in browsers and edge runtimes). */
function isIPv6(value: string): boolean {
  if (!value.includes(":") || value.includes("%") || !IP_LITERAL.test(value)) return false;
  try {
    new URL(`http://[${value}]`);
    return true;
  } catch {
    return false;
  }
}

function readHeader(source: ClientIpSource, name: string): string | undefined {
  // A request's own headers if it has them; otherwise the source is the headers
  const headers: unknown = (source as { headers?: unknown })?.headers ?? source;
  if (!headers || typeof headers !== "object") return undefined;

  let value: unknown;
  if (typeof (headers as { get?: unknown }).get === "function") {
    value = (headers as { get(name: string): unknown }).get(name);
  } else {
    // Node lowercases header names; a hand-built object may not
    const keys = Object.keys(headers).filter((key) => key.toLowerCase() === name);
    value = keys.length === 1 ? (headers as Record<string, unknown>)[keys[0]] : undefined;
  }

  if (Array.isArray(value)) return value.length === 1 && typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}
