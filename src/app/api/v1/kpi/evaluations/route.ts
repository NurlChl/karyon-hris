import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import { attachmentRefHref } from "@/lib/uploads";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import {
  requireUser,
  parseBody,
  pagination,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { notifyUsers, resolveRecipientForEmployee, resolveRecipientsByRole } from "@/lib/notification/notify";
import KpiTemplate from "@/models/KpiTemplate";
import KpiEvaluation from "@/models/KpiEvaluation";
import {
  SCORE_MODE_MAX,
  computeFinalScore,
  gradeFor,
  normaliseScore,
  type ScoreMode,
} from "@/lib/hr/kpi";
import Employee from "@/models/Employee";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");

/**
 * Appraisal lifecycle.
 *
 * Who may do what is decided by role *and* by the record's own state, not by
 * the permission flag alone: a supervisor can edit their own draft but not one
 * already acknowledged by the employee, and only the employee named on the
 * appraisal can acknowledge it.
 */

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const { page, limit, skip } = pagination(req, 50, 200);

  const id = sp.get("id");
  const mine = sp.get("mine") === "1";

  const perm = await checkPermission(ctx.user.id, "kpi", "read");

  /* --- single record --- */
  if (id) {
    const evaluation = await KpiEvaluation.findById(id)
      .populate({
        path: "employeeId",
        select: "name employeeId divisionId positionId branchId",
        populate: [
          { path: "divisionId", select: "name" },
          { path: "positionId", select: "name" },
          { path: "branchId", select: "name" },
        ],
      })
      .populate(
        "templateId",
        "name description periodType scoreMode aspects grades allowSelfAssessment showLogo logoUrl logoHeight"
      )
      .lean<Record<string, unknown> | null>();

    if (!evaluation) throw NotFound("Penilaian tidak ditemukan.");

    const owner = evaluation.employeeId as { _id?: unknown } | null;
    const isOwner = Boolean(owner?._id) && String(owner!._id) === ctx.user.employeeId;

    if (!isOwner && (!perm.allowed || perm.scope === "self")) {
      throw Forbidden("Anda tidak memiliki izin melihat penilaian ini.");
    }
    // A draft is the evaluator's working copy; the employee only sees it once
    // it has been submitted to them.
    if (isOwner && evaluation.status === "draft") {
      throw Forbidden("Penilaian ini masih disusun atasan Anda dan belum dibagikan.");
    }

    // The printed appraisal carries a letterhead. Company identity lives in
    // settings, which an employee cannot read directly, so it rides along here.
    const settings = await getSettings();
    const template = evaluation.templateId as
      | { showLogo?: boolean; logoUrl?: string; logoHeight?: number }
      | null;
    const branding = {
      companyName: String(settings.company_name ?? ""),
      companyAddress: String(settings.company_address ?? ""),
      showLogo: Boolean(template?.showLogo && template?.logoUrl),
      logoUrl: template?.logoUrl ?? "",
      logoHeight: template?.logoHeight ?? 14,
    };

    return apiSuccess(
      { ...evaluation, uploadedFile: await attachmentRefHref(evaluation.uploadedFile as string | undefined), branding },
      "Berhasil memuat penilaian"
    );
  }

  /* --- list --- */
  const filter: Record<string, unknown> = {};

  if (mine || !perm.allowed || perm.scope === "self") {
    if (!ctx.user.employeeId) return apiSuccess([], "Akun ini tidak tertaut ke data karyawan");
    filter.employeeId = ctx.user.employeeId;
    // Drafts never appear in the employee's own list.
    filter.status = { $ne: "draft" };
  } else if (perm.scope === "division" && ctx.user.divisionId) {
    const divisionEmployees = await Employee.find({ divisionId: ctx.user.divisionId })
      .select("_id")
      .lean<Array<{ _id: RecordId }>>();
    filter.employeeId = { $in: divisionEmployees.map((e) => e._id) };
  } else if (perm.scope === "branch" && ctx.user.branchId) {
    const branchEmployees = await Employee.find({ branchId: ctx.user.branchId })
      .select("_id")
      .lean<Array<{ _id: RecordId }>>();
    filter.employeeId = { $in: branchEmployees.map((e) => e._id) };
  }

  const period = sp.get("period");
  if (period) filter.period = period;
  const status = sp.get("status");
  if (status && status !== "all") filter.status = status;
  const employeeId = sp.get("employeeId");
  if (employeeId && !mine) filter.employeeId = employeeId;

  const [items, total] = await Promise.all([
    KpiEvaluation.find(filter)
      .populate({
        path: "employeeId",
        select: "name employeeId divisionId positionId",
        populate: [
          { path: "divisionId", select: "name" },
          { path: "positionId", select: "name" },
        ],
      })
      .populate("templateId", "name periodType scoreMode")
      .sort({ period: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<Array<Record<string, unknown>>>(),
    KpiEvaluation.countDocuments(filter),
  ]);

  const withFiles = await Promise.all(
    items.map(async (it) => (it.uploadedFile ? { ...it, uploadedFile: await attachmentRefHref(it.uploadedFile as string) } : it))
  );
  return apiSuccess(withFiles, "Berhasil memuat daftar penilaian", { page, limit, total });
});

/* ------------------------------------------------------------------ */
/* POST — create or update a draft, optionally submitting it             */
/* ------------------------------------------------------------------ */

const scoreInput = z.object({
  aspectKey: z.string().trim().min(1),
  indicatorKey: z.string().trim().min(1),
  rawScore: z.number().min(0),
  note: z.string().trim().max(1000).default(""),
});

const saveSchema = z.object({
  id: z.union([objectId, z.literal("")]).optional(),
  employeeId: objectId,
  templateId: objectId,
  period: z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]|S[1-2]))?$/, "Format periode tidak valid"),
  scores: z.array(scoreInput).min(1, "Isi minimal satu indikator"),
  strengths: z.string().trim().max(2000).default(""),
  improvements: z.string().trim().max(2000).default(""),
  developmentPlan: z.string().trim().max(2000).default(""),
  recommendation: z.enum(["promote", "retain", "monitor", "improve", "none"]).default("none"),
  notes: z.string().trim().max(2000).default(""),
  /** true saves and sends to the employee; false keeps it as a draft. */
  submit: z.boolean().default(false),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "kpi", "write");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin menilai karyawan.");

  const body = await parseBody(req, saveSchema);

  const [template, employee] = await Promise.all([
    KpiTemplate.findById(body.templateId).lean<{
      _id: RecordId;
      name: string;
      scoreMode: ScoreMode;
      periodType: string;
      aspects: Array<{
        key: string;
        name: string;
        weight: number;
        indicators: Array<{ key: string; name: string; weight: number }>;
      }>;
      grades: Array<{ min: number; label: string; tone: string }>;
      isActive: boolean;
    } | null>(),
    Employee.findById(body.employeeId)
      .select("name divisionId branchId status")
      .lean<{ name: string; divisionId?: RecordId; branchId?: RecordId; status: string } | null>(),
  ]);

  if (!template) throw NotFound("Template KPI tidak ditemukan.");
  if (!employee) throw NotFound("Karyawan tidak ditemukan.");

  // A division-scoped evaluator may only appraise their own division.
  if (perm.scope === "division" && ctx.user.divisionId) {
    if (String(employee.divisionId ?? "") !== ctx.user.divisionId) {
      throw Forbidden("Anda hanya dapat menilai karyawan di divisi Anda sendiri.");
    }
  }

  const max = SCORE_MODE_MAX[template.scoreMode] ?? 5;

  // The submitted scores are matched back against the template rather than
  // trusted as sent: names and weights come from the template, so a tampered
  // payload cannot invent an indicator or inflate its weight.
  const indicatorIndex = new Map<
    string,
    { aspectKey: string; aspectName: string; aspectWeight: number; name: string; weight: number }
  >();
  for (const aspect of template.aspects ?? []) {
    for (const indicator of aspect.indicators ?? []) {
      indicatorIndex.set(`${aspect.key}.${indicator.key}`, {
        aspectKey: aspect.key,
        aspectName: aspect.name,
        aspectWeight: aspect.weight,
        name: indicator.name,
        weight: indicator.weight,
      });
    }
  }

  const scores = [];
  for (const input of body.scores) {
    const meta = indicatorIndex.get(`${input.aspectKey}.${input.indicatorKey}`);
    if (!meta) continue; // indicator was removed from the template since
    if (input.rawScore > max) {
      throw BadRequest(`Nilai "${meta.name}" melebihi skala maksimum ${max}.`);
    }
    scores.push({
      aspectKey: meta.aspectKey,
      aspectName: meta.aspectName,
      aspectWeight: meta.aspectWeight,
      indicatorKey: input.indicatorKey,
      indicatorName: meta.name,
      indicatorWeight: meta.weight,
      rawScore: input.rawScore,
      score: normaliseScore(input.rawScore, max),
      note: input.note,
    });
  }

  if (!scores.length) {
    throw BadRequest("Tidak ada indikator yang cocok dengan template. Muat ulang formulir penilaian.");
  }

  const finalScore = computeFinalScore(scores);
  const grade = gradeFor(finalScore, template.grades);

  const base = {
    employeeId: body.employeeId,
    templateId: body.templateId,
    period: body.period,
    periodType: template.periodType,
    scoreMode: template.scoreMode,
    scores,
    finalScore,
    gradeLabel: grade?.label ?? "",
    strengths: body.strengths,
    improvements: body.improvements,
    developmentPlan: body.developmentPlan,
    recommendation: body.recommendation,
    notes: body.notes,
    evaluatorId: ctx.user.id,
    status: body.submit ? "submitted" : "draft",
    submittedAt: body.submit ? new Date() : null,
  };

  let evaluation;
  if (body.id) {
    const existing = await KpiEvaluation.findById(body.id);
    if (!existing) throw NotFound("Penilaian tidak ditemukan.");
    if (existing.status === "finalized") {
      throw Conflict("Penilaian ini sudah final dan tidak dapat diubah lagi.");
    }
    if (existing.status === "acknowledged" && !body.submit) {
      throw Conflict(
        "Karyawan sudah menanggapi penilaian ini. Ubah hanya bila Anda akan mengirim ulang hasilnya."
      );
    }
    Object.assign(existing, base);
    await existing.save();
    evaluation = existing;
  } else {
    const duplicate = await KpiEvaluation.findOne({
      employeeId: body.employeeId,
      templateId: body.templateId,
      period: body.period,
    }).lean();
    if (duplicate) {
      throw Conflict(
        `${employee.name} sudah memiliki penilaian dengan template ini untuk periode ${body.period}. Buka penilaian tersebut untuk mengubahnya.`
      );
    }
    evaluation = await KpiEvaluation.create(base);
  }

  if (body.submit) {
    const recipients = await resolveRecipientForEmployee(body.employeeId);
    void notifyUsers(recipients, {
      kind: "system",
      title: `Hasil penilaian kinerja ${body.period} sudah tersedia`,
      body: `Atasan Anda telah menyelesaikan penilaian "${template.name}". Buka untuk melihat hasil dan memberikan tanggapan.`,
      href: "/portal/kpi",
    });
  }

  void logActivity({
    userId: ctx.user.id,
    action: body.submit ? "SUBMIT_KPI_EVALUATION" : "SAVE_KPI_EVALUATION_DRAFT",
    module: "kpi",
    after: { employee: employee.name, period: body.period, finalScore },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id: evaluation._id, finalScore, gradeLabel: grade?.label ?? "" },
    body.submit
      ? `Penilaian ${employee.name} dikirim. Nilai akhir ${finalScore} (${grade?.label ?? "-"}). Karyawan menerima notifikasi untuk menanggapi.`
      : `Draf penilaian ${employee.name} tersimpan. Nilai sementara ${finalScore}.`
  );
});

/* ------------------------------------------------------------------ */
/* PATCH — acknowledge, return to draft, finalize                       */
/* ------------------------------------------------------------------ */

const actionSchema = z.object({
  id: objectId,
  action: z.enum(["acknowledge", "return", "finalize", "share"]),
  comment: z.string().trim().max(2000).optional(),
});

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, actionSchema);

  const evaluation = await KpiEvaluation.findById(body.id);
  if (!evaluation) throw NotFound("Penilaian tidak ditemukan.");

  const isOwner = String(evaluation.employeeId) === ctx.user.employeeId;
  const perm = await checkPermission(ctx.user.id, "kpi", "write");

  /* --- employee acknowledges --- */
  if (body.action === "acknowledge") {
    if (!isOwner) throw Forbidden("Hanya karyawan yang dinilai yang dapat menanggapi penilaian ini.");
    if (evaluation.status !== "submitted") {
      throw Conflict(
        evaluation.status === "draft"
          ? "Penilaian ini belum dibagikan kepada Anda."
          : "Penilaian ini sudah Anda tanggapi sebelumnya."
      );
    }

    evaluation.status = "acknowledged";
    evaluation.acknowledgedAt = new Date();
    evaluation.employeeComment = body.comment ?? "";
    await evaluation.save();

    // The evaluator and HR both need to know a response arrived, especially
    // when the employee disagrees.
    const [hrd, evaluatorRecipients] = await Promise.all([
      resolveRecipientsByRole("HRD"),
      evaluation.evaluatorId
        ? (await import("@/lib/notification/notify")).resolveRecipientsByUserIds([evaluation.evaluatorId])
        : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    const recipients = [...evaluatorRecipients, ...hrd].filter((r) =>
      seen.has(r.userId) ? false : (seen.add(r.userId), true)
    );
    void notifyUsers(recipients, {
      kind: "system",
      title: `Tanggapan penilaian ${evaluation.period}`,
      body: body.comment
        ? `Karyawan menanggapi hasil penilaiannya: "${body.comment.slice(0, 160)}"`
        : "Karyawan sudah membaca hasil penilaiannya tanpa catatan tambahan.",
      href: "/admin/kpi-dashboard",
    });

    void logActivity({
      userId: ctx.user.id,
      action: "ACKNOWLEDGE_KPI_EVALUATION",
      module: "kpi",
      after: { period: evaluation.period, hasComment: Boolean(body.comment) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return apiSuccess(
      { id: evaluation._id, status: evaluation.status },
      "Tanggapan Anda tersimpan dan diteruskan ke atasan serta HRD."
    );
  }

  /* --- share an uploaded draft with the employee --- */
  if (body.action === "share") {
    if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin mengubah penilaian.");
    if (evaluation.status !== "draft") throw Conflict("Penilaian ini sudah dibagikan.");
    evaluation.status = "submitted";
    evaluation.submittedAt = new Date();
    await evaluation.save();
    const recipients = await resolveRecipientForEmployee(evaluation.employeeId);
    void notifyUsers(recipients, {
      kind: "system",
      title: `Hasil penilaian kinerja ${evaluation.period} sudah tersedia`,
      body: `${evaluation.title || "Penilaian kinerja"}. Buka dokumennya dan berikan tanggapan Anda.`,
      href: "/portal/kpi",
    });
    return apiSuccess({ id: evaluation._id, status: "submitted" }, "Penilaian dibagikan ke karyawan.");
  }

  /* --- evaluator pulls it back --- */
  if (body.action === "return") {
    if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin mengubah penilaian.");
    if (evaluation.status !== "submitted") {
      throw Conflict("Hanya penilaian berstatus menunggu tanggapan yang dapat ditarik kembali.");
    }
    evaluation.status = "draft";
    evaluation.submittedAt = null;
    await evaluation.save();

    return apiSuccess(
      { id: evaluation._id, status: "draft" },
      "Penilaian ditarik kembali ke draf dan tidak lagi terlihat oleh karyawan."
    );
  }

  /* --- HR locks it --- */
  const canFinalize = ["HRD", "SUPERADMIN", "DIREKSI"].includes(ctx.user.role);
  if (!canFinalize) {
    throw Forbidden("Hanya HRD, Direksi, atau Superadmin yang dapat memfinalkan penilaian.");
  }
  if (evaluation.status === "draft") {
    throw Conflict("Penilaian masih draf. Atasan harus mengirimkannya ke karyawan terlebih dahulu.");
  }
  if (evaluation.status === "finalized") {
    throw Conflict("Penilaian ini sudah final.");
  }

  evaluation.status = "finalized";
  evaluation.finalizedBy = ctx.user.id as unknown as RecordId;
  evaluation.finalizedAt = new Date();
  await evaluation.save();

  const recipients = await resolveRecipientForEmployee(evaluation.employeeId);
  void notifyUsers(recipients, {
    kind: "system",
    title: `Penilaian kinerja ${evaluation.period} telah final`,
    body:
      evaluation.source === "uploaded" && !evaluation.finalScore
        ? "Dokumen penilaian Anda sudah final dan dapat dibuka dari portal."
        : `Nilai akhir Anda ${evaluation.finalScore}${evaluation.gradeLabel ? ` (${evaluation.gradeLabel})` : ""}. Dokumen dapat diunduh dari portal.`,
    href: "/portal/kpi",
  });

  void logActivity({
    userId: ctx.user.id,
    action: "FINALIZE_KPI_EVALUATION",
    module: "kpi",
    after: { period: evaluation.period, finalScore: evaluation.finalScore },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id: evaluation._id, status: "finalized" },
    "Penilaian difinalkan dan terkunci. Karyawan dapat mengunduh dokumennya."
  );
});

/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "kpi", "delete");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin menghapus penilaian.");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID penilaian wajib disertakan.");

  const evaluation = await KpiEvaluation.findById(id);
  if (!evaluation) throw NotFound("Penilaian tidak ditemukan.");
  if (evaluation.status !== "draft") {
    throw Conflict(
      "Hanya draf yang dapat dihapus. Penilaian yang sudah dikirim ke karyawan menjadi bagian dari riwayat."
    );
  }

  await evaluation.deleteOne();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_KPI_DRAFT",
    module: "kpi",
    before: { period: evaluation.period },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, "Draf penilaian dihapus.");
});
