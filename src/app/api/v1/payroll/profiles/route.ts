import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireCompanyPermission as requirePermission, parseBody, BadRequest, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { EMPTY_PROFILE } from "@/lib/hr/pay-rules";
import PayProfile from "@/models/PayProfile";
import Employee from "@/models/Employee";

/** How an employee is paid beyond the contract salary. One profile per employee. */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "payroll", "read");
  const employeeId = new URL(req.url).searchParams.get("employeeId") ?? "";
  if (!/^[0-9a-fA-F]{24}$/.test(employeeId)) throw BadRequest("Pilih karyawan.");
  const profile = await PayProfile.findOne({ employeeId }).lean();
  return apiSuccess(profile ?? { employeeId, ...EMPTY_PROFILE, isNew: true });
});

const item = z.object({
  kind: z.enum(["earning", "deduction"]),
  name: z.string().trim().min(2, "Nama komponen minimal 2 karakter").max(80),
  amount: z.number().min(0).max(1e12),
  note: z.string().trim().max(200).default(""),
  untilPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal("")).default(""),
});

const schema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  overtimeMode: z.enum(["company_rate", "custom_rate", "none"]),
  overtimeRate: z.number().min(0).max(1e9).default(0),
  exemptLatePenalty: z.boolean().default(false),
  exemptAbsentPenalty: z.boolean().default(false),
  recurring: z.array(item).max(30).default([]),
  target: z
    .object({
      enabled: z.boolean(),
      name: z.string().trim().max(60).default("Target penjualan"),
      unit: z.string().trim().max(20).default("unit"),
      targetValue: z.number().min(0).max(1e12).default(0),
      tiers: z.array(z.object({ minPct: z.number().min(0).max(1000), amount: z.number().min(0).max(1e12) })).max(8).default([]),
      excessRate: z.number().min(0).max(1e12).default(0),
      note: z.string().trim().max(1000).default(""),
    })
    .refine((t) => !t.enabled || t.targetValue > 0, { message: "Isi nilai target.", path: ["targetValue"] }),
});

export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "write");
  const body = await parseBody(req, schema);
  if (body.overtimeMode === "custom_rate" && !body.overtimeRate) throw BadRequest("Isi tarif lembur khusus per jam.");
  const employee = await Employee.findById(body.employeeId).select("name").lean<{ name: string } | null>();
  if (!employee) throw NotFound("Karyawan tidak ditemukan.");

  const { employeeId, ...rest } = body;
  const profile = await PayProfile.findOneAndUpdate(
    { employeeId },
    { ...rest, target: { ...rest.target, tiers: [...rest.target.tiers].sort((a, b) => a.minPct - b.minPct) }, updatedBy: ctx.user.id },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  void logActivity({ userId: ctx.user.id, action: "UPDATE_PAY_PROFILE", module: "payroll", after: { employee: employee.name, ...rest }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(profile, `Komponen gaji ${employee.name} disimpan. Berlaku saat slip berikutnya dihitung.`);
});
