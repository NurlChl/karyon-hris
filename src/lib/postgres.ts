import { Database } from "../../packages/database/model";
export * from "../../packages/database/model";
const state = globalThis as typeof globalThis & { __hrisPostgres?: Database };
const database = state.__hrisPostgres ??= new Database("HRIS_");
export default database;
export const models = database.models;
export const model = database.model.bind(database);
