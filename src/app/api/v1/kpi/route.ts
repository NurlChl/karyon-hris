import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, Forbidden } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import KpiEvaluation from "@/models/KpiEvaluation";
import KpiTemplate from "@/models/KpiTemplate";
import { DEFAULT_GRADES } from "@/lib/hr/kpi";
import Employee from "@/models/Employee";
import "@/models/Division";
import "@/models/Position";

/**
 * KPI overview.
 *
 * Template and appraisal CRUD live in `/kpi/templates` and `/kpi/evaluations`;
 * this route only aggregates. Results are narrowed by the caller's permission
 * scope, so a supervisor sees their division's numbers rather than the
 * company's.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "kpi", "read");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin melihat data KPI.");

  const sp = new URL(req.url).searchParams;
  const period = sp.get("period");

  /* --- scope ---
     `employeeFilter` narrows the headcount the same way `scope` narrows the
     appraisals. Coverage divides one by the other, so the two have to be drawn
     from the same population — counting every employee in the company while
     only reading one division's appraisals reports a coverage far below the
     real one. */
  const scope: Record<string, unknown> = {};
  const employeeFilter: Record<string, unknown> = { status: "active" };

  if (perm.scope === "self") {
    scope.employeeId = ctx.user.employeeId ?? "000000000000000000000000";
    employeeFilter._id = ctx.user.employeeId ?? "000000000000000000000000";
  } else if (perm.scope === "division" && ctx.user.divisionId) {
    employeeFilter.divisionId = ctx.user.divisionId;
    const ids = await Employee.find({ divisionId: ctx.user.divisionId })
      .select("_id")
      .lean<Array<{ _id: RecordId }>>();
    scope.employeeId = { $in: ids.map((e) => e._id) };
  } else if (perm.scope === "branch" && ctx.user.branchId) {
    employeeFilter.branchId = ctx.user.branchId;
    const ids = await Employee.find({ branchId: ctx.user.branchId })
      .select("_id")
      .lean<Array<{ _id: RecordId }>>();
    scope.employeeId = { $in: ids.map((e) => e._id) };
  }

  // An uploaded appraisal without a score has nothing to average.
  const filter = {
    ...scope,
    ...(period ? { period } : {}),
    $nor: [{ source: "uploaded", finalScore: { $in: [0, null] } }],
  };

  const [evaluations, templateCount, activeEmployees, periods] = await Promise.all([
    KpiEvaluation.find(filter)
      .populate({
        path: "employeeId",
        select: "name employeeId divisionId",
        populate: { path: "divisionId", select: "name" },
      })
      .sort({ finalScore: -1 })
      .limit(1000)
      .lean<Array<Record<string, unknown>>>(),
    KpiTemplate.countDocuments({ isActive: true }),
    Employee.countDocuments(employeeFilter),
    KpiEvaluation.distinct("period", scope),
  ]);

  /* --- status counts --- */
  const byStatus = evaluations.reduce<Record<string, number>>((acc, e) => {
    const s = e.status as string;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  // Only appraisals the employee has seen count toward averages. Including
  // drafts would let an unfinished form move the division's reported score.
  const settled = evaluations.filter((e) => e.status !== "draft");
  const averageScore = settled.length
    ? Math.round((settled.reduce((n, e) => n + ((e.finalScore as number) || 0), 0) / settled.length) * 100) / 100
    : 0;

  /* --- per division --- */
  type DivisionStat = { name: string; sum: number; count: number };
  const divisionStats = new Map<string, DivisionStat>();
  for (const e of settled) {
    const emp = e.employeeId as { divisionId?: { _id?: unknown; name?: string } } | null;
    const div = emp?.divisionId;
    if (!div?._id) continue;
    const key = String(div._id);
    const entry = divisionStats.get(key) ?? { name: div.name ?? "Tanpa divisi", sum: 0, count: 0 };
    entry.sum += (e.finalScore as number) || 0;
    entry.count += 1;
    divisionStats.set(key, entry);
  }

  const divisionAverages = [...divisionStats.values()]
    .map((d) => ({ name: d.name, average: Math.round((d.sum / d.count) * 100) / 100, count: d.count }))
    .sort((a, b) => b.average - a.average);

  /* --- distribution across grade bands ---
     The dashboard aggregates appraisals from templates that may define their
     own bands, so it reports against the shared default set rather than any
     one template's. */
  const distribution = DEFAULT_GRADES.map((g) => ({ label: g.label, min: g.min, count: 0 }))
    .sort((a, b) => b.min - a.min);
  for (const e of settled) {
    const score = (e.finalScore as number) || 0;
    const band = distribution.find((d) => score >= d.min);
    if (band) band.count += 1;
  }

  const topPerformers = settled.slice(0, 5).map((e) => {
    const emp = e.employeeId as { name?: string; divisionId?: { name?: string } } | null;
    return {
      employeeName: emp?.name ?? "Karyawan dihapus",
      divisionName: emp?.divisionId?.name ?? "-",
      finalScore: e.finalScore,
      gradeLabel: e.gradeLabel,
      period: e.period,
    };
  });

  return apiSuccess(
    {
      stats: {
        totalEvaluations: evaluations.length,
        settledEvaluations: settled.length,
        averageScore,
        templateCount,
        activeEmployees,
        // How much of the workforce has a settled appraisal for the filtered
        // period; the number HR actually chases.
        coverage:
          activeEmployees > 0 && period
            ? Math.round((settled.length / activeEmployees) * 100)
            : null,
      },
      byStatus,
      divisionAverages,
      distribution,
      topPerformers,
      periods: (periods as string[]).sort().reverse(),
    },
    "Berhasil memuat ringkasan KPI"
  );
});
