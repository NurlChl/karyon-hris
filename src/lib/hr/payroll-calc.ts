import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { getSettings } from "@/lib/settings";
import { holidayMap } from "@/lib/hr/calendar";
import { recurringFor, targetIncentive, type PayItem, type TargetRule } from "@/lib/hr/pay-rules";
import { eachDayKey, formatRupiah, isWeekendKey, wibDateKey, wibEndOfMonth, wibStartOfMonth } from "@/lib/time";
import Employee from "@/models/Employee";
import Contract from "@/models/Contract";
import Attendance from "@/models/Attendance";
import OvertimeRecord from "@/models/OvertimeRecord";
import LeaveRequest from "@/models/LeaveRequest";
import PayProfile from "@/models/PayProfile";
import PayrollInput from "@/models/PayrollInput";
import { sha256 } from "@/lib/crypto";
import { attendanceDeductions, classifyLateness, lateQuantity, type DecisionEvidence, type AttendancePolicy } from "./policy-evidence";

export interface PayrollLine {
  name: string;
  amount: number;
}

export interface PayrollCalculation {
  decisionEvidence: DecisionEvidence;
  employee: { _id: string; name: string; employeeId: string; taxStatus: string };
  period: string;
  basicSalary: number;
  basicSource: string;
  allowances: PayrollLine[];
  deductions: PayrollLine[];
  overtimeHours: number;
  overtimeSalary: number;
  incentives: number;
  lateMinutes: number;
  absentDays: number;
  presentDays: number;
  workingDays: number;
  leaveDays: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  targetAchievement: { name: string; target: number; actual: number; pct: number; amount: number; explanation: string } | null;
  /** Plain-language notes on how figures were reached, shown on the review screen. */
  notes: string[];
  /** Blocking problem; when set, no slip should be produced. */
  problem?: string;
  /** Non-blocking things worth a second look. */
  warnings: string[];
}

/**
 * Calculates one employee's payslip for a period without saving anything.
 *
 * Earnings: contract basic salary, contract allowance, recurring earnings from
 * the pay profile, this period's one-off earnings, target incentive, overtime
 * (if the profile pays it). Deductions: lateness and absence (unless exempt),
 * BPJS, recurring and one-off deductions, then PPh 21 on what remains above the
 * threshold.
 */
export async function calculatePayroll(employeeId: string, period: string): Promise<PayrollCalculation> {
  const settings = await getSettings();
  const rates = {
    latePerMinute: Number(settings.payroll_late_penalty_per_minute),
    latePenaltyCap: Number(settings.payroll_late_penalty_cap),
    overtimePerHour: Number(settings.payroll_overtime_rate_per_hour) * (settings.payroll_overtime_unit === "minute" ? 60 : 1),
    absentPerDay: Number(settings.payroll_absent_penalty_per_day),
    bpjsKesPct: Number(settings.payroll_bpjs_kesehatan_pct),
    bpjsTkPct: Number(settings.payroll_bpjs_tk_pct),
    pph21Pct: Number(settings.payroll_pph21_pct),
    pph21Threshold: Number(settings.payroll_pph21_threshold),
    defaultBasic: Number(settings.payroll_default_basic_salary),
  };

  const monthStart = wibStartOfMonth(period);
  const monthEnd = wibEndOfMonth(period);
  const dayKeys = eachDayKey(monthStart, monthEnd);
  const holidays = await holidayMap(dayKeys[0], dayKeys[dayKeys.length - 1]);
  const workingDayKeys = dayKeys.filter((k) => !isWeekendKey(k) && !holidays.has(k));
  const todayKey = wibDateKey();
  const elapsedWorkingDays = workingDayKeys.filter((k) => k <= todayKey);

  const [employee, contract, profile, input] = await Promise.all([
    Employee.findById(employeeId)
      .select("name employeeId taxStatus")
      .lean<{ _id: RecordId; name: string; employeeId: string; taxStatus?: string } | null>(),
    // The contract in force during the period, not merely the latest one.
    Contract.findOne({
      employeeId,
      status: { $in: ["active", "ended", "expired"] },
      startDate: { $lte: monthEnd },
      $or: [{ endDate: null }, { endDate: { $gte: monthStart } }],
    })
      .sort({ startDate: -1 })
      .lean<{ contractNumber?: string; salarySnapshot?: { basicSalary?: number; allowances?: number } } | null>(),
    PayProfile.findOne({ employeeId }).lean<{
      overtimeMode: "company_rate" | "custom_rate" | "none";
      overtimeRate: number;
      exemptLatePenalty: boolean;
      exemptAbsentPenalty: boolean;
      recurring: PayItem[];
      target: TargetRule;
    } | null>(),
    PayrollInput.findOne({ employeeId, period }).lean<{
      adjustments: PayItem[];
      targetActual: number | null;
      targetNote?: string;
    } | null>(),
  ]);

  if (!employee) throw new Error("Karyawan tidak ditemukan");

  const notes: string[] = [];
  const warnings: string[] = [];

  /* --- base ---------------------------------------------------------- */
  const basicSalary = contract?.salarySnapshot?.basicSalary || rates.defaultBasic;
  const contractAllowance = contract?.salarySnapshot?.allowances ?? 0;
  const basicSource = contract?.salarySnapshot?.basicSalary
    ? `Kontrak ${contract.contractNumber || "aktif"}`
    : "Gaji pokok default (Pengaturan)";
  let problem: string | undefined;
  if (!basicSalary) {
    problem = "Belum ada kontrak dengan nominal gaji pada periode ini, dan gaji pokok default belum diatur di Pengaturan Payroll.";
  }

  /* --- attendance ---------------------------------------------------- */
  const logs = await Attendance.find({ employeeId, date: { $gte: monthStart, $lte: monthEnd } }).lean<
    Array<{ _id: RecordId; date: Date; isLate: boolean; lateMinutes: number }>
  >();
  const presentKeys = new Set(logs.map((l) => wibDateKey(new Date(l.date))));

  const approvedLeaves = await LeaveRequest.find({
    employeeId,
    status: "approved",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  }).lean<Array<{ startDate: Date; endDate: Date }>>();
  const leaveKeys = new Set<string>();
  for (const lv of approvedLeaves) for (const k of eachDayKey(lv.startDate, lv.endDate)) leaveKeys.add(k);
  const originalAbsentKeys = elapsedWorkingDays.filter((k) => !presentKeys.has(k) && !leaveKeys.has(k));

  const policy: AttendancePolicy = { latePerMinute: rates.latePerMinute, latePenaltyCap: rates.latePenaltyCap, absentPerDay: rates.absentPerDay, lateUnit: settings.payroll_late_unit as AttendancePolicy["lateUnit"], alphaEnabled: Boolean(settings.payroll_late_alpha_enabled), alphaAfterHours: Number(settings.payroll_late_alpha_hours) };
  const sourceLogs = logs.map((log) => ({ id: String(log._id), date: wibDateKey(new Date(log.date)), lateMinutes: log.isLate ? log.lateMinutes || 0 : 0 })).sort((a, b) => a.date.localeCompare(b.date));
  const classified = classifyLateness(sourceLogs.filter((log) => !leaveKeys.has(log.date)), policy, originalAbsentKeys);
  const { lateMinutes, absentDates: absentKeys } = classified;
  const facts = { lateMinutes, lateDays: classified.lateDays, absentDays: classified.absentDays, exemptLate: Boolean(profile?.exemptLatePenalty), exemptAbsent: Boolean(profile?.exemptAbsentPenalty) };
  const result = attendanceDeductions(facts, policy);
  const { late: latePenalty, absent: absentPenalty } = result;
  const decisionEvidence: DecisionEvidence = {
    engineVersion: "attendance-deductions-v2",
    unconvertedAbsentDates: originalAbsentKeys,
    convertedDates: classified.convertedDates,
    uncappedLate: facts.exemptLate ? 0 : lateQuantity(facts, policy.lateUnit ?? "minute") * policy.latePerMinute,
    capExceeded: !facts.exemptLate && policy.latePenaltyCap > 0 && lateQuantity(facts, policy.lateUnit ?? "minute") * policy.latePerMinute > policy.latePenaltyCap,
    rulesFingerprint: sha256(JSON.stringify(policy)),
    capturedAt: new Date().toISOString(), period, policy, facts, result,
    attendance: sourceLogs.filter((log) => !leaveKeys.has(log.date)),
    absentDates: absentKeys,
  };
  notes.push(`Tarif telat ${formatRupiah(policy.latePerMinute)} per ${policy.lateUnit === "day" ? "hari terlambat" : policy.lateUnit === "hour" ? "jam (proporsional)" : "menit"}; ${classified.convertedDates.length} hari dialihkan menjadi alpha, tanpa potongan telat ganda.`);
  if (profile?.exemptLatePenalty && lateMinutes) notes.push(`Terlambat ${lateMinutes} menit, tidak dipotong (dikecualikan di profil gaji).`);
  if (profile?.exemptAbsentPenalty && absentKeys.length) notes.push(`${absentKeys.length} hari tanpa keterangan, tidak dipotong (dikecualikan).`);

  /* --- overtime ------------------------------------------------------ */
  const overtimes = await OvertimeRecord.find({ employeeId, date: { $gte: monthStart, $lte: monthEnd }, status: "approved" }).lean<
    Array<{ hours: number }>
  >();
  const overtimeHours = Math.round(overtimes.reduce((s, o) => s + (o.hours || 0), 0) * 100) / 100;
  const overtimeMode = profile?.overtimeMode ?? "company_rate";
  const overtimeRate = overtimeMode === "custom_rate" ? profile?.overtimeRate ?? 0 : overtimeMode === "company_rate" ? rates.overtimePerHour : 0;
  const overtimeSalary = Math.round(overtimeHours * overtimeRate);
  if (overtimeHours) {
    notes.push(
      overtimeMode === "none"
        ? `Lembur ${overtimeHours} jam tidak dibayar (sesuai profil gaji).`
        : `Lembur ${overtimeHours} jam × ${formatRupiah(overtimeRate)} (${overtimeMode === "custom_rate" ? "tarif khusus" : "tarif perusahaan"}).`
    );
  }

  /* --- profile & period items ---------------------------------------- */
  const recurring = recurringFor(profile?.recurring ?? [], period);
  const oneOff = (input?.adjustments ?? []).filter((a) => a.amount > 0);

  let targetAchievement: PayrollCalculation["targetAchievement"] = null;
  if (profile?.target?.enabled) {
    const result = targetIncentive(profile.target, input?.targetActual);
    if (result) {
      targetAchievement = {
        name: profile.target.name,
        target: profile.target.targetValue,
        actual: input!.targetActual!,
        pct: result.achievementPct,
        amount: result.amount,
        explanation: result.explanation,
      };
      notes.push(result.explanation + ".");
    } else {
      warnings.push(`${profile.target.name}: capaian periode ini belum diisi, insentif target belum dihitung.`);
    }
  }
  const incentives = targetAchievement?.amount ?? 0;

  const allowances: PayrollLine[] = [
    ...(contractAllowance > 0 ? [{ name: "Tunjangan tetap", amount: contractAllowance }] : []),
    ...recurring.filter((i) => i.kind === "earning").map((i) => ({ name: i.name, amount: i.amount })),
    ...oneOff.filter((i) => i.kind === "earning").map((i) => ({ name: i.name, amount: i.amount })),
    ...(incentives > 0 ? [{ name: `Insentif ${targetAchievement!.name.toLowerCase()} (${targetAchievement!.pct}%)`, amount: incentives }] : []),
  ];

  /* --- statutory & totals -------------------------------------------- */
  const bpjsKesehatan = Math.round((basicSalary * rates.bpjsKesPct) / 100);
  const bpjsKetenagakerjaan = Math.round((basicSalary * rates.bpjsTkPct) / 100);

  const gross = basicSalary + allowances.reduce((s, a) => s + a.amount, 0) + overtimeSalary;
  const otherDeductions: PayrollLine[] = [
    ...recurring.filter((i) => i.kind === "deduction").map((i) => ({ name: i.name, amount: i.amount })),
    ...oneOff.filter((i) => i.kind === "deduction").map((i) => ({ name: i.name, amount: i.amount })),
  ];
  const preTax = latePenalty + absentPenalty + bpjsKesehatan + bpjsKetenagakerjaan;
  const taxableBase = gross - preTax;
  const taxAmount = taxableBase > rates.pph21Threshold ? Math.round(((taxableBase - rates.pph21Threshold) * rates.pph21Pct) / 100) : 0;

  const deductions = [
    { name: `Potongan keterlambatan (${lateMinutes} menit)`, amount: latePenalty },
    { name: `Potongan alpha (${absentKeys.length} hari)`, amount: absentPenalty },
    { name: `BPJS Kesehatan (${rates.bpjsKesPct}%)`, amount: bpjsKesehatan },
    { name: `BPJS Ketenagakerjaan (${rates.bpjsTkPct}%)`, amount: bpjsKetenagakerjaan },
    ...otherDeductions,
    { name: `PPh 21 (${rates.pph21Pct}%)`, amount: taxAmount },
  ].filter((d) => d.amount > 0);

  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const netSalary = gross - totalDeductions;
  if (netSalary < 0) warnings.push("Gaji bersih negatif: potongan melebihi penghasilan. Periksa potongan periode ini.");
  if (input?.targetNote) notes.push(`Catatan target: ${input.targetNote}`);

  return {
    decisionEvidence,
    employee: { _id: String(employee._id), name: employee.name, employeeId: employee.employeeId, taxStatus: employee.taxStatus ?? "-" },
    period,
    basicSalary,
    basicSource,
    allowances,
    deductions,
    overtimeHours,
    overtimeSalary,
    incentives,
    lateMinutes,
    absentDays: absentKeys.length,
    presentDays: presentKeys.size,
    workingDays: workingDayKeys.length,
    leaveDays: leaveKeys.size,
    totalEarnings: gross,
    totalDeductions,
    netSalary,
    targetAchievement,
    notes,
    problem,
    warnings,
  };
}
