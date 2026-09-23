import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import Notification, { type NotificationKind } from "@/models/Notification";
import User from "@/models/User";
import Role from "@/models/Role";
import Employee from "@/models/Employee";
import { connectToDatabase } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { sendEmail, sendWhatsapp } from "./notificationService";

/**
 * One entry point for "tell these people something happened".
 *
 * Callers never touch the transport directly: this decides which channels are
 * switched on in the CMS, writes the in-app record, and fires email/WhatsApp
 * without letting a provider outage fail the business action that triggered it.
 */

export interface NotifyPayload {
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  refType?: string;
  refId?: RecordId | string;
  /** Skip email even when the channel is on (e.g. very chatty events). */
  emailOptOut?: boolean;
}

interface Recipient {
  userId: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

function emailShell(title: string, body: string, href?: string, companyName = "HRIS") {
  const link = href ? `${process.env.NEXTAUTH_URL ?? ""}${href}` : "";
  return `<!doctype html><html lang="id"><body style="margin:0;background:#f6f7f9;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:540px;background:#fff;border:1px solid #e3e7ed;border-radius:12px;overflow:hidden">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #e3e7ed;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#55637a">${escapeHtml(companyName)}</td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:17px;line-height:1.4">${escapeHtml(title)}</h1>
        <p style="margin:0;font-size:14px;line-height:1.65;color:#55637a">${escapeHtml(body)}</p>
        ${link ? `<p style="margin:24px 0 0"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600">Buka di HRIS</a></p>` : ""}
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f6f7f9;font-size:11px;color:#7b8798">Email ini dikirim otomatis oleh sistem HRIS. Mohon tidak membalas email ini.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** Escapes user-supplied text before it enters an HTML email body. */
export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Sends to explicit recipients. Never throws — notification is best-effort. */
export async function notifyUsers(recipients: Recipient[], payload: NotifyPayload): Promise<void> {
  if (!recipients.length) return;

  try {
    await connectToDatabase();
    const settings = await getSettings();
    const companyName = String(settings.company_name ?? "HRIS");

    if (settings.notify_inapp_enabled) {
      await Notification.insertMany(
        recipients.map((r) => ({
          userId: r.userId,
          kind: payload.kind,
          title: payload.title,
          body: payload.body,
          href: payload.href ?? "",
          refType: payload.refType,
          refId: payload.refId,
        })),
        { ordered: false }
      );
    }

    if (settings.notify_email_enabled && !payload.emailOptOut) {
      for (const r of recipients) {
        if (!r.email) continue;
        void sendEmail({
          to: r.email,
          subject: `[${companyName}] ${payload.title}`,
          html: emailShell(payload.title, payload.body, payload.href, companyName),
        }).catch((e) => console.error("[NOTIFY] email failed:", e?.message));
      }
    }

    if (settings.notify_whatsapp_enabled) {
      for (const r of recipients) {
        if (!r.phone) continue;
        void sendWhatsapp({
          to: r.phone,
          message: `*${payload.title}*\n\n${payload.body}`,
        }).catch((e) => console.error("[NOTIFY] whatsapp failed:", e?.message));
      }
    }
  } catch (err) {
    console.error("[NOTIFY] dispatch failed:", (err as Error).message);
  }
}

/** Resolves users by id, merging in contact details from their employee record. */
export async function resolveRecipientsByUserIds(userIds: Array<string | RecordId>) {
  await connectToDatabase();
  const users = await User.find({ _id: { $in: userIds }, isActive: { $ne: false } })
    .select("email phone employeeId")
    .lean<Array<{ _id: RecordId; email: string; phone?: string; employeeId?: RecordId }>>();

  const employeeIds = users.map((u) => u.employeeId).filter(Boolean);
  const employees = employeeIds.length
    ? await Employee.find({ _id: { $in: employeeIds } })
        .select("name personalEmail phone")
        .lean<Array<{ _id: RecordId; name: string; personalEmail?: string; phone?: string }>>()
    : [];
  const empMap = new Map(employees.map((e) => [e._id.toString(), e]));

  return users.map((u) => {
    const emp = u.employeeId ? empMap.get(u.employeeId.toString()) : undefined;
    return {
      userId: u._id.toString(),
      email: u.email || emp?.personalEmail || null,
      phone: u.phone || emp?.phone || null,
      name: emp?.name ?? null,
    } satisfies Recipient;
  });
}

/** Resolves the user account attached to an employee, if any. */
export async function resolveRecipientForEmployee(employeeId: string | RecordId) {
  await connectToDatabase();
  const user = await User.findOne({ employeeId, isActive: { $ne: false } }).select("_id").lean<{ _id: RecordId } | null>();
  if (!user) return [];
  return resolveRecipientsByUserIds([user._id]);
}

/**
 * Resolves every holder of a role, optionally narrowed to one division — how an
 * SPV step reaches only the supervisors of the requester's own division rather
 * than every supervisor in the company.
 */
export async function resolveRecipientsByRole(
  roleName: string,
  opts: { divisionId?: string | null; branchId?: string | null } = {}
) {
  await connectToDatabase();
  const role = await Role.findOne({ name: roleName }).select("_id").lean<{ _id: RecordId } | null>();
  if (!role) return [];

  const users = await User.find({ roleId: role._id, isActive: { $ne: false } })
    .select("_id employeeId")
    .lean<Array<{ _id: RecordId; employeeId?: RecordId }>>();

  let filtered = users;
  if (opts.divisionId || opts.branchId) {
    const empIds = users.map((u) => u.employeeId).filter(Boolean);
    const scopeQuery: Record<string, unknown> = { _id: { $in: empIds } };
    if (opts.divisionId) scopeQuery.divisionId = opts.divisionId;
    if (opts.branchId) scopeQuery.branchId = opts.branchId;
    const scoped = await Employee.find(scopeQuery).select("_id").lean<Array<{ _id: RecordId }>>();
    const allowed = new Set(scoped.map((e) => e._id.toString()));
    const narrowed = users.filter((u) => u.employeeId && allowed.has(u.employeeId.toString()));
    // A scoped step with no local approver falls back to every role holder so a
    // request is never silently stranded with nobody able to action it.
    filtered = narrowed.length ? narrowed : users;
  }

  return resolveRecipientsByUserIds(filtered.map((u) => u._id));
}
