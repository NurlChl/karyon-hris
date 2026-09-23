import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface ICandidate extends Document {
  name: string;
  email: string;
  phone: string;
  source: "career_page" | "api" | "manual";
  /** The opening applied to. Null only for legacy rows created before
   *  vacancies were separated from org positions. */
  vacancyId?: RecordId | null;
  positionId?: RecordId | null;
  /** Cover letter or HR's intake note. */
  coverLetter?: string;
  /** Portfolio / LinkedIn supplied on the public form. */
  portfolioUrl?: string;
  /** Set when the candidate is rejected, shown in the timeline. */
  rejectionReason?: string;
  currentStage: string; // e.g. 'Apply', 'Screening CV', 'Offering', 'Onboarding'
  status: "pending" | "in_progress" | "passed" | "rejected" | "on_hold";
  cvUrl?: string;
  notes?: string;
  offeringSalary?: number;

  /** Every answer from the application form, with labels as they were then. */
  answers: Array<Record<string, unknown>>;
  /* Copies of a few answers, so lists can be searched, filtered and sorted
     without unpacking every application. The answers above stay the record. */
  addressText: string;
  city: string;
  lastEducation: string;
  availableFrom?: Date | null;
  expectedSalary?: number | null;
  hasCv: boolean;
  /** HR's own 0–5 assessment; 0 means not rated yet. */
  rating: number;
  tags: string[];
  /** Short code shown to the candidate after applying. */
  reference: string;
  /** Set once the candidate has been hired. */
  employeeId?: RecordId | null;
  hiredAt?: Date | null;
  /** Upcoming interview, kept on the candidate so lists can show it. */
  nextInterviewAt?: Date | null;
  lastActivityAt: Date;
}

const CandidateSchema = new Schema<ICandidate>(
  {
    name: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    source: { 
      type: String, 
      enum: ["career_page", "api", "manual"], 
      default: "career_page", 
      required: true 
    },
    vacancyId: { type: Schema.Types.Id, ref: "JobVacancy", default: null, index: true },
    positionId: { type: Schema.Types.Id, ref: "Position", default: null, index: true },
    coverLetter: { type: String, default: "" },
    portfolioUrl: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    currentStage: { type: String, default: "Apply", required: true },
    status: { 
      type: String, 
      enum: ["pending", "in_progress", "passed", "rejected", "on_hold"], 
      default: "pending",
      required: true,
      index: true
    },
    cvUrl: { type: String },
    notes: { type: String },
    offeringSalary: { type: Number },

    answers: { type: Schema.Types.Mixed, default: () => [] },
    addressText: { type: String, default: "" },
    city: { type: String, default: "", index: true },
    lastEducation: { type: String, default: "" },
    availableFrom: { type: Date, default: null },
    expectedSalary: { type: Number, default: null },
    hasCv: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    tags: { type: [String], default: [] },
    reference: { type: String, default: "", index: true },
    employeeId: { type: Schema.Types.Id, ref: "Employee", default: null },
    hiredAt: { type: Date, default: null },
    nextInterviewAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
  }
);

// One application per opening, not per person: a globally unique email meant a
// candidate who applied once could never apply to any other vacancy. The
// partial filter keeps legacy rows without a vacancy from colliding with each
// other on a null key.
CandidateSchema.index(
  { email: 1, vacancyId: 1 },
  { unique: true, partialFilterExpression: { vacancyId: { $type: "objectId" } } }
);
// Backs the per-vacancy applicant board.
CandidateSchema.index({ vacancyId: 1, currentStage: 1 });
// Backs the all-applicants list: filtered by status, newest first.
CandidateSchema.index({ status: 1, createdAt: -1 });
// Free-text search across the fields people actually search by.
CandidateSchema.index({ name: "text", email: "text", phone: "text", city: "text" });

export default database.models.Candidate || database.model<ICandidate>("Candidate", CandidateSchema);
