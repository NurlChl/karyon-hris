import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { attachmentInputSchema } from "@/lib/attachments";
import { resolveSingleAttachment } from "@/lib/uploads";
import { notifyUsers, resolveRecipientForEmployee } from "@/lib/notification/notify";
import KpiEvaluation from "@/models/KpiEvaluation";
import Employee from "@/models/Employee";

/**
 * An appraisal done outside the system (the company's own form, a scanned
 * signed sheet) attached per employee as a PDF. It follows the same flow as a
 * form appraisal: draft, shared with the employee, acknowledged, finalized.
 */
const schema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  period: z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]|S[12]))?$/, "Periode: 2026, 2026-07, 2026-Q3, atau 2026-S1"),
  periodType: z.enum(["monthly", "quarterly", "semester", "annual"]).default("quarterly"),
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(120),
  file: attachmentInputSchema,
  finalScore: z.number().min(0).max(100).nullable().optional(),
  gradeLabel: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(2000).default(""),
  share: z.boolean().default(true),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "kpi", "write");
  const body = await parseBody(req, schema);

  const employee = await Employee.findById(body.employeeId).select("name").lean<{ name: string } | null>();
  if (!employee) throw NotFound("Karyawan tidak ditemukan.");

  const existing = await KpiEvaluation.findOne({ employeeId: body.employeeId, period: body.period, templateId: null });
  if (existing && existing.status === "finalized") {
    throw Conflict("Penilaian unggahan untuk periode ini sudah final dan tidak dapat diganti.");
  }

  const key = await resolveSingleAttachment({
    input: body.file,
    context: "document",
    ownerUserId: ctx.user.id,
    destination: `employees/${body.employeeId}/kpi`,
  });

  const now = new Date();
  const doc = await KpiEvaluation.findOneAndUpdate(
    { employeeId: body.employeeId, period: body.period, templateId: null },
    {
      source: "uploaded",
      title: body.title,
      periodType: body.periodType,
      uploadedFile: key,
      uploadedFileName: body.file.kind === "file" ? body.file.name ?? `${body.title}.pdf` : "Tautan dokumen",
      scores: [],
      finalScore: body.finalScore ?? 0,
      gradeLabel: body.gradeLabel,
      notes: body.notes,
      status: body.share ? "submitted" : "draft",
      submittedAt: body.share ? now : null,
      evaluatorId: new RecordId(ctx.user.id),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (body.share) {
    const recipients = await resolveRecipientForEmployee(body.employeeId);
    void notifyUsers(recipients, {
      kind: "system",
      title: `Hasil penilaian kinerja ${body.period} sudah tersedia`,
      body: `${body.title}. Buka dokumennya dan berikan tanggapan Anda.`,
      href: "/portal/kpi",
    });
  }

  void logActivity({
    userId: ctx.user.id,
    action: "UPLOAD_KPI_EVALUATION",
    module: "kpi",
    after: { employee: employee.name, period: body.period, title: body.title, share: body.share },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { _id: doc._id },
    `Penilaian ${employee.name} periode ${body.period} ${body.share ? "dibagikan ke karyawan" : "disimpan sebagai draf"}.`
  );
});
