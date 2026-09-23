import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * A job opening.
 *
 * Deliberately separate from `Position`. A Position is a permanent entry in the
 * org chart that active employees point at; a vacancy is a time-bound opening
 * that gets published, filled, and closed. Conflating them meant closing a
 * vacancy deactivated the job title of everyone already holding it, and a
 * position could only ever be advertised once.
 */

export type VacancyStatus = "draft" | "open" | "closed" | "archived";

export interface IJobVacancy extends Document {
  title: string;
  /** URL-safe identifier used by the public career page. */
  slug: string;
  /** Org position this opening will fill; optional for a brand-new role. */
  positionId?: RecordId | null;
  divisionId?: RecordId | null;
  branchId?: RecordId | null;

  employmentType: "full_time" | "part_time" | "contract" | "internship" | "freelance";
  workArrangement: "onsite" | "hybrid" | "remote";
  /** Free-text location shown publicly; falls back to the branch name. */
  location: string;

  summary: string;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  benefits: string[];

  salaryMin: number;
  salaryMax: number;
  /** When false the range is stored for internal reference but never published. */
  showSalary: boolean;

  /** How many people are being hired; used to show remaining slots internally. */
  openings: number;
  /** Ordered selection stages for candidates of this vacancy. */
  stages: string[];
  /**
   * The application form for this vacancy. Empty on vacancies created before
   * forms were configurable; readers fall back to `defaultFormFields()`.
   * Validated by the API against `lib/hr/application-form`, stored loosely so
   * adding a field type later needs no migration.
   */
  formFields: Array<Record<string, unknown>>;

  status: VacancyStatus;
  publishedAt?: Date | null;
  closesAt?: Date | null;

  /** Denormalised counters so the list view does not aggregate on every load. */
  viewCount: number;
  applicantCount: number;

  createdBy?: RecordId;
  createdAt: Date;
  updatedAt: Date;
}

/** The stages a vacancy starts with when the creator does not customise them. */
export const DEFAULT_STAGES = [
  "Lamaran Masuk",
  "Seleksi Berkas",
  "Tes / Psikotes",
  "Interview HRD",
  "Interview User",
  "Penawaran",
  "Onboarding",
];

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Penuh waktu",
  part_time: "Paruh waktu",
  contract: "Kontrak",
  internship: "Magang",
  freelance: "Lepas",
};

export const WORK_ARRANGEMENT_LABELS: Record<string, string> = {
  onsite: "Di kantor",
  hybrid: "Hibrida",
  remote: "Jarak jauh",
};

const JobVacancySchema = new Schema<IJobVacancy>(
  {
    title: { type: String, required: true, trim: true, index: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    positionId: { type: Schema.Types.Id, ref: "Position", default: null },
    divisionId: { type: Schema.Types.Id, ref: "Division", default: null },
    branchId: { type: Schema.Types.Id, ref: "Branch", default: null },

    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "internship", "freelance"],
      default: "full_time",
    },
    workArrangement: {
      type: String,
      enum: ["onsite", "hybrid", "remote"],
      default: "onsite",
    },
    location: { type: String, default: "" },

    summary: { type: String, default: "" },
    responsibilities: [{ type: String }],
    requirements: [{ type: String }],
    niceToHave: [{ type: String }],
    benefits: [{ type: String }],

    salaryMin: { type: Number, default: 0, min: 0 },
    salaryMax: { type: Number, default: 0, min: 0 },
    showSalary: { type: Boolean, default: false },

    openings: { type: Number, default: 1, min: 1 },
    stages: { type: [String], default: DEFAULT_STAGES },
    formFields: { type: Schema.Types.Mixed, default: () => [] },

    status: {
      type: String,
      enum: ["draft", "open", "closed", "archived"],
      default: "draft",
      index: true,
    },
    publishedAt: { type: Date, default: null },
    closesAt: { type: Date, default: null },

    viewCount: { type: Number, default: 0 },
    applicantCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.Id, ref: "User" },
  },
  { timestamps: true }
);

// The public listing query: open vacancies, newest published first.
JobVacancySchema.index({ status: 1, publishedAt: -1 });

export default database.models.JobVacancy ||
  database.model<IJobVacancy>("JobVacancy", JobVacancySchema);
