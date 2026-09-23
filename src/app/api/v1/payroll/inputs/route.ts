import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireCompanyPermission as requirePermission, parseBody, BadRequest } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import PayrollInput from "@/models/PayrollInput";
import Payroll from "@/models/Payroll";

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One-off bonuses, deductions and target achievement for one payslip. */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "payroll", "read");
  const sp = new URL(req.url).searchParams;
  const employeeId = sp.get("employeeId") ?? "";
  const period = sp.get("period") ?? "";
  if (!/^[0-9a-fA-F]{24}$/.test(employeeId) || !periodRe.test(period)) throw BadRequest("Karyawan dan periode wajib diisi.");
  const input = await PayrollInput.findOne({ employeeId, period }).lean();
  return apiSuccess(input ?? { employeeId, period, adjustments: [], targetActual: null, targetNote: "" });
});

const schema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  period: z.string().regex(periodRe),
  adjustments: z
    .array(
      z.object({
        kind: z.enum(["earning", "deduction"]),
        name: z.string().trim().min(2, "Nama minimal 2 karakter").max(80),
        amount: z.number().min(0).max(1e12),
        note: z.string().trim().max(200).default(""),
      })
    )
    .max(30),
  targetActual: z.number().min(0).max(1e12).nullable(),
  targetNote: z.string().trim().max(500).default(""),
});

export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "write");
  const body = await parseBody(req, schema);
  const published = await Payroll.exists({ employeeId: body.employeeId, period: body.period, status: "published" });
  const input = await PayrollInput.findOneAndUpdate(
    { employeeId: body.employeeId, period: body.period },
    { adjustments: body.adjustments, targetActual: body.targetActual, targetNote: body.targetNote, updatedBy: ctx.user.id },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  void logActivity({ userId: ctx.user.id, action: "UPDATE_PAYROLL_INPUT", module: "payroll", after: body, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(
    input,
    published
      ? "Tersimpan. Slip periode ini sudah terbit; hitung ulang agar perubahan masuk ke slip."
      : "Tersimpan. Masuk ke slip saat diproses."
  );
});
