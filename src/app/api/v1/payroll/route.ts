import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireCompanyPermission as requirePermission,
  parseBody,
  employeeRecordScopeFilter,
  BadRequest,
  Forbidden,
  pagination,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { formatPeriod, formatRupiah, wibPeriodKey } from "@/lib/time";
import { escapeHtml } from "@/lib/notification/notify";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { attachmentInputSchema } from "@/lib/attachments";
import { notifyUsers, resolveRecipientForEmployee } from "@/lib/notification/notify";
import Payroll from "@/models/Payroll";
import Employee from "@/models/Employee";
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const period = sp.get("period");
  const { page, limit, skip } = pagination(req, 25, 100);

  const perm = await checkPermission(ctx.user.id, "payroll", "read");

  const filter: Record<string, unknown> = {};
  if (period) filter.period = period;
  const status = sp.get("status");
  if (status && ["draft", "published", "paid"].includes(status)) filter.status = status;

  // Narrow grants follow assigned membership; self-service remains pinned to
  // the caller. Narrow readers never see in-progress draft slips.
  if (!perm.allowed || perm.scope !== "all") {
    if (!ctx.user.employeeId) {
      return apiSuccess([], "Akun ini tidak tertaut ke data karyawan");
    }
    Object.assign(filter, await employeeRecordScopeFilter({ ...ctx, permission: perm }));
    if (perm.scope === "self" || !perm.allowed) filter.employeeId = ctx.user.employeeId;
    // Employees only see published slips, never in-progress drafts.
    filter.status = "published";
  }

  const [payrolls, total] = await Promise.all([
    Payroll.find(filter)
      .populate("employeeId", "name employeeId divisionId branchId")
      .populate("generatedBy", "email")
      .sort({ period: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payroll.countDocuments(filter),
  ]);

  // The slip file itself is only ever handed over as a short-lived signed link.
  const withLinks = await Promise.all(
    payrolls.map(async (p) => ({
      ...p,
      fileUrl: p.fileUrl ? await storageProvider.getSignedUrl(p.fileUrl as string, 900) : "",
      uploadedFile: await attachmentRefHref(p.uploadedFile as string | undefined),
    }))
  );

  return apiSuccess(withLinks, "Berhasil memuat data slip gaji", { page, limit, total });
});
export const POST = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const PATCH = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const DELETE = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
