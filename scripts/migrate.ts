import database from "../src/lib/postgres";
import "../src/lib/postgres-models";
import { migrateSchema, purgeExpired } from "../packages/database/migrations";
(async()=>{
  try { console.log(process.argv.includes("--cleanup") ? {deletedExpired:await purgeExpired(database)} : await migrateSchema(database)); }
  catch(error) { console.error("PostgreSQL migration failed",{code:(error as {code?:string})?.code || "SCHEMA"});process.exitCode=1; }
  finally {await database.disconnect();}
})();
