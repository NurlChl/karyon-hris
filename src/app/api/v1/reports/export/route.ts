import { wrapRouteHandler } from "@/lib/api";
import {
  requireUser,
  scopeFilter,
  employeeRecordScopeFilter,
  BadRequest,
  Forbidden,
  type GuardContext,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { decrypt, maskTail } from "@/lib/crypto";
import {
  formatDate,
  formatDateTime,
  formatPeriod,
  wibEndOfMonth,
  wibPeriodKey,
  wibStartOfMonth,
} from "@/lib/time";
import { CORRECTION_REASON_LABELS, EMPLOYEE_STATUS_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/hr/labels";
import Attendance from "@/models/Attendance";
import Employee from "@/models/Employee";
import LeaveRequest from "@/models/LeaveRequest";
import Payroll from "@/models/Payroll";
import AttendanceCorrection from "@/models/AttendanceCorrection";
import { requireProFeature } from "@/lib/licensing/server";

/**
 * CSV export for every list module.
 *
 * CSV (UTF-8 with BOM so Excel in Indonesian locales opens it correctly) keeps
 * the export dependency-free and openable everywhere. Each export is written to
 * the audit log, which the spec requires.
 */

type Dataset = "attendance" | "leave" | "payroll" | "employees" | "corrections";

const DATASET_MODULE: Record<Dataset, string> = {
  attendance: "attendance",
  leave: "leave",
  payroll: "payroll",
  employees: "employees",
  corrections: "attendance",
};

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  await requireProFeature("analytics.advanced");
  const sp = new URL(req.url).searchParams;
  const dataset = (sp.get("dataset") ?? "attendance") as Dataset;
  const period = sp.get("period") ?? wibPeriodKey();

  if (!DATASET_MODULE[dataset]) {
    throw BadRequest(`Jenis laporan "${dataset}" tidak dikenali.`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw BadRequest("Periode harus berformat YYYY-MM.");
  }

  const perm = await checkPermission(ctx.user.id, DATASET_MODULE[dataset], "export");
  if (!perm.allowed) {
    throw Forbidden(`Peran ${ctx.user.role} tidak memiliki izin mengekspor laporan ${dataset}.`);
  }

  const start = wibStartOfMonth(period);
  const end = wibEndOfMonth(period);

  const { rows, headers } = await buildRows(dataset, start, end, {
    ...ctx,
    permission: perm,
  });

  void logActivity({
    userId: ctx.user.id,
    action: "EXPORT_REPORT",
    module: DATASET_MODULE[dataset],
    after: { dataset, period, rowCount: rows.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const csv = toCsv(headers, rows);
  const filename = `${dataset}-${period}.csv`;

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

async function buildRows(
  dataset: Dataset,
  start: Date,
  end: Date,
  ctx: GuardContext
): Promise<{ headers: string[]; rows: Array<Array<string | number>> }> {
  const employeeRecordFilter = await employeeRecordScopeFilter(ctx);

  if (dataset === "attendance") {
    const logs = await Attendance.find({
      ...employeeRecordFilter,
      date: { $gte: start, $lte: end },
    })
      .populate({ path: "employeeId", select: "name employeeId branchId divisionId", populate: { path: "branchId", select: "name" } })
      .sort({ date: 1 })
      .limit(20000)
      .lean();

    return {
      headers: [
        "Tanggal", "NIP", "Nama", "Cabang", "Jam Masuk", "Istirahat Keluar",
        "Istirahat Masuk", "Jam Pulang", "Terlambat (menit)", "Pulang Awal (menit)",
        "Jarak (m)", "Lintas Cabang", "Kendala Lokasi", "Perlu Ditinjau", "Catatan",
      ],
      rows: logs.map((l) => {
        const emp = l.employeeId as unknown as { name?: string; employeeId?: string; branchId?: { name?: string } } | null;
        return [
          formatDate(l.date),
          emp?.employeeId ?? "-",
          emp?.name ?? "-",
          emp?.branchId?.name ?? "-",
          timeOnly(l.clockIn),
          timeOnly(l.breakOut),
          timeOnly(l.breakIn),
          timeOnly(l.clockOut),
          l.isLate ? l.lateMinutes ?? 0 : 0,
          l.isEarlyLeave ? l.earlyLeaveMinutes ?? 0 : 0,
          l.distanceMeter ?? "",
          l.isCrossBranch ? "Ya" : "Tidak",
          l.isLocationOverride ? "Ya" : "Tidak",
          l.needsReview ? "Ya" : "Tidak",
          l.note ?? "",
        ];
      }),
    };
  }

  if (dataset === "leave") {
    const requests = await LeaveRequest.find({
      ...employeeRecordFilter,
      startDate: { $lte: end },
      endDate: { $gte: start },
    })
      .populate("employeeId", "name employeeId")
      .populate("leaveTypeId", "name")
      .sort({ startDate: 1 })
      .limit(20000)
      .lean();

    return {
      headers: ["NIP", "Nama", "Jenis", "Mulai", "Selesai", "Hari Kerja", "Hari Kalender", "Status", "Alasan", "Diajukan"],
      rows: requests.map((r) => {
        const emp = r.employeeId as unknown as { name?: string; employeeId?: string } | null;
        return [
          emp?.employeeId ?? "-",
          emp?.name ?? "-",
          (r.leaveTypeId as unknown as { name?: string } | null)?.name ?? "-",
          formatDate(r.startDate),
          formatDate(r.endDate),
          r.chargedDays ?? 0,
          r.calendarDays ?? 0,
          r.status,
          r.reason ?? "",
          formatDateTime(r.createdAt),
        ];
      }),
    };
  }

  if (dataset === "payroll") {
    const period = wibPeriodKey(start);
    const payrolls = await Payroll.find({ ...employeeRecordFilter, period })
      .populate("employeeId", "name employeeId")
      .sort({ createdAt: 1 })
      .limit(20000)
      .lean();

    return {
      headers: [
        "Periode", "NIP", "Nama", "Gaji Pokok", "Lembur", "Total Penghasilan",
        "Total Potongan", "Gaji Bersih", "Menit Telat", "Hari Alpha", "Status",
      ],
      rows: payrolls.map((p) => {
        const emp = p.employeeId as unknown as { name?: string; employeeId?: string } | null;
        return [
          formatPeriod(p.period as string),
          emp?.employeeId ?? "-",
          emp?.name ?? "-",
          p.basicSalary ?? 0,
          p.overtimeSalary ?? 0,
          p.totalEarnings ?? 0,
          p.totalDeductions ?? 0,
          p.netSalary ?? 0,
          p.lateMinutes ?? 0,
          p.absentDays ?? 0,
          p.status as string,
        ];
      }),
    };
  }

  if (dataset === "corrections") {
    const rows = await AttendanceCorrection.find({
      ...employeeRecordFilter,
      date: { $gte: start, $lte: end },
    })
      .populate("employeeId", "name employeeId")
      .sort({ date: 1 })
      .limit(20000)
      .lean();

    return {
      headers: ["Tanggal", "NIP", "Nama", "Jam Masuk", "Jam Pulang", "Kategori Alasan", "Keterangan", "Melebihi Kuota", "Status"],
      rows: rows.map((c) => {
        const emp = c.employeeId as unknown as { name?: string; employeeId?: string } | null;
        return [
          formatDate(c.date),
          emp?.employeeId ?? "-",
          emp?.name ?? "-",
          c.clockInTime as string,
          c.clockOutTime as string,
          CORRECTION_REASON_LABELS[c.reasonType as string] ?? (c.reasonType as string),
          c.reasonNote as string,
          c.isOverQuota ? "Ya" : "Tidak",
          c.status as string,
        ];
      }),
    };
  }

  // employees
  const employees = await Employee.find(
    scopeFilter(ctx, {
      employee: "_id",
      branch: "branchId",
      division: "divisionId",
    })
  )
    .populate("branchId", "name")
    .populate("divisionId", "name")
    .populate("positionId", "name")
    .sort({ name: 1 })
    .limit(20000)
    .lean();

  return {
    headers: [
      "NIP", "Nama", "Email Kantor", "Telepon", "Cabang", "Divisi", "Jabatan",
      "Tanggal Masuk", "Status Kepegawaian", "Status", "NPWP", "Bank", "No. Rekening",
    ],
    rows: employees.map((e) => [
      (e.employeeId as string) ?? "-",
      (e.name as string) ?? "-",
      (e.officeEmail as string) ?? "",
      (e.phone as string) ?? "",
      (e.branchId as unknown as { name?: string } | null)?.name ?? "-",
      (e.divisionId as unknown as { name?: string } | null)?.name ?? "-",
      (e.positionId as unknown as { name?: string } | null)?.name ?? "-",
      formatDate(e.joinDate as Date),
      EMPLOYMENT_STATUS_LABELS[e.employmentStatus as string] ?? (e.employmentStatus as string) ?? "-",
      EMPLOYEE_STATUS_LABELS[e.status as string] ?? (e.status as string) ?? "-",
      // Only a company-wide grant may export plaintext financial identifiers.
      e.npwp
        ? ctx.permission.scope === "all"
          ? decrypt(e.npwp as string)
          : maskTail(e.npwp as string)
        : "",
      (e.bankAccount as { bankName?: string } | undefined)?.bankName ?? "",
      (e.bankAccount as { accountNumber?: string } | undefined)?.accountNumber
        ? ctx.permission.scope === "all"
          ? decrypt((e.bankAccount as { accountNumber: string }).accountNumber)
          : maskTail((e.bankAccount as { accountNumber: string }).accountNumber)
        : "",
    ]),
  };
}

function timeOnly(value: Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/**
 * Serialises to CSV. Values starting with a formula character are prefixed with
 * a tab so a malicious employee name such as `=cmd|…` cannot execute when the
 * file is opened in Excel (CSV injection).
 */
function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escapeCell = (value: string | number) => {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join(
    "\r\n"
  );
}
