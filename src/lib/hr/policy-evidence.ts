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
  result: {late:number;absent:number;total:number};
  attendance: Array<{ id: string; date: string; lateMinutes: number }>;
  absentDates: string[];
}
