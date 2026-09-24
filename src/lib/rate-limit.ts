/**
 * Sliding-window rate limiter.
 *
 * Backed by an in-process Map so it works on a single VPS/dev machine with no
 * Redis. That is deliberately a *soft* defence: behind multiple instances each
 * process keeps its own counters, so the effective limit multiplies by the
 * instance count. Swap `hit()` for a Redis INCR/EXPIRE when the app is scaled
 * horizontally — every caller already goes through this one function.
 */

interface Bucket {
  hits: number[];
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/**
 * Ceiling on tracked buckets.
 *
 * Every distinct key holds a small array of timestamps. A few thousand staff
 * across a handful of scopes is nowhere near this, so the cap exists purely to
 * stop an attacker minting unbounded keys — each forged address would otherwise
 * be a permanent allocation.
 */
const MAX_BUCKETS = 50_000;

/** Timestamps kept per bucket, so one key cannot grow without limit either. */
const MAX_HITS_PER_BUCKET = 512;

/**
 * Drops idle buckets so a long-running process does not grow unboundedly.
 *
 * Runs at most once a minute, and only walks the map when it is actually large
 * enough to matter — with a few hundred active staff this does nothing at all.
 */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;

  for (const [key, b] of buckets) {
    const newest = b.hits[b.hits.length - 1] ?? 0;
    if (now - newest > 3_600_000 && now > b.blockedUntil) buckets.delete(key);
  }

  // Still over the cap after dropping idle entries: evict the least recently
  // used. Evicting forgives whoever is dropped, which is the right way to fail
  // — a rate limiter that runs out of memory protects nothing at all.
  if (buckets.size > MAX_BUCKETS) {
    const byAge = [...buckets.entries()].sort(
      (a, b) => (a[1].hits[a[1].hits.length - 1] ?? 0) - (b[1].hits[b[1].hits.length - 1] ?? 0)
    );
    for (let i = 0; i < byAge.length - MAX_BUCKETS; i++) buckets.delete(byAge[i][0]);
    console.warn(
      `[RATE] Jumlah bucket melewati ${MAX_BUCKETS}; entri terlama dibuang. ` +
        "Pertimbangkan backend Redis bila ini berulang."
    );
  }
}

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Allowed requests inside the window. */
  max: number;
  /** How long to block once the limit is exceeded (defaults to windowMs). */
  blockMs?: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds the caller should wait before retrying. */
  retryAfter: number;
}

export function rateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [], blockedUntil: 0 };
    buckets.set(key, bucket);
  }

  if (now < bucket.blockedUntil) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }

  const windowStart = now - rule.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= rule.max) {
    bucket.blockedUntil = now + (rule.blockMs ?? rule.windowMs);
    return { ok: false, remaining: 0, retryAfter: Math.ceil((rule.blockMs ?? rule.windowMs) / 1000) };
  }

  bucket.hits.push(now);
  if (bucket.hits.length > MAX_HITS_PER_BUCKET) {
    bucket.hits = bucket.hits.slice(-MAX_HITS_PER_BUCKET);
  }
  return { ok: true, remaining: rule.max - bucket.hits.length, retryAfter: 0 };
}

/** Clears a bucket — used after a successful login so a valid user isn't punished. */
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/** Common presets, so limits stay consistent across routes. */
export const RATE_RULES = {
  /** Login / password reset — strict, blocks for 15 minutes. */
  auth: { windowMs: 10 * 60_000, max: 8, blockMs: 15 * 60_000 } satisfies RateLimitRule,
  /** Wider per-address login budget; account limits remain stricter. */
  loginIp: { windowMs: 10 * 60_000, max: 30, blockMs: 15 * 60_000 } satisfies RateLimitRule,
  /** OTP email sends — protects against mail-provider abuse. */
  otp: { windowMs: 60 * 60_000, max: 5, blockMs: 30 * 60_000 } satisfies RateLimitRule,
  /** Unauthenticated public endpoints (career form, public API). */
  publicWrite: { windowMs: 60 * 60_000, max: 10, blockMs: 60 * 60_000 } satisfies RateLimitRule,
  /** Authenticated writes that should not be spammed (clock-in, submissions). */
  write: { windowMs: 60_000, max: 20 } satisfies RateLimitRule,
  /** Generic authenticated reads. */
  read: { windowMs: 60_000, max: 120 } satisfies RateLimitRule,
} as const;

/* ------------------------------------------------------------------ */
/* Client address                                                      */
/* ------------------------------------------------------------------ */

/**
 * Marker for a caller whose address could not be determined.
 *
 * Kept distinct from a real address because the two must never be treated
 * alike: see `rateLimitKeyForIp`.
 */
export const UNKNOWN_IP = "unknown";

/** Loopback in its various spellings, normalised to one. */
const LOOPBACK = new Set(["::1", "127.0.0.1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]);

/**
 * Turns an address into the form a human should read in the audit log.
 *
 * IPv6-mapped IPv4 (`::ffff:203.0.113.9`) is written the way the address is
 * actually used, and every spelling of loopback collapses to `127.0.0.1` so the
 * audit trail never shows the bare `::1` that a local request produces.
 */
export function normaliseIp(raw: string | null | undefined): string {
  const ip = (raw ?? "").trim();
  if (!ip) return UNKNOWN_IP;

  // Strip a port from `ip:port`, but only for IPv4 — IPv6 is full of colons.
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  const bare = v4WithPort ? v4WithPort[1] : ip;

  const lower = bare.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK.has(lower)) return "127.0.0.1";

  // `::ffff:203.0.113.9` is an IPv4 address wearing an IPv6 costume.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) return mapped[1];

  return lower;
}

/**
 * Whether `x-forwarded-for` may be believed.
 *
 * The header is trivially forged by anyone talking to the app directly, so
 * trusting it unconditionally lets a single attacker spend everyone else's rate
 * limit — or, worse, write any address they like into the audit log. It is only
 * meaningful when a reverse proxy the operator controls (nginx, Traefik,
 * Cloudflare) appends to it on the way in, so the operator has to say so with
 * `TRUST_PROXY=1` (one proxy) or the number of proxies in front of the app,
 * e.g. `TRUST_PROXY=2` for Cloudflare → Traefik.
 */
const TRUST_PROXY_HOPS = (() => {
  const value = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (value === "true") return 1;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0;
})();

/**
 * Proxies append the address they received the connection from, so only the
 * right-most entries were written by infrastructure the operator trusts.
 * Everything to the left was supplied by the client and can be forged to
 * dodge per-address rate limits.
 */
export function forwardedClient(header: string, hops: number): string | null {
  const entries = header.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (hops < 1 || entries.length === 0) return null;
  return entries[Math.max(0, entries.length - hops)] ?? null;
}

/**
 * Best-effort client IP, normalised for display.
 *
 * Returns `UNKNOWN_IP` when there is nothing trustworthy to report, rather than
 * inventing an address. Callers that key a rate limit off this must go through
 * `rateLimitKeyForIp`.
 */
export function clientIp(req: Request): string {
  if (TRUST_PROXY_HOPS > 0) {
    const fwd = req.headers.get("x-forwarded-for");
    const client = fwd ? forwardedClient(fwd, TRUST_PROXY_HOPS) : null;
    if (client) return normaliseIp(client);
    const direct = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
    if (direct) return normaliseIp(direct);
  }

  // Not behind a trusted proxy. In development Next still sets the header for
  // local requests, which is how a request from this machine is recognised
  // rather than reported as unknown.
  const local = req.headers.get("x-forwarded-for");
  if (local && LOOPBACK.has(normaliseIp(local))) return "127.0.0.1";

  return UNKNOWN_IP;
}

/**
 * Builds a rate-limit key from an address.
 *
 * The important case is the one that used to be silently broken: when the
 * address is unknown, every caller in the world collapsed onto the single key
 * `"unknown"`, so one shared bucket governed all of them. On a public endpoint
 * capped at ten requests an hour, the eleventh applicant — a different person,
 * on a different continent — was turned away because of the first ten.
 *
 * Callers pass whatever weak signals they have; those form a coarse bucket so
 * strangers are at least spread across many keys instead of one. It is not a
 * real identity and is not treated as one: `sharedBucket` says so, and callers
 * use it to pick a limit generous enough that ordinary users are never caught.
 */
export function rateLimitKeyForIp(
  ip: string,
  hints: { userAgent?: string | null; language?: string | null } = {}
): { key: string; sharedBucket: boolean } {
  if (ip !== UNKNOWN_IP) return { key: ip, sharedBucket: false };

  const seed = `${hints.userAgent ?? ""}|${hints.language ?? ""}`;
  if (!seed.replace(/\|/g, "")) return { key: "anon:none", sharedBucket: true };

  // A short non-cryptographic digest: this only has to spread callers across
  // buckets, and it must never be mistaken for identifying anybody.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { key: `anon:${(h >>> 0).toString(36)}`, sharedBucket: true };
}
