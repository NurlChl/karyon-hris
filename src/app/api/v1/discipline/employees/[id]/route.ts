import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, NotFound } from "@/lib/guard";
import { requireDisciplineAdmin, disciplineEmployeeFilter } from "@/lib/hr/discipline-server";
import Employee from "@/models/Employee";
import { requireProFeature } from "@/lib/licensing/server";
import "@/models/Branch";
import "@/models/Division";
import "@/models/Position";

export const GET = wrapRouteHandler(async (req, context: { params: Promise<{ id: string }> }) => {
  const ctx = await requireDisciplineAdmin(req, "read");
  await requireProFeature("discipline.workflow");
  const { id } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(id)) throw BadRequest("ID karyawan tidak valid.");
  const employee = await Employee.findOne({ $and: [{ _id: id }, disciplineEmployeeFilter(ctx)] })
    .select("name employeeId status branchId divisionId positionId supervisorId")
    .populate("branchId divisionId positionId supervisorId", "name").lean();
  if (!employee) throw NotFound("Karyawan tidak ditemukan dalam lingkup Anda.");
  const response = apiSuccess(employee);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
