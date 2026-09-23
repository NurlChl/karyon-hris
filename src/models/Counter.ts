import database, { Schema, Document } from "@/lib/postgres";

export interface ICounter extends Document {
  key: string;
  seq: number;
}

/**
 * Atomic sequence generator.
 *
 * Used for human-readable ids (employee NIP, asset codes) where deriving the
 * next value from `countDocuments()` would collide under concurrent writes and
 * reuse numbers after a deletion.
 */
const CounterSchema = new Schema<ICounter>({
  key: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, required: true, default: 0 },
});

export default database.models.Counter || database.model<ICounter>("Counter", CounterSchema);
