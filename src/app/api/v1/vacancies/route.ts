import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requirePermission,
  parseBody,
  pagination,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { randomToken } from "@/lib/crypto";
import { slugifyVacancy } from "@/lib/hr/slug";
import JobVacancy, { DEFAULT_STAGES } from "@/models/JobVacancy";
import Candidate from "@/models/Candidate";
import "@/models/Position";
import "@/models/Division";
import "@/models/Branch";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");
const optionalId = z.union([objectId, z.literal(""), z.null()]).optional();

const vacancySchema = z.object({
  id: optionalId,
  title: z.string().trim().min(4, "Judul lowongan minimal 4 karakter").max(150),
  positionId: optionalId,
  divisionId: optionalId,
  branchId: optionalId,
  employmentType: z
    .enum(["full_time", "part_time", "contract", "internship", "freelance"])
    .default("full_time"),
  workArrangement: z.enum(["onsite", "hybrid", "remote"]).default("onsite"),
  location: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(2000).default(""),
  responsibilities: z.array(z.string().trim().max(400)).max(30).default([]),
  requirements: z.array(z.string().trim().max(400)).max(30).default([]),
  niceToHave: z.array(z.string().trim().max(400)).max(20).default([]),
  benefits: z.array(z.string().trim().max(400)).max(20).default([]),
  salaryMin: z.number().int().min(0).default(0),
  salaryMax: z.number().int().min(0).default(0),
  showSalary: z.boolean().default(false),
  openings: z.number().int().min(1).max(500).default(1),
  stages: z.array(z.string().trim().min(2).max(60)).min(2, "Minimal dua tahap seleksi").max(15),
  status: z.enum(["draft", "open", "closed", "archived"]).default("draft"),
  closesAt: z.string().optional().nullable(),
});

/* ------------------------------------------------------------------ */
/* GET — admin list                                                     */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "recruitment", "read");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin melihat data lowongan.");

  const sp = new URL(req.url).searchParams;
  const { page, limit, skip } = pagination(req, 50, 200);

  const filter: Record<string, unknown> = {};
  const status = sp.get("status");
  if (status && status !== "all") filter.status = status;
  else filter.status = { $ne: "archived" };

  const search = sp.get("q")?.trim();
  if (search) {
    filter.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  const [vacancies, total] = await Promise.all([
    JobVacancy.find(filter)
      .populate("divisionId", "name")
      .populate("branchId", "name")
      .populate("positionId", "name")
      .sort({ status: 1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobVacancy.countDocuments(filter),
  ]);

  // Live applicant counts per stage, in one aggregation rather than one query
  // per vacancy. The stored `applicantCount` is a fast approximation; this is
  // what the board actually renders from.
  const ids = vacancies.map((v) => v._id);
  const byStage = ids.length
    ? await Candidate.aggregate<{ _id: { v: RecordId; s: string }; n: number }>([
        { $match: { vacancyId: { $in: ids } } },
        { $group: { _id: { v: "$vacancyId", s: "$currentStage" }, n: { $sum: 1 } } },
      ])
    : [];

  const counts = new Map<string, { total: number; stages: Record<string, number> }>();
  for (const row of byStage) {
    const key = String(row._id.v);
    const entry = counts.get(key) ?? { total: 0, stages: {} };
    entry.total += row.n;
    entry.stages[row._id.s] = row.n;
    counts.set(key, entry);
  }

  return apiSuccess(
    vacancies.map((v) => ({
      ...v,
      applicants: counts.get(String(v._id)) ?? { total: 0, stages: {} },
    })),
    "Berhasil memuat daftar lowongan",
    { page, limit, total }
  );
});

/* ------------------------------------------------------------------ */
/* POST — create / update                                               */
/* ------------------------------------------------------------------ */

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const body = await parseBody(req, vacancySchema);

  if (body.salaryMax > 0 && body.salaryMin > body.salaryMax) {
    throw BadRequest("Gaji minimum tidak boleh lebih besar dari gaji maksimum.");
  }

  const payload = {
    title: body.title,
    positionId: body.positionId || null,
    divisionId: body.divisionId || null,
    branchId: body.branchId || null,
    employmentType: body.employmentType,
    workArrangement: body.workArrangement,
    location: body.location,
    summary: body.summary,
    responsibilities: body.responsibilities.filter(Boolean),
    requirements: body.requirements.filter(Boolean),
    niceToHave: body.niceToHave.filter(Boolean),
    benefits: body.benefits.filter(Boolean),
    salaryMin: body.salaryMin,
    salaryMax: body.salaryMax,
    showSalary: body.showSalary,
    openings: body.openings,
    stages: body.stages,
    status: body.status,
    closesAt: body.closesAt ? new Date(body.closesAt) : null,
  };

  /* --- update --- */
  if (body.id) {
    const existing = await JobVacancy.findById(body.id);
    if (!existing) throw NotFound("Lowongan tidak ditemukan.");

    // Removing a stage that candidates are currently sitting in would strand
    // them in a column the board no longer renders.
    const removed = existing.stages.filter((s: string) => !body.stages.includes(s));
    if (removed.length) {
      const stranded = await Candidate.countDocuments({
        vacancyId: existing._id,
        currentStage: { $in: removed },
      });
      if (stranded > 0) {
        throw Conflict(
          `Tahap ${removed.map((r: string) => `"${r}"`).join(", ")} masih berisi ${stranded} pelamar. ` +
            `Pindahkan pelamar tersebut ke tahap lain sebelum menghapus tahapnya.`
        );
      }
    }

    // Publishing for the first time stamps the date the listing went live.
    if (body.status === "open" && !existing.publishedAt) {
      Object.assign(payload, { publishedAt: new Date() });
    }

    const updated = await JobVacancy.findByIdAndUpdate(body.id, payload, { new: true });

    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_VACANCY",
      module: "recruitment",
      before: { title: existing.title, status: existing.status },
      after: { title: updated!.title, status: updated!.status },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return apiSuccess(updated, `Lowongan "${body.title}" diperbarui.`);
  }

  /* --- create --- */
  const vacancy = await JobVacancy.create({
    ...payload,
    stages: body.stages.length ? body.stages : DEFAULT_STAGES,
    slug: slugifyVacancy(body.title, randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)),
    publishedAt: body.status === "open" ? new Date() : null,
    createdBy: ctx.user.id,
  });

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_VACANCY",
    module: "recruitment",
    after: { title: vacancy.title, status: vacancy.status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    vacancy,
    body.status === "open"
      ? `Lowongan "${body.title}" dibuat dan langsung tayang di halaman karier.`
      : `Lowongan "${body.title}" disimpan sebagai draf. Ubah statusnya ke "Dibuka" untuk menayangkan.`,
    undefined,
    201
  );
});

/* ------------------------------------------------------------------ */
/* PATCH — quick status change from the list                            */
/* ------------------------------------------------------------------ */

const statusSchema = z.object({
  id: objectId,
  status: z.enum(["draft", "open", "closed", "archived"]),
});

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const body = await parseBody(req, statusSchema);

  const vacancy = await JobVacancy.findById(body.id);
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan.");

  vacancy.status = body.status;
  if (body.status === "open" && !vacancy.publishedAt) vacancy.publishedAt = new Date();
  await vacancy.save();

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_VACANCY_STATUS",
    module: "recruitment",
    after: { title: vacancy.title, status: body.status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const messages: Record<string, string> = {
    draft: `"${vacancy.title}" dikembalikan ke draf dan tidak lagi tampil publik.`,
    open: `"${vacancy.title}" kini tayang di halaman karier.`,
    closed: `"${vacancy.title}" ditutup. Pelamar yang sudah masuk tetap dapat diproses.`,
    archived: `"${vacancy.title}" diarsipkan.`,
  };

  return apiSuccess({ id: vacancy._id, status: body.status }, messages[body.status]);
});

/* ------------------------------------------------------------------ */
/* DELETE                                                               */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "delete");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID lowongan wajib disertakan.");

  const vacancy = await JobVacancy.findById(id);
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan.");

  const applicants = await Candidate.countDocuments({ vacancyId: id });
  if (applicants > 0) {
    throw Conflict(
      `Lowongan ini sudah menerima ${applicants} pelamar, sehingga tidak dapat dihapus. ` +
        `Arsipkan saja agar riwayat seleksinya tetap tersimpan.`
    );
  }

  await vacancy.deleteOne();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_VACANCY",
    module: "recruitment",
    before: { title: vacancy.title },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, `Lowongan "${vacancy.title}" dihapus.`);
});
