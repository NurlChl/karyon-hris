import database, { Schema, Document } from "@/lib/postgres";

export interface IContractTemplate extends Document {
  name: string;
  /** The contract type this template is offered for first. */
  type: string;
  /** Text with `{{placeholder}}` markers; see lib/hr/contracts.ts. */
  content: string;
  isActive: boolean;
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
  signerName: string;
  signerTitle: string;
  city: string;
}

const ContractTemplateSchema = new Schema<IContractTemplate>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, default: "pkwt" },
    content: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    showLogo: { type: Boolean, default: false },
    logoUrl: { type: String, default: "" },
    logoHeight: { type: Number, default: 14 },
    signerName: { type: String, default: "" },
    signerTitle: { type: String, default: "HRD Manager" },
    city: { type: String, default: "" },
  },
  { timestamps: true }
);

export default database.models.ContractTemplate ||
  database.model<IContractTemplate>("ContractTemplate", ContractTemplateSchema);
