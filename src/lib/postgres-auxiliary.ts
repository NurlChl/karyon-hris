import database, { Schema } from "./postgres";
export const GeocodingCache = database.model("GeocodingCache", new Schema({ _id: String, expiresAt: { type: Date, expires: 0 }, places: { type: [Object], default: [] } }));
export const GeocodingLock = database.model("GeocodingLock", new Schema({ _id: String, availableAt: Date }));
export const DemoSeedRun = database.model("DemoSeedRun", new Schema({ _id: String, period: String, cutoffDay: String, lockUntil: Date, completedAt: Date }));
