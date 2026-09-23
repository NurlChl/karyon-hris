import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IDivision extends Document {
  name: string;
  headId?: RecordId | null;
  branchId?: RecordId | null;
}

const DivisionSchema = new Schema<IDivision>({
  name: { type: String, required: true, index: true },
  headId: { type: Schema.Types.Id, ref: "Employee", default: null },
  branchId: { type: Schema.Types.Id, ref: "Branch", default: null }
});

export default database.models.Division || database.model<IDivision>("Division", DivisionSchema);
