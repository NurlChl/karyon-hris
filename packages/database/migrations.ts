import type { DynamicValue } from "./schema";
import { createHash } from "node:crypto";
import type { Database } from "./model";
import { descriptor, ident, literal, sqlType } from "./schema";
import { SqlBuilder } from "./query";

const name = (prefix: string, source: string) => `${prefix}_${createHash("sha256").update(source).digest("hex").slice(0,16)}`;
export function schemaStatements(database: Database) {
  const statements: string[] = [], relations: string[] = [];
  for (const repository of database.repositories.values()) {
    const table = ident(repository.table);
    const columns = Object.entries(repository.shape).map(([key, raw]) => {
      const field = descriptor(raw), column = ident(key), type = sqlType(raw);
      let sql = `${column} ${type}${key === "_id" ? " PRIMARY KEY" : field.required ? " NOT NULL" : ""}`;
      if (field.enum && type === "text") sql += ` CHECK (${column} IN (${field.enum.map(v=>literal(String(v))).join(",")}))`;
      if (type === "double precision") {
        sql += ` CHECK (${column} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))`;
        if (field.min !== undefined) sql += ` CHECK (${column} >= ${Number(field.min)})`;
        if (field.max !== undefined) sql += ` CHECK (${column} <= ${Number(field.max)})`;
      }
      if (type === "text" && field.maxlength !== undefined) sql += ` CHECK (length(${column}) <= ${Number(field.maxlength)})`;
      if (field.ref && type === "text") {
        const target = database.repositories.get(field.ref);
        if (!target) throw new Error(`Unregistered foreign key target ${field.ref}`);
        relations.push(`ALTER TABLE ${table} ADD CONSTRAINT ${ident(name("fk", `${repository.table}.${key}`))} FOREIGN KEY (${column}) REFERENCES ${ident(target.table)} ("_id") DEFERRABLE INITIALLY DEFERRED`);
      }
      return sql;
    });
    columns.push('"_extra" jsonb NOT NULL DEFAULT \'{}\'::jsonb', '"_version" bigint NOT NULL DEFAULT 0');
    statements.push(`CREATE TABLE ${table} (${columns.join(",\n")})`);
    const indexes = [...repository.schema.indexes];
    for (const [key, raw] of Object.entries(repository.shape)) { const field = descriptor(raw); if (field.unique || field.index) indexes.push({ fields: { [key]: 1 }, options: { unique: field.unique, sparse: field.sparse } }); }
    indexes.forEach((index, number) => {
      const keys = Object.keys(index.fields); let where = "";
      if (index.options.expireAfterSeconds !== undefined) return; // PostgreSQL retention is an explicit maintenance command.
      if (Object.values(index.fields).some(v=>v==="text")) {
        const expression = keys.map(k=>`COALESCE(${ident(k)}, '')`).join(" || ' ' || ");
        statements.push(`CREATE INDEX ${ident(name("fts", repository.table+number))} ON ${table} USING gin (to_tsvector('simple', ${expression}))`); return;
      }
      if (index.options.partialFilterExpression) {
        const filter = structuredClone(index.options.partialFilterExpression);
        for (const [key,value] of Object.entries(filter)) if ((value as DynamicValue)?.$type === "objectId") filter[key] = { $ne: null };
        const builder = new SqlBuilder(repository.shape, "");
        where = builder.condition(filter).replace(/\."/g,'"').replace(/\$(\d+)/g, (_match, number) => {
          const value = builder.values[Number(number)-1]; return value == null ? "NULL" : typeof value === "boolean" ? String(value) : literal(String(value));
        });
      } else if (index.options.sparse) where = keys.map(k=>`${ident(k)} IS NOT NULL`).join(" AND ");
      statements.push(`CREATE ${index.options.unique ? "UNIQUE " : ""}INDEX ${ident(name("idx", repository.table+number))} ON ${table} (${keys.map(k=>`${ident(k)} ${Number(index.fields[k])<0 ? "DESC" : "ASC"}`).join(",")})${where?` WHERE ${where}`:""}`);
    });
  }
  return [...statements, ...relations];
}

export async function migrateSchema(database: Database) {
  const statements = schemaStatements(database);
  const checksum = createHash("sha256").update(statements.join(";\n")).digest("hex");
  await database.transaction(async () => {
    await database.connection.query("SELECT pg_advisory_xact_lock(hashtext('hris-schema-migration'))");
    await database.connection.query('CREATE TABLE IF NOT EXISTS "_schema_migrations" (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const existing = await database.connection.query('SELECT checksum FROM "_schema_migrations" WHERE version=$1', ["001-postgresql"]);
    if (existing.rows.length) { if (existing.rows[0].checksum !== checksum) throw new Error("Schema changed: create a new migration; never overwrite an applied migration"); return; }
    for (const statement of statements) await database.connection.query(statement);
    await database.connection.query('INSERT INTO "_schema_migrations" (version,checksum) VALUES ($1,$2)', ["001-postgresql", checksum]);
  });
  return { tables: database.repositories.size, checksum };
}

export async function purgeExpired(database: Database) {
  let count = 0;
  for (const repository of database.repositories.values()) {
    const policies = Object.entries(repository.shape).filter(([,v])=>descriptor(v).expires !== undefined).map(([key,v])=>({ key, seconds: Number(descriptor(v).expires) }));
    for (const index of repository.schema.indexes) if (index.options.expireAfterSeconds !== undefined) policies.push({ key: Object.keys(index.fields)[0], seconds: Number(index.options.expireAfterSeconds) });
    for (const policy of policies) {
      const result = await database.connection.query(`DELETE FROM ${ident(repository.table)} WHERE ${ident(policy.key)} < now() - ($1 * interval '1 second')`, [policy.seconds]); count += result.rowCount ?? 0;
    }
  }
  return count;
}
