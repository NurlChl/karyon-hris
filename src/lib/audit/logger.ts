import AuditLog from "@/models/AuditLog";
import { connectToDatabase, isDbConnected } from "../db";

/** Arbitrary JSON-ish payload captured as the before/after snapshot. */
export type AuditPayload = Record<string, unknown> | null;

interface LogOptions {
  userId?: string | null;
  action: string;
  module: string;
  before?: AuditPayload;
  after?: AuditPayload;
  ip?: string;
  userAgent?: string;
}

/**
 * Appends an entry to the audit trail.
 *
 * Never throws and never blocks the caller's business logic: an audit write
 * failing must not turn a successful clock-in into an error for the employee.
 * Callers use `void logActivity(...)` for exactly that reason.
 */
export async function logActivity({
  userId = null,
  action,
  module,
  before = null,
  after = null,
  ip = "",
  userAgent = "",
}: LogOptions): Promise<void> {
  try {
    await connectToDatabase();

    if (!isDbConnected()) {
      console.warn(`[AUDIT] database offline — entri ${module}:${action} tidak tersimpan.`);
      return;
    }

    await AuditLog.create({
      userId,
      action,
      module,
      before: sanitize(before),
      after: sanitize(after),
      ip,
      userAgent: userAgent.slice(0, 400),
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[AUDIT] gagal menyimpan entri:", (error as Error).message);
  }
}

/**
 * Strips credential-shaped fields before they reach the log.
 *
 * The audit trail is read by more people than the records it describes, so a
 * password hash or token that leaked into a `before`/`after` snapshot would be
 * more exposed there than in its original table.
 */
const REDACTED_KEYS = /(?:password|passwd|pwd|secret|token|credential|api[_-]?key|private[_-]?key|twoFactor|codeHash|signature|^sig$|^code$)/i;

function sanitize(value: AuditPayload): AuditPayload {
  if (!value || typeof value !== "object") return value;

  const walk = (input: unknown, depth = 0): unknown => {
    if (depth > 6) return "[kedalaman dibatasi]";
    if (input === null || typeof input !== "object") return input;
    if (Array.isArray(input)) return input.slice(0, 50).map((v) => walk(v, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.test(key) ? "[disunting]" : walk(val, depth + 1);
    }
    return out;
  };

  return walk(value) as AuditPayload;
}
