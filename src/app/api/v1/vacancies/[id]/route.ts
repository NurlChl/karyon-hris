import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requireUser, BadRequest, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { storageProvider } from "@/lib/storage";
import JobVacancy from "@/models/JobVacancy";
import Candidate from "@/models/Candidate";
import CandidateStageHistory from "@/models/CandidateStageHistory";
import "@/models/Position";
import "@/models/Division";
import "@/models/Branch";

type Ctx = RouteContext<{ id: string }>;

/**
 * One vacancy plus its applicant board.
 *
 * Returns candidates already bucketed by stage so the board can render without
 * doing the grouping client-side, and mints a short-lived signed link per CV
 * rather than exposing storage keys.
 */
export const GET = wrapRouteHandler<Ctx>(async (req, ctxParams) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "recruitment", "read");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin melihat data lowongan.");

  const { id } = await ctxParams.params;
  if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID lowongan tidak valid.");

  const vacancy = await JobVacancy.findById(id)
    .populate("divisionId", "name")
    .populate("branchId", "name")
    .populate("positionId", "name")
    .lean<Record<string, unknown> | null>();
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan.");

  const candidates = await Candidate.find({ vacancyId: id })
    .sort({ updatedAt: -1 })
    .limit(1000)
    .lean<Array<Record<string, unknown>>>();

  const histories = candidates.length
    ? await CandidateStageHistory.find({ candidateId: { $in: candidates.map((c) => c._id) } })
        .populate("interviewerId", "name employeeId")
        .sort({ createdAt: -1 })
        .lean<Array<Record<string, unknown>>>()
    : [];

  const historyByCandidate = new Map<string, Array<Record<string, unknown>>>();
  for (const h of histories) {
    const key = String(h.candidateId);
    if (!historyByCandidate.has(key)) historyByCandidate.set(key, []);
    historyByCandidate.get(key)!.push(h);
  }

  const enriched: Array<Record<string, unknown>> = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      cvUrl: !c.cvUrl
        ? ""
        : /^https?:\/\//.test(String(c.cvUrl))
          ? String(c.cvUrl)
          : await storageProvider.getSignedUrl(c.cvUrl as string, 900),
      history: historyByCandidate.get(String(c._id)) ?? [],
    }))
  );

  const stages = (vacancy.stages as string[]) ?? [];
  const board: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    stages.map((s) => [s, []])
  );
  // A candidate whose stage no longer exists on the vacancy is surfaced in a
  // dedicated bucket rather than silently dropped from the board.
  const orphaned: Array<Record<string, unknown>> = [];
  for (const c of enriched) {
    const stage = c.currentStage as string;
    if (board[stage]) board[stage].push(c);
    else orphaned.push(c);
  }

  return apiSuccess(
    {
      vacancy,
      board,
      orphaned,
      total: enriched.length,
      byStatus: enriched.reduce<Record<string, number>>((acc, c) => {
        const s = c.status as string;
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
    },
    "Berhasil memuat papan pelamar"
  );
});
