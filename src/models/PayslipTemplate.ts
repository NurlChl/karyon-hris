import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import {
  BLOCK_TYPES,
  DEFAULT_BLOCKS,
  DEFAULT_EMPLOYEE_FIELDS,
  DEFAULT_FOOTER_NOTE,
  type BlockType,
  type PayslipBlockShape,
} from "@/lib/hr/payslip";

/**
 * Layout definition for a payslip.
 *
 * The slip is composed of ordered **blocks** rather than a free-form canvas.
 * A canvas editor sounds more flexible but produces slips that break the moment
 * an employee has one extra allowance line, because absolute positions cannot
 * reflow. Blocks reflow naturally, survive a variable number of rows, and still
 * give real control: which blocks appear, in what order, and what each shows.
 *
 * Companies that would rather use their own pre-made document can set
 * `mode: "upload"` and attach a file per period instead.
 *
 * The block vocabulary itself lives in `lib/hr/payslip` so the builder UI can
 * import it without dragging Mongoose into the browser bundle.
 */

export type { BlockType };
export type IPayslipBlock = PayslipBlockShape;

export interface IPayslipTemplate extends Document {
  name: string;
  description: string;
  mode: "builder" | "upload";
  isDefault: boolean;

  /* --- presentation --- */
  paperSize: "A4" | "Letter";
  accentColor: string;
  /** Base font size in px; everything else scales from it. */
  baseFontSize: number;
  /** Page margin in millimetres. */
  margin: number;
  showLogo: boolean;
  /** Data URL, inlined so printing never waits on a network fetch. */
  logoUrl: string;
  /** Printed height in millimetres. */
  logoHeight: number;

  /* --- content --- */
  companyName: string;
  companyAddress: string;
  documentTitle: string;
  footerNote: string;
  /** Fields from the employee record to print in the info block. */
  employeeFields: string[];
  signatories: Array<{ label: string; name: string }>;

  blocks: PayslipBlockShape[];

  createdBy?: RecordId;
  createdAt: Date;
  updatedAt: Date;
}

const BlockSchema = new Schema<PayslipBlockShape>(
  {
    type: { type: String, enum: BLOCK_TYPES, required: true },
    enabled: { type: Boolean, default: true },
    title: { type: String, default: "" },
    options: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const PayslipTemplateSchema = new Schema<IPayslipTemplate>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    mode: { type: String, enum: ["builder", "upload"], default: "builder" },
    isDefault: { type: Boolean, default: false, index: true },

    paperSize: { type: String, enum: ["A4", "Letter"], default: "A4" },
    accentColor: { type: String, default: "#4f46e5" },
    baseFontSize: { type: Number, default: 12, min: 9, max: 16 },
    margin: { type: Number, default: 18, min: 5, max: 40 },
    showLogo: { type: Boolean, default: false },
    logoUrl: { type: String, default: "" },
    logoHeight: { type: Number, default: 14, min: 6, max: 40 },

    companyName: { type: String, default: "" },
    companyAddress: { type: String, default: "" },
    documentTitle: { type: String, default: "SLIP GAJI KARYAWAN" },
    footerNote: { type: String, default: DEFAULT_FOOTER_NOTE },
    employeeFields: { type: [String], default: DEFAULT_EMPLOYEE_FIELDS },
    signatories: {
      type: [{ label: String, name: String }],
      default: [
        { label: "Diterima oleh", name: "" },
        { label: "Disetujui oleh", name: "" },
      ],
    },

    blocks: { type: [BlockSchema], default: DEFAULT_BLOCKS },

    createdBy: { type: Schema.Types.Id, ref: "User" },
  },
  { timestamps: true }
);

export default database.models.PayslipTemplate ||
  database.model<IPayslipTemplate>("PayslipTemplate", PayslipTemplateSchema);
