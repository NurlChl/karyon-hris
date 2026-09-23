import database, { Schema, Document } from "@/lib/postgres";

export interface IBranch extends Document {
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusMeter: number; // default radius e.g. 15
  workHours: {
    start: string; // e.g. "09:00"
    end: string; // e.g. "17:00"
  };
}

const BranchSchema = new Schema<IBranch>({
  name: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  radiusMeter: { type: Number, default: 15, required: true },
  workHours: {
    start: { type: String, default: "09:00", required: true },
    end: { type: String, default: "17:00", required: true },
  },
});

export default database.models.Branch || database.model<IBranch>("Branch", BranchSchema);
