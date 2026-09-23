import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * Employee master record.
 *
 * Encryption note: NIK, NPWP, and the bank account number are stored encrypted,
 * but the ciphering is done explicitly in the API layer (`encryptOnce` on write,
 * `decrypt`/`maskTail` on read) rather than through Mongoose `set`/`get` hooks.
 *
 * The hook approach was subtly broken: `.lean()` queries bypass getters, so the
 * same field came back decrypted from one query and encrypted from another, and
 * re-saving a document that had been read plainly encrypted the value a second
 * time. Doing it at the boundary also lets the API decide *who* is allowed to
 * see the real value instead of always decrypting.
 */

interface Address {
  street: string;
  subdistrict: string;
  city: string;
  province: string;
  country: string;
}

export interface IEmployee extends Document {
  employeeId: string;
  name: string;
  /** Encrypted at rest. */
  nik: string;
  birthPlace: string;
  birthDate?: Date;
  gender?: "male" | "female";
  religion: string;
  maritalStatus: string;
  ktpAddress: Address;
  domicileAddress: Address;
  personalEmail: string;
  officeEmail: string;
  phone: string;
  socialMedia: Record<string, string>;
  /** Encrypted at rest. */
  npwp: string;
  taxStatus: string;
  bpjsKesehatan: string;
  bpjsKetenagakerjaan: string;
  bankAccount: {
    bankName: string;
    /** Encrypted at rest. */
    accountNumber: string;
    accountHolder: string;
  };
  branchId?: RecordId;
  divisionId?: RecordId;
  positionId?: RecordId;
  supervisorId?: RecordId | null;
  storeManagerId?: RecordId | null;
  areaManagerId?: RecordId | null;
  joinDate?: Date;
  employmentStatus: "probation" | "pkwt" | "pkwtt" | "magang" | "harian_lepas" | "paruh_waktu" | "outsource" | "lainnya";
  status: "active" | "onboarding" | "suspended" | "resigned";
  /** Storage key of the profile photo. */
  photoUrl: string;
  documents: Array<{ category: string; fileUrl: string; fileName: string }>;
  /**
   * Created from a hired candidate and not yet completed by HR. The record
   * only holds what the candidate supplied; NIK, NPWP, bank details and the
   * rest still have to be filled in, and the flag keeps these people visible
   * until someone does.
   */
  isNewHire: boolean;
  /** Weekly shift template that applies unless a date has its own override. */
  workScheduleId?: RecordId | null;
  hiredFromCandidateId?: RecordId | null;
  profileCompletedAt?: Date | null;
}

const addressSchema = {
  street: { type: String, default: "" },
  subdistrict: { type: String, default: "" },
  city: { type: String, default: "" },
  province: { type: String, default: "" },
  country: { type: String, default: "Indonesia" },
};

const EmployeeSchema = new Schema<IEmployee>(
  {
    employeeId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true, trim: true },
    nik: { type: String, default: "" },
    birthPlace: { type: String, default: "" },
    birthDate: { type: Date },
    gender: { type: String, enum: ["male", "female"] },
    religion: { type: String, default: "" },
    maritalStatus: { type: String, default: "" },

    ktpAddress: addressSchema,
    domicileAddress: addressSchema,

    // Sparse unique: an employee without a personal address on file must not
    // collide with every other employee who also lacks one.
    personalEmail: { type: String, default: "", lowercase: true, trim: true },
    officeEmail: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: "" },
    socialMedia: { type: Schema.Types.Mixed, default: {} },

    npwp: { type: String, default: "" },
    taxStatus: { type: String, default: "TK/0" },
    bpjsKesehatan: { type: String, default: "" },
    bpjsKetenagakerjaan: { type: String, default: "" },
    bankAccount: {
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      accountHolder: { type: String, default: "" },
    },

    // Posting fields are optional at creation: HR frequently registers an
    // onboarding employee before their branch/division is finalised. Attendance
    // refuses to run without a branch and says so clearly.
    branchId: { type: Schema.Types.Id, ref: "Branch", index: true },
    divisionId: { type: Schema.Types.Id, ref: "Division", index: true },
    positionId: { type: Schema.Types.Id, ref: "Position", index: true },
    supervisorId: { type: Schema.Types.Id, ref: "Employee", default: null },
    storeManagerId: { type: Schema.Types.Id, ref: "Employee", default: null },
    areaManagerId: { type: Schema.Types.Id, ref: "Employee", default: null },

    joinDate: { type: Date, index: true },
    employmentStatus: {
      type: String,
      enum: ["probation", "pkwt", "pkwtt", "magang", "harian_lepas", "paruh_waktu", "outsource", "lainnya"],
      default: "probation",
    },
    status: {
      type: String,
      enum: ["active", "onboarding", "suspended", "resigned"],
      default: "onboarding",
      required: true,
      index: true,
    },
    photoUrl: { type: String, default: "" },
    isNewHire: { type: Boolean, default: false, index: true },
    workScheduleId: { type: Schema.Types.Id, ref: "WorkSchedule", default: null, index: true },
    hiredFromCandidateId: { type: Schema.Types.Id, ref: "Candidate", default: null },
    profileCompletedAt: { type: Date, default: null },
    documents: [
      {
        category: { type: String, required: true },
        fileUrl: { type: String, required: true },
        fileName: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

// Supports the branch/division-scoped employee lists without a collection scan.
EmployeeSchema.index({ status: 1, branchId: 1, divisionId: 1 });
EmployeeSchema.index({ personalEmail: 1 }, { unique: true, sparse: true, partialFilterExpression: { personalEmail: { $gt: "" } } });

export default database.models.Employee || database.model<IEmployee>("Employee", EmployeeSchema);
