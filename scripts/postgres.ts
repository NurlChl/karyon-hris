import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrateSchema, purgeExpired, schemaStatements } from "../packages/database/migrations";

async function main() {
  const app = process.argv.find(a=>a.startsWith("--app="))?.slice(6);
  const action = process.argv.find(a=>a.startsWith("--action="))?.slice(9) || "plan";
  if (!["hris","control-plane"].includes(app || "")) throw new Error("Use --app=hris or --app=control-plane");
  if (!["plan","apply","check","cleanup","inspect"].includes(action)) throw new Error("Unsupported action");
  await import("../src/lib/postgres-models");
  const { default: database } = await import("../src/lib/postgres");
  try {
    if (action === "plan") {
      // Generated SQL artifact, not a database mutation.
      const output = resolve(`postgres-${app}-schema.sql`);
      await writeFile(output, "-- Generated from registered model definitions. Apply using db:migrate, not manually.\n"+schemaStatements(database).join(";\n\n")+";\n");
      console.log(JSON.stringify({app, tables:database.repositories.size, schema:output}));
    } else if (action === "apply") console.log(JSON.stringify(await migrateSchema(database)));
    else if (action === "cleanup") console.log(JSON.stringify({deletedExpired:await purgeExpired(database)}));
    else if (action === "inspect") {
      const tables = await database.connection.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename");
      const counts: Record<string, number> = {};
      for (const { tablename } of tables.rows) {
        if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) continue;
        const result = await database.connection.query(`SELECT count(*)::int AS count FROM "${tablename}"`);
        counts[tablename] = result.rows[0].count;
      }
      const tls = await database.connection.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()");
      console.log(JSON.stringify({app, tables: counts, tls: tls.rows[0]?.ssl ?? null}, null, 2));
    } else { await database.connect(); console.log(JSON.stringify({app,postgresql:"connected"})); }
  } finally { await database.disconnect(); }
}
main().catch(error=>{console.error("PostgreSQL command failed", {code:error?.code || "VALIDATION", message:/required|Unsupported|Use --app|Schema changed/.test(error?.message) ? error.message : "Check configuration/schema; connection strings and records are not logged."});process.exitCode=1;});
