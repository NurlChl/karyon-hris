import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, pagination, Forbidden } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import AuditLog from "@/models/AuditLog";
import User from "@/models/User";
import Employee from "@/models/Employee";
import Role from "@/models/Role";
import { wibEndOfDay, wibStartOfDay } from "@/lib/time";

/**
 * Audit trail reader.
 *
 * The log is the system's accountability record, so reading it is itself a
 * privileged action — gated on the `audit` module, falling back to `settings`
 * for installations seeded before `audit` existed.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);

  const perm = (await checkPermission(ctx.user.id, "audit", "read")).allowed
    ? await checkPermission(ctx.user.id, "audit", "read")
    : await checkPermission(ctx.user.id, "settings", "read");
  if (!perm.allowed) {
    throw Forbidden("Anda tidak memiliki izin melihat log audit.");
  }
  // Audit entries can contain cross-module context and do not carry a reliable
  // target branch/division field. A narrow grant cannot be projected safely.
  if (perm.scope !== "all") {
    throw Forbidden("Log audit hanya tersedia untuk izin dengan cakupan seluruh perusahaan.");
  }

  const sp = new URL(req.url).searchParams;
  const { page, limit, skip } = pagination(req, 50, 200);

  const query: Record<string, unknown> = {};
  const moduleFilter = sp.get("module");
  const actionFilter = sp.get("action");
  const from = sp.get("from");
  const to = sp.get("to");
  const search = sp.get("q")?.trim();

  if (moduleFilter && moduleFilter !== "all") query.module = moduleFilter;
  if (actionFilter && actionFilter !== "all") query.action = actionFilter;
  if (from || to) {
    query.timestamp = {
      ...(from ? { $gte: wibStartOfDay(from) } : {}),
      ...(to ? { $lte: wibEndOfDay(to) } : {}),
    };
  }
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.action = { $regex: safe, $options: "i" };
  }

  const [logs, total, modules, actions] = await Promise.all([
    AuditLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).lean<
      Array<{ _id: unknown; userId: unknown; action: string; module: string; timestamp: Date }>
    >(),
    AuditLog.countDocuments(query),
    AuditLog.distinct("module"),
    AuditLog.distinct("action"),
  ]);

  /* --- resolve actors ------------------------------------------------ */
  // The User model has no `name` or `role` field — the previous version
  // selected both and rendered `undefined` for every row. The display name
  // comes from the linked Employee, and the role from the referenced Role.
  const userIds = Array.from(
    new Set(logs.map((l) => l.userId).filter(Boolean).map((u) => String(u)))
  ).filter((id) => RecordId.isValid(id));

  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("email roleId employeeId")
        .lean<Array<{ _id: RecordId; email: string; roleId?: RecordId; employeeId?: RecordId }>>()
    : [];

  const [roles, employees] = await Promise.all([
    Role.find({ _id: { $in: users.map((u) => u.roleId).filter(Boolean) } })
      .select("name")
      .lean<Array<{ _id: RecordId; name: string }>>(),
    Employee.find({ _id: { $in: users.map((u) => u.employeeId).filter(Boolean) } })
      .select("name employeeId")
      .lean<Array<{ _id: RecordId; name: string; employeeId: string }>>(),
  ]);

  const roleMap = new Map(roles.map((r) => [String(r._id), r.name]));
  const empMap = new Map(employees.map((e) => [String(e._id), e]));
  const userMap = new Map(
    users.map((u) => {
      const emp = u.employeeId ? empMap.get(String(u.employeeId)) : undefined;
      return [
        String(u._id),
        {
          name: emp?.name ?? u.email,
          nip: emp?.employeeId ?? "-",
          email: u.email,
          role: u.roleId ? roleMap.get(String(u.roleId)) ?? "-" : "-",
        },
      ];
    })
  );

  const mapped = logs.map((log) => ({
    ...log,
    actor: (log.userId && userMap.get(String(log.userId))) || {
      name: "Sistem / Anonim",
      nip: "-",
      email: "-",
      role: "-",
    },
  }));

  return apiSuccess(
    {
      logs: mapped,
      filters: { modules: modules.sort(), actions: actions.sort() },
    },
    "Berhasil memuat log audit",
    { page, limit, total }
  );
});
