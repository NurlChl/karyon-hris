/**
 * What is still missing from an employee record.
 *
 * A hired applicant arrives with only what they typed into the application
 * form. These are the fields payroll, BPJS reporting and attendance need before
 * the record can be trusted. Kept free of server imports so the employees page
 * can show the same checklist the API uses to clear the "Baru" flag.
 */

interface Address {
  street?: string;
  city?: string;
}

export interface CompletenessInput {
  nik?: string;
  birthPlace?: string;
  birthDate?: unknown;
  religion?: string;
  maritalStatus?: string;
  phone?: string;
  ktpAddress?: Address | null;
  domicileAddress?: Address | null;
  bankAccount?: { bankName?: string; accountNumber?: string; accountHolder?: string } | null;
  branchId?: unknown;
  divisionId?: unknown;
  positionId?: unknown;
  joinDate?: unknown;
}

const has = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined);

/** Required before the "Baru" flag clears on its own. */
export function missingProfileFields(e: CompletenessInput): string[] {
  const missing: string[] = [];
  if (!has(e.nik)) missing.push("NIK");
  if (!has(e.birthPlace)) missing.push("Tempat lahir");
  if (!has(e.birthDate)) missing.push("Tanggal lahir");
  if (!has(e.religion)) missing.push("Agama");
  if (!has(e.maritalStatus)) missing.push("Status pernikahan");
  if (!has(e.phone)) missing.push("Nomor telepon");
  if (!has(e.ktpAddress?.street) || !has(e.ktpAddress?.city)) missing.push("Alamat KTP");
  if (!has(e.domicileAddress?.street) || !has(e.domicileAddress?.city)) missing.push("Alamat domisili");
  if (!has(e.bankAccount?.bankName) || !has(e.bankAccount?.accountNumber) || !has(e.bankAccount?.accountHolder)) {
    missing.push("Rekening bank");
  }
  if (!has(e.branchId) || !has(e.divisionId) || !has(e.positionId)) missing.push("Penempatan");
  if (!has(e.joinDate)) missing.push("Tanggal mulai kerja");
  return missing;
}
