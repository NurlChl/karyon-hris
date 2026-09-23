import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { publicFormFields, resolveFormFields } from "@/lib/hr/applications";
import { NotFound } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import JobVacancy, {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
} from "@/models/JobVacancy";
import "@/models/Division";
import "@/models/Branch";

/**
 * Public job listings.
 *
 * Unauthenticated by design, so the projection is explicit: internal fields
 * (openings, applicant counts, the stage list, the salary range when the
 * vacancy is not set to publish it) never leave the server.
 */

interface LeanVacancy {
  _id: unknown;
  formFields?: unknown;
  title: string;
  slug: string;
  summary: string;
  employmentType: string;
  workArrangement: string;
  location: string;
  responsibilities?: string[];
  requirements?: string[];
  niceToHave?: string[];
  benefits?: string[];
  salaryMin?: number;
  salaryMax?: number;
  showSalary?: boolean;
  publishedAt?: Date;
  closesAt?: Date | null;
  divisionId?: { name?: string } | null;
  branchId?: { name?: string } | null;
}

function toPublic(v: LeanVacancy, detailed: boolean) {
  const base = {
    _id: v._id,
    title: v.title,
    slug: v.slug,
    summary: v.summary,
    employmentType: v.employmentType,
    employmentTypeLabel: EMPLOYMENT_TYPE_LABELS[v.employmentType] ?? v.employmentType,
    workArrangement: v.workArrangement,
    workArrangementLabel: WORK_ARRANGEMENT_LABELS[v.workArrangement] ?? v.workArrangement,
    location: v.location || v.branchId?.name || "",
    division: v.divisionId?.name ?? "",
    publishedAt: v.publishedAt,
    closesAt: v.closesAt ?? null,
    // The range is stored either way; it is only disclosed when the vacancy
    // explicitly opts in.
    salary: v.showSalary ? { min: v.salaryMin ?? 0, max: v.salaryMax ?? 0 } : null,
  };

  if (!detailed) return base;

  return {
    ...base,
    responsibilities: v.responsibilities ?? [],
    requirements: v.requirements ?? [],
    niceToHave: v.niceToHave ?? [],
    benefits: v.benefits ?? [],
  };
}

export const GET = wrapRouteHandler(async (req) => {
  await connectToDatabase();
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("slug");

  const now = new Date();
  // A vacancy past its closing date stops appearing even if nobody remembered
  // to switch its status.
  const liveFilter = {
    status: "open",
    $or: [{ closesAt: null }, { closesAt: { $gte: now } }],
  };

  if (slug) {
    const vacancy = await JobVacancy.findOne({ slug, ...liveFilter })
      .populate("divisionId", "name")
      .populate("branchId", "name")
      .lean<LeanVacancy | null>();

    if (!vacancy) throw NotFound("Lowongan ini tidak ditemukan atau sudah ditutup.");

    // Fire-and-forget: a failed counter must never block the page.
    void JobVacancy.updateOne({ slug }, { $inc: { viewCount: 1 } }).catch(() => {});

    return apiSuccess(
      { ...toPublic(vacancy, true), formFields: publicFormFields(resolveFormFields(vacancy)) },
      "Berhasil memuat detail lowongan"
    );
  }

  const filter: Record<string, unknown> = { ...liveFilter };
  const type = sp.get("type");
  if (type && type !== "all") filter.employmentType = type;
  const arrangement = sp.get("arrangement");
  if (arrangement && arrangement !== "all") filter.workArrangement = arrangement;

  const vacancies = await JobVacancy.find(filter)
    .populate("divisionId", "name")
    .populate("branchId", "name")
    .sort({ publishedAt: -1 })
    .limit(200)
    .lean<LeanVacancy[]>();

  return apiSuccess(
    vacancies.map((v) => toPublic(v, false)),
    vacancies.length
      ? `${vacancies.length} lowongan sedang dibuka`
      : "Belum ada lowongan yang dibuka saat ini"
  );
});
