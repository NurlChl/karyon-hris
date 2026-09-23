import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireCompanyPermission as requirePermission,
  parseBody,
  employeeRecordScopeFilter,
  BadRequest,
  Forbidden,
  pagination,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { formatPeriod, formatRupiah, wibPeriodKey } from "@/lib/time";
import { escapeHtml } from "@/lib/notification/notify";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { attachmentInputSchema } from "@/lib/attachments";
import { notifyUsers, resolveRecipientForEmployee } from "@/lib/notification/notify";
import Payroll from "@/models/Payroll";
import Employee from "@/models/Employee";
import { calculatePayroll } from "@/lib/hr/payroll-calc";
import { queueCapReview } from "@/lib/hr/discipline-server";

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const period = sp.get("period");
  const { page, limit, skip } = pagination(req, 25, 100);

  const perm = await checkPermission(ctx.user.id, "payroll", "read");

  const filter: Record<string, unknown> = {};
  if (period) filter.period = period;
  const status = sp.get("status");
  if (status && ["draft", "published", "paid"].includes(status)) filter.status = status;

  // Narrow grants follow assigned membership; self-service remains pinned to
  // the caller. Narrow readers never see in-progress draft slips.
  if (!perm.allowed || perm.scope !== "all") {
    if (!ctx.user.employeeId) {
      return apiSuccess([], "Akun ini tidak tertaut ke data karyawan");
    }
    Object.assign(filter, await employeeRecordScopeFilter({ ...ctx, permission: perm }));
    if (perm.scope === "self" || !perm.allowed) filter.employeeId = ctx.user.employeeId;
    // Employees only see published slips, never in-progress drafts.
    filter.status = "published";
  }

  const [payrolls, total] = await Promise.all([
    Payroll.find(filter)
      .populate("employeeId", "name employeeId divisionId branchId")
      .populate("generatedBy", "email")
      .sort({ period: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payroll.countDocuments(filter),
  ]);

  // The slip file itself is only ever handed over as a short-lived signed link.
  const withLinks = await Promise.all(
    payrolls.map(async (p) => ({
      ...p,
      fileUrl: p.fileUrl ? await storageProvider.getSignedUrl(p.fileUrl as string, 900) : "",
      uploadedFile: await attachmentRefHref(p.uploadedFile as string | undefined),
    }))
  );

  return apiSuccess(withLinks, "Berhasil memuat data slip gaji", { page, limit, total });
});

/* ------------------------------------------------------------------ */
/* POST — generate                                                      */
/* ------------------------------------------------------------------ */

const generateSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periode harus berformat YYYY-MM"),
  employeeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1, "Pilih minimal satu karyawan"),
  /** Draft lets Finance review numbers before employees can see them. */
  publish: z.boolean().default(true),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "write");
  const body = await parseBody(req, generateSchema);

  if (body.period > wibPeriodKey()) {
    throw BadRequest("Periode payroll tidak boleh melebihi bulan berjalan.");
  }
  if (body.employeeIds.length > 500) {
    throw BadRequest("Maksimal 500 karyawan per proses. Bagi menjadi beberapa batch.");
  }

  const settings = await getSettings();
  const companyName = String(settings.company_name);
  const companyAddress = String(settings.company_address);

  const results: unknown[] = [];
  const errors: Array<{ id: string; name?: string; message: string }> = [];

  for (const empId of body.employeeIds) {
    try {
      // An uploaded slip is HR's final word for that period; recalculating
      // would silently replace it.
      const uploaded = await Payroll.exists({ employeeId: empId, period: body.period, source: "uploaded" });
      if (uploaded) {
        errors.push({ id: empId, message: "Periode ini memakai slip PDF yang diunggah. Hapus slip unggahan itu dulu bila ingin menghitung otomatis." });
        continue;
      }

      const calc = await calculatePayroll(empId, body.period);
      if (calc.problem) {
        errors.push({ id: empId, name: calc.employee.name, message: calc.problem });
        continue;
      }

      await queueCapReview(empId, ctx.user.id, calc.decisionEvidence, settings);

      const slipHtml = renderSlip({
        companyName,
        companyAddress,
        period: body.period,
        employeeName: calc.employee.name,
        nip: calc.employee.employeeId,
        taxStatus: calc.employee.taxStatus,
        basicSalary: calc.basicSalary,
        overtimePay: calc.overtimeSalary,
        overtimeHours: calc.overtimeHours,
        allowanceLines: calc.allowances,
        deductionLines: calc.deductions,
        gross: calc.totalEarnings,
        totalDeductions: calc.totalDeductions,
        netSalary: calc.netSalary,
        presentDays: calc.presentDays,
        workingDays: calc.workingDays,
        absentDays: calc.absentDays,
        leaveDays: calc.leaveDays,
      });

      const fileKey = await storageProvider.upload(
        Buffer.from(slipHtml, "utf-8"),
        `payrolls/${empId}/${body.period}.html`,
        "text/html"
      );

      const payroll = await Payroll.findOneAndUpdate(
        { employeeId: empId, period: body.period },
        {
          basicSalary: calc.basicSalary,
          incentives: calc.incentives,
          allowances: calc.allowances,
          deductions: calc.deductions,
          overtimeSalary: calc.overtimeSalary,
          overtimeHours: calc.overtimeHours,
          lateMinutes: calc.lateMinutes,
          absentDays: calc.absentDays,
          presentDays: calc.presentDays,
          workingDays: calc.workingDays,
          totalEarnings: calc.totalEarnings,
          totalDeductions: calc.totalDeductions,
          netSalary: calc.netSalary,
          targetAchievement: calc.targetAchievement,
          notes: calc.notes,
          decisionEvidence: calc.decisionEvidence,
          source: "generated",
          uploadedFile: "",
          uploadedFileName: "",
          fileUrl: fileKey,
          generatedBy: ctx.user.id,
          generatedAt: new Date(),
          status: body.publish ? "published" : "draft",
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      if (body.publish) {
        const recipients = await resolveRecipientForEmployee(empId);
        void notifyUsers(recipients, {
          kind: "payroll",
          title: `Slip gaji ${formatPeriod(body.period)} sudah terbit`,
          body: `Gaji bersih Anda periode ${formatPeriod(body.period)} sebesar ${formatRupiah(calc.netSalary)}. Buka portal untuk melihat rinciannya.`,
          href: "/portal/payroll",
        });
      }

      results.push(payroll);
    } catch (err) {
      errors.push({ id: empId, message: (err as Error).message });
    }
  }

  void logActivity({
    userId: ctx.user.id,
    action: "GENERATE_PAYROLL",
    module: "payroll",
    after: { period: body.period, generated: results.length, failed: errors.length, publish: body.publish },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { results, errors },
    errors.length
      ? `${results.length} slip gaji berhasil dibuat, ${errors.length} gagal. Periksa daftar kegagalan.`
      : `${results.length} slip gaji periode ${formatPeriod(body.period)} berhasil dibuat.`
  );
});

/* ------------------------------------------------------------------ */
/* PATCH — publish drafts, or attach an uploaded PDF slip               */
/* ------------------------------------------------------------------ */

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(500),
  }),
  z.object({
    action: z.literal("upload"),
    employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    file: attachmentInputSchema,
    /** Optional totals so period summaries still add up. */
    netSalary: z.number().min(0).max(1e12).optional(),
    totalEarnings: z.number().min(0).max(1e12).optional(),
    totalDeductions: z.number().min(0).max(1e12).optional(),
    publish: z.boolean().default(true),
    replace: z.boolean().default(false),
  }),
]);

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "write");
  const body = await parseBody(req, patchSchema);

  if (body.action === "publish") {
    const drafts = await Payroll.find({ _id: { $in: body.ids }, status: "draft" })
      .select("employeeId period netSalary source")
      .lean<Array<{ _id: RecordId; employeeId: RecordId; period: string; netSalary: number; source?: string }>>();
    await Payroll.updateMany({ _id: { $in: drafts.map((d) => d._id) } }, { $set: { status: "published" } });
    for (const d of drafts) {
      const recipients = await resolveRecipientForEmployee(d.employeeId);
      void notifyUsers(recipients, {
        kind: "payroll",
        title: `Slip gaji ${formatPeriod(d.period)} sudah terbit`,
        body:
          d.source === "uploaded"
            ? `Slip gaji periode ${formatPeriod(d.period)} tersedia di portal.`
            : `Gaji bersih Anda periode ${formatPeriod(d.period)} sebesar ${formatRupiah(d.netSalary)}. Buka portal untuk melihat rinciannya.`,
        href: "/portal/payroll",
      });
    }
    void logActivity({ userId: ctx.user.id, action: "PUBLISH_PAYROLL", module: "payroll", after: { count: drafts.length }, ip: ctx.ip, userAgent: ctx.userAgent });
    return apiSuccess({ published: drafts.length }, `${drafts.length} slip gaji diterbitkan dan karyawan diberi tahu.`);
  }

  // upload
  const existing = await Payroll.findOne({ employeeId: body.employeeId, period: body.period });
  if (existing?.status === "published" && !body.replace) {
    throw BadRequest("Karyawan ini sudah punya slip terbit untuk periode tersebut. Centang Ganti slip yang sudah terbit bila memang ingin menggantinya.");
  }
  const employee = await Employee.findById(body.employeeId).select("name").lean<{ name: string } | null>();
  if (!employee) throw BadRequest("Karyawan tidak ditemukan.");

  const key = await resolveSingleAttachment({
    input: body.file,
    context: "document",
    ownerUserId: ctx.user.id,
    destination: `payrolls/${body.employeeId}/uploaded`,
  });

  const payroll = await Payroll.findOneAndUpdate(
    { employeeId: body.employeeId, period: body.period },
    {
      source: "uploaded",
      decisionEvidence: null,
      uploadedFile: key,
      uploadedFileName: body.file.kind === "file" ? body.file.name ?? `Slip ${body.period}.pdf` : "Tautan slip gaji",
      basicSalary: 0,
      incentives: 0,
      allowances: [],
      deductions: [],
      overtimeSalary: 0,
      overtimeHours: 0,
      targetAchievement: null,
      totalEarnings: body.totalEarnings ?? body.netSalary ?? 0,
      totalDeductions: body.totalDeductions ?? 0,
      netSalary: body.netSalary ?? 0,
      notes: ["Slip gaji dari berkas PDF yang diunggah HRD."],
      fileUrl: "",
      generatedBy: ctx.user.id,
      generatedAt: new Date(),
      status: body.publish ? "published" : "draft",
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (body.publish) {
    const recipients = await resolveRecipientForEmployee(body.employeeId);
    void notifyUsers(recipients, {
      kind: "payroll",
      title: `Slip gaji ${formatPeriod(body.period)} sudah terbit`,
      body: `Slip gaji periode ${formatPeriod(body.period)} tersedia di portal.`,
      href: "/portal/payroll",
    });
  }

  void logActivity({
    userId: ctx.user.id,
    action: "UPLOAD_PAYSLIP",
    module: "payroll",
    after: { employee: employee.name, period: body.period, publish: body.publish, replaced: Boolean(existing) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { _id: payroll._id },
    `Slip gaji ${employee.name} periode ${formatPeriod(body.period)} ${body.publish ? "diterbitkan" : "disimpan sebagai draf"}.`
  );
});

/* ------------------------------------------------------------------ */
/* DELETE — remove a draft                                              */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "delete");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID slip gaji wajib disertakan.");

  const payroll = await Payroll.findById(id);
  if (!payroll) throw BadRequest("Slip gaji tidak ditemukan.");
  if (payroll.status === "published") {
    throw Forbidden(
      "Slip gaji yang sudah terbit tidak dapat dihapus demi jejak audit. Terbitkan revisi dengan menghasilkan ulang periode tersebut."
    );
  }

  if (payroll.fileUrl) await storageProvider.delete(payroll.fileUrl).catch(() => {});
  if (payroll.uploadedFile && !/^https?:/i.test(payroll.uploadedFile)) {
    await storageProvider.delete(payroll.uploadedFile).catch(() => {});
  }
  await payroll.deleteOne();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_PAYROLL_DRAFT",
    module: "payroll",
    before: payroll.toObject(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, "Draf slip gaji dihapus.");
});

/* ------------------------------------------------------------------ */
/* Slip rendering                                                       */
/* ------------------------------------------------------------------ */

interface SlipData {
  companyName: string;
  companyAddress: string;
  period: string;
  employeeName: string;
  nip: string;
  taxStatus: string;
  basicSalary: number;
  overtimePay: number;
  overtimeHours: number;
  allowanceLines: Array<{ name: string; amount: number }>;
  deductionLines: Array<{ name: string; amount: number }>;
  gross: number;
  totalDeductions: number;
  netSalary: number;
  presentDays: number;
  workingDays: number;
  absentDays: number;
  leaveDays: number;
}

/** Self-contained printable slip. All interpolated values are escaped. */
function renderSlip(d: SlipData): string {
  const row = (label: string, amount: number, strong = false) =>
    `<tr${strong ? ' class="strong"' : ""}><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(
      formatRupiah(amount)
    )}</td></tr>`;

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Slip Gaji ${escapeHtml(d.employeeName)} — ${escapeHtml(formatPeriod(d.period))}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",Helvetica,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;background:#f6f7f9}
  .sheet{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e3e7ed;border-radius:12px;padding:36px}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0f172a;padding-bottom:18px;margin-bottom:24px}
  h1{margin:0;font-size:18px;letter-spacing:.02em}
  .muted{color:#55637a;font-size:12px;line-height:1.6;margin:4px 0 0}
  .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px;margin-bottom:26px;font-size:13px}
  .meta div span{color:#55637a;display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#55637a;margin:24px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:7px 0;border-bottom:1px solid #eef0f4}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .strong td{font-weight:700;border-top:1px solid #cfd6e0;border-bottom:none}
  .net{margin-top:26px;padding:16px 20px;background:#e8efff;border-radius:10px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:16px}
  footer{margin-top:28px;font-size:11px;color:#7b8798;line-height:1.7;border-top:1px solid #eef0f4;padding-top:14px}
  @media print{body{background:#fff;padding:0}.sheet{border:none;border-radius:0}}
</style></head>
<body><div class="sheet">
  <header>
    <div>
      <h1>SLIP GAJI KARYAWAN</h1>
      <p class="muted">Periode ${escapeHtml(formatPeriod(d.period))}</p>
    </div>
    <div style="text-align:right">
      <strong style="font-size:13px">${escapeHtml(d.companyName)}</strong>
      <p class="muted">${escapeHtml(d.companyAddress)}</p>
    </div>
  </header>

  <div class="meta">
    <div><span>Nama Karyawan</span>${escapeHtml(d.employeeName)}</div>
    <div><span>NIP</span>${escapeHtml(d.nip)}</div>
    <div><span>Status Pajak</span>${escapeHtml(d.taxStatus)}</div>
    <div><span>Kehadiran</span>${d.presentDays} dari ${d.workingDays} hari kerja${
      d.leaveDays ? ` · ${d.leaveDays} hari cuti` : ""
    }${d.absentDays ? ` · ${d.absentDays} hari alpha` : ""}</div>
  </div>

  <h2>Penghasilan</h2>
  <table>
    ${row("Gaji Pokok", d.basicSalary)}
    ${d.allowanceLines.map((a) => row(a.name, a.amount)).join("")}
    ${d.overtimePay > 0 ? row(`Lembur (${d.overtimeHours} jam)`, d.overtimePay) : ""}
    ${row("Total Penghasilan", d.gross, true)}
  </table>

  <h2>Potongan</h2>
  <table>
    ${d.deductionLines.length ? d.deductionLines.map((x) => row(x.name, x.amount)).join("") : '<tr><td colspan="2" style="color:#7b8798">Tidak ada potongan pada periode ini.</td></tr>'}
    ${row("Total Potongan", d.totalDeductions, true)}
  </table>

  <div class="net"><span>GAJI BERSIH DITERIMA</span><span>${escapeHtml(formatRupiah(d.netSalary))}</span></div>

  <footer>
    Dokumen ini dihasilkan otomatis oleh sistem HRIS dan sah tanpa tanda tangan basah.
    Bila terdapat selisih perhitungan, ajukan keberatan ke HRD paling lambat 7 hari sejak slip diterbitkan.
    Dilarang menyebarluaskan dokumen ini kepada pihak yang tidak berkepentingan.
  </footer>
</div></body></html>`;
}
