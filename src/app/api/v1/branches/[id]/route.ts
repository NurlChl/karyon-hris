import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import Branch from "@/models/Branch";
import Employee from "@/models/Employee";

type Ctx = RouteContext<{ id: string }>;

export const DELETE = wrapRouteHandler<Ctx>(async (req, ctxParams) => {
  const ctx = await requirePermission(req, "settings", "delete");
  const { id } = await ctxParams.params;
  if (!id) throw BadRequest("ID cabang wajib disediakan.");

  const branch = await Branch.findById(id);
  if (!branch) throw NotFound("Cabang tidak ditemukan.");

  // Deleting a branch that employees are posted to would break their geofence
  // check on the next clock-in, with an error that gives no hint why.
  const assigned = await Employee.countDocuments({
    branchId: id,
    status: { $in: ["active", "onboarding"] },
  });
  if (assigned > 0) {
    throw Conflict(
      `Cabang ${branch.name} masih menjadi penempatan ${assigned} karyawan aktif. ` +
        `Pindahkan karyawan tersebut ke cabang lain sebelum menghapus.`
    );
  }

  await branch.deleteOne();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_BRANCH",
    module: "settings",
    before: branch.toObject(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, `Cabang ${branch.name} dihapus.`);
});
