import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, parseBody, BadRequest, Conflict, Forbidden, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { invalidatePermissionCache } from "@/lib/rbac";
import Role from "@/models/Role";
import RolePermission from "@/models/RolePermission";
import User from "@/models/User";
import {
  RBAC_MODULES,
  RBAC_ACTIONS,
  RBAC_SCOPES,
  MODULE_IDS,
  ACTION_IDS,
} from "@/lib/rbac/modules";

/**
 * Role and permission administration.
 *
 * The matrix lives in the database rather than in code, so a change here takes
 * effect on the next request without a redeploy — that is what makes the system
 * "configurable" in the sense the spec asks for.
 */

export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);

  const roles = await Role.find({}).sort({ isSystemDefault: -1, name: 1 }).lean<
    Array<{ _id: unknown; name: string; isSystemDefault: boolean }>
  >();

  // One query for all permissions instead of one per role.
  const permissions = await RolePermission.find({}).lean<
    Array<{ roleId: unknown; module: string; actions: string[]; scope: string }>
  >();
  const counts = await User.aggregate<{ _id: unknown; count: number }>([
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  const byRole = new Map<string, Array<{ module: string; actions: string[]; scope: string }>>();
  for (const p of permissions) {
    const key = String(p.roleId);
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key)!.push({ module: p.module, actions: p.actions, scope: p.scope });
  }

  return apiSuccess(
    {
      roles: roles.map((r) => ({
        _id: r._id,
        name: r.name,
        isSystemDefault: r.isSystemDefault,
        userCount: countMap.get(String(r._id)) ?? 0,
        permissions: byRole.get(String(r._id)) ?? [],
      })),
      modules: RBAC_MODULES,
      actions: RBAC_ACTIONS,
      scopes: RBAC_SCOPES,
    },
    "Berhasil memuat data role dan hak akses"
  );
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Nama peran minimal 2 karakter").max(40),
});

const updateSchema = z.object({
  roleId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  permissions: z
    .array(
      z.object({
        module: z.enum(MODULE_IDS as [string, ...string[]]),
        actions: z.array(z.enum(ACTION_IDS as [string, ...string[]])),
        scope: z.enum(["self", "division", "branch", "all", "reports"]),
      })
    )
    .max(RBAC_MODULES.length),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const raw = (await req.clone().json()) as Record<string, unknown>;

  /* --- create a role --------------------------------------------- */
  if (raw.name && !raw.roleId) {
    const body = await parseBody(req, createSchema);
    const cleanName = body.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!cleanName) throw BadRequest("Nama peran tidak valid.");
    if (cleanName === "SUPERADMIN") {
      throw Forbidden("Nama SUPERADMIN dicadangkan untuk peran sistem.");
    }

    const exists = await Role.findOne({ name: cleanName }).lean();
    if (exists) throw Conflict(`Peran ${cleanName} sudah terdaftar.`);

    const role = await Role.create({ name: cleanName, isSystemDefault: false });

    // A new role starts with no access at all; the admin grants what it needs.
    await RolePermission.insertMany(
      MODULE_IDS.map((module) => ({ roleId: role._id, module, actions: [], scope: "self" }))
    );

    void logActivity({
      userId: ctx.user.id,
      action: "CREATE_ROLE",
      module: "settings",
      after: { role: cleanName },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return apiSuccess(
      { _id: role._id, name: cleanName },
      `Peran ${cleanName} dibuat tanpa hak akses. Atur hak aksesnya sekarang.`,
      undefined,
      201
    );
  }

  /* --- update permissions ----------------------------------------- */
  const body = await parseBody(req, updateSchema);
  if (new Set(body.permissions.map((p) => p.module)).size !== body.permissions.length) throw BadRequest("Modul izin tidak boleh duplikat.");
  if (body.permissions.some((p) => p.scope === "reports" && p.module !== "discipline")) throw BadRequest("Lingkup bawahan langsung saat ini hanya tersedia untuk Disiplin & SP.");
  if (body.permissions.some((p) => p.module === "discipline" && (p.actions.some((a) => !["read", "write", "approve"].includes(a)) || (p.actions.length > 0 && !p.actions.includes("read"))))) throw BadRequest("Disiplin & SP mendukung Lihat, Tambah/Ubah, Setujui; akses Lihat wajib disertakan.");
  const role = await Role.findById(body.roleId);
  if (!role) throw NotFound("Peran tidak ditemukan.");

  // SUPERADMIN bypasses the permission table entirely in `checkPermission`;
  // editing it would create the illusion of restricting an account that in fact
  // still has full access.
  if (role.name === "SUPERADMIN") {
    throw Forbidden(
      "Hak akses SUPERADMIN bersifat mutlak dan tidak dapat diubah. Buat peran baru bila Anda memerlukan akses terbatas."
    );
  }
  if (role.name === "STAFF") {
    // Staff is the fixed baseline every employee falls back to.
    const removesSelfService = body.permissions.some(
      (p) => (p.module === "attendance" || p.module === "leave") && !p.actions.includes("read")
    );
    if (removesSelfService) {
      throw Forbidden(
        "Peran STAFF wajib tetap dapat membaca presensi dan cuti miliknya sendiri."
      );
    }
  }

  const before = await RolePermission.find({ roleId: body.roleId }).lean();

  // Replace the whole matrix in one pass so a module absent from the payload is
  // treated as "no access" rather than silently keeping its old grant.
  await RolePermission.deleteMany({ roleId: body.roleId });
  const created = await RolePermission.insertMany(
    body.permissions.map((p) => ({
      roleId: body.roleId,
      module: p.module,
      actions: p.actions,
      scope: p.scope,
    }))
  );

  // Permissions are cached per user for a few seconds; clear it so an admin
  // testing a change sees the effect on their very next request.
  invalidatePermissionCache();

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_ROLE_PERMISSIONS",
    module: "settings",
    before: { role: role.name, permissions: before },
    after: { role: role.name, permissions: created },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(created, `Hak akses peran ${role.name} diperbarui dan langsung berlaku.`);
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "delete");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID peran wajib disertakan.");

  const role = await Role.findById(id);
  if (!role) throw NotFound("Peran tidak ditemukan.");
  if (role.isSystemDefault) {
    throw Forbidden(`Peran sistem ${role.name} tidak dapat dihapus.`);
  }

  const inUse = await User.countDocuments({ roleId: role._id });
  if (inUse > 0) {
    throw Conflict(
      `Peran ${role.name} masih dipakai oleh ${inUse} akun. Pindahkan akun tersebut ke peran lain terlebih dahulu.`
    );
  }

  await RolePermission.deleteMany({ roleId: role._id });
  await role.deleteOne();

  invalidatePermissionCache();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_ROLE",
    module: "settings",
    before: { role: role.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, `Peran ${role.name} dihapus.`);
});
