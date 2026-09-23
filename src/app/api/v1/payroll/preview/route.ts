import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireCompanyPermission as requirePermission, BadRequest } from "@/lib/guard";
import { calculatePayroll } from "@/lib/hr/payroll-calc";

/** The payslip a run would produce for one employee, without saving anything. */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "payroll", "read");
  const sp = new URL(req.url).searchParams;
  const employeeId = sp.get("employeeId") ?? "";
  const period = sp.get("period") ?? "";
  if (!/^[0-9a-fA-F]{24}$/.test(employeeId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw BadRequest("Karyawan dan periode wajib diisi.");
  }
  return apiSuccess(await calculatePayroll(employeeId, period));
});
