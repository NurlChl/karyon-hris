/** Shared deterministic attendance deduction engine. No database writes. */
export interface AttendancePolicy {
  lateUnit?: "minute" | "hour" | "day";
  alphaEnabled?: boolean;
  alphaAfterHours?: number;
  latePerMinute: number;
  latePenaltyCap: number;
  absentPerDay: number;
}
export interface AttendanceFacts {
  lateDays?: number;
  lateMinutes: number;
  absentDays: number;
  exemptLate: boolean;
  exemptAbsent: boolean;
}
export function attendanceDeductions(facts: AttendanceFacts, policy: AttendancePolicy) {
  for (const value of [facts.lateMinutes, facts.absentDays, policy.latePerMinute, policy.latePenaltyCap, policy.absentPerDay]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Data perhitungan potongan tidak valid.");
  }
  const quantity = lateQuantity(facts, policy.lateUnit ?? "minute");
  let late = facts.exemptLate ? 0 : quantity * policy.latePerMinute;
  if (policy.latePenaltyCap > 0) late = Math.min(late, policy.latePenaltyCap);
  const absent = facts.exemptAbsent ? 0 : facts.absentDays * policy.absentPerDay;
  return { late, absent, total: late + absent };
}
export function lateQuantity(facts: AttendanceFacts, unit: NonNullable<AttendancePolicy["lateUnit"]>): number {
  if (unit === "minute") return facts.lateMinutes;
  if (unit === "hour") return facts.lateMinutes / 60;
  if (unit !== "day" || !Number.isFinite(facts.lateDays) || facts.lateDays! < 0) throw new Error("Jumlah hari terlambat tidak tersedia.");
  return facts.lateDays!;
}

/** Group by date to avoid double charging; a converted day never pays both penalties. */
export function classifyLateness(logs: Array<{ date: string; lateMinutes: number }>, policy: AttendancePolicy, absentDates: string[]) {
  const days = new Map<string, number>();
  for (const log of logs) {
    if (!Number.isFinite(log.lateMinutes) || log.lateMinutes < 0) throw new Error("Menit terlambat tidak valid.");
    days.set(log.date, Math.max(days.get(log.date) ?? 0, log.lateMinutes));
  }
  if (policy.alphaEnabled && (!Number.isFinite(policy.alphaAfterHours) || policy.alphaAfterHours! <= 0)) throw new Error("Ambang alpha tidak valid.");
  const convertedDates = [...days].filter(([, minutes]) => policy.alphaEnabled && minutes > policy.alphaAfterHours! * 60).map(([date]) => date);
  const absent = new Set([...absentDates, ...convertedDates]);
  const charged = [...days].filter(([date, minutes]) => !absent.has(date) && minutes > 0);
  return { lateMinutes: charged.reduce((sum, [, minutes]) => sum + minutes, 0), lateDays: charged.length, absentDays: absent.size, absentDates: [...absent].sort(), convertedDates };
}
export interface DecisionEvidence {
  engineVersion: "attendance-deductions-v1" | "attendance-deductions-v2";
  convertedDates?: string[];
  unconvertedAbsentDates?: string[];
  capExceeded?: boolean;
  uncappedLate?: number;
  rulesFingerprint: string;
  capturedAt: string;
  period: string;
  policy: AttendancePolicy;
  facts: AttendanceFacts;
  result: ReturnType<typeof attendanceDeductions>;
  attendance: Array<{ id: string; date: string; lateMinutes: number }>;
  absentDates: string[];
}
