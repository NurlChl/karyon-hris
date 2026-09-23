import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import WorkSchedule from "@/models/WorkSchedule";
import EmployeeSchedule from "@/models/EmployeeSchedule";
import Employee from "@/models/Employee";

type Ctx = RouteContext<{ id: string }>;

/** Deletes a shift template that nobody uses any more. */
export const DELETE = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "attendance", "write");
  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID jadwal tidak valid.");

  const schedule = await WorkSchedule.findById(id);
  if (!schedule) throw NotFound("Template jadwal tidak ditemukan.");

  const [employees, overrides] = await Promise.all([
    Employee.countDocuments({ workScheduleId: id, status: { $ne: "resigned" } }),
    EmployeeSchedule.countDocuments({ scheduleId: id, date: { $gte: new Date() } }),
  ]);
  if (employees || overrides) {
    throw Conflict(
      `Template "${schedule.name}" masih dipakai ${employees} karyawan` +
        (overrides ? ` dan ${overrides} jadwal khusus mendatang` : "") +
        ". Pindahkan mereka ke template lain lebih dulu."
    );
  }

  await schedule.deleteOne();
  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_SCHEDULE_TEMPLATE",
    module: "attendance",
    before: schedule.toObject(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return apiSuccess({ id }, `Template "${schedule.name}" dihapus.`);
});
