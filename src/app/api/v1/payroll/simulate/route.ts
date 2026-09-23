import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { requireCompanyPermission, parseBody, enforceRateLimit, BadRequest } from "@/lib/guard";
import { calculatePayroll } from "@/lib/hr/payroll-calc";
import { attendanceDeductions, classifyLateness } from "@/lib/hr/policy-evidence";
import { wibPeriodKey } from "@/lib/time";
import Employee from "@/models/Employee";
import { requireProFeature } from "@/lib/licensing/server";

export const GET = wrapRouteHandler(async (req) => {
  await requireCompanyPermission(req, "payroll", "read");
  await requireProFeature("payroll.advanced");
  const employees = await Employee.find({}).select("name employeeId").sort({ name: 1 }).limit(2000).lean();
  const response = apiSuccess(employees);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

const amount = z.number().finite().min(0).max(1e9);
const schema = z.object({
  employeeId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  policy: z.object({ latePerMinute: amount, latePenaltyCap: amount, absentPerDay: amount, lateUnit: z.enum(["minute", "hour", "day"]).default("minute"), alphaEnabled: z.boolean().default(false), alphaAfterHours: z.number().min(0.01).max(24).default(4) }).strict(),
}).strict();

/** POST is used for bounded input; this endpoint never saves a simulation or payroll. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "payroll", "read");
  await requireProFeature("payroll.advanced");
  enforceRateLimit("policy-simulation", ctx.user.id, { max: 10, windowMs: 60_000 });
  const body = await parseBody(req, schema);
  if (body.period > wibPeriodKey() || body.period < "2000-01") throw BadRequest("Pilih periode historis atau bulan berjalan sejak tahun 2000.");
  const calculation = await calculatePayroll(body.employeeId, body.period);
  // Both alternatives use the same facts. Never requery between comparisons.
  const snapshot = calculation.decisionEvidence;
  const classified = classifyLateness(snapshot.attendance, body.policy, snapshot.unconvertedAbsentDates ?? snapshot.absentDates);
  const proposedFacts = { ...snapshot.facts, lateMinutes: classified.lateMinutes, lateDays: classified.lateDays, absentDays: classified.absentDays };
  const proposed = attendanceDeductions(proposedFacts, body.policy);
  const response = apiSuccess({
    employee: { name: calculation.employee.name, employeeId: calculation.employee.employeeId },
    snapshot, proposedPolicy: body.policy, proposed, proposedFacts,
    delta: proposed.total - snapshot.result.total,
    warnings: [...calculation.warnings, ...(calculation.problem ? [calculation.problem] : []),
      "Hanya dampak potongan presensi, bukan gaji bersih atau simulasi pajak. Data bulan berjalan belum lengkap.",
      "Alpha mengikuti kalender yang digunakan mesin payroll saat ini; periksa jadwal shift dan cuti sebelum mengambil keputusan."],
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
