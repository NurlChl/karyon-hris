import type { DynamicValue } from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type PoolConfig } from "pg";

export type SqlExecutor = { query(text: string, values?: DynamicValue[]): Promise<{ rows: DynamicValue[]; rowCount?: number | null }> };
const registry = globalThis as typeof globalThis & { __postgresPools?: Map<string, Pool> };
const pools = registry.__postgresPools ??= new Map();
export class Connection {
  private context = new AsyncLocalStorage<SqlExecutor>();
  constructor(public prefix: string, public testDriver?: SqlExecutor) {}
  config(): PoolConfig {
    const env = (key: string) => process.env[`${this.prefix}${key}`];
    const url = env("DATABASE_URL");
    const config: PoolConfig = { max: Number(env("DB_POOL_MAX") || 10), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000, application_name: this.prefix || "hris" };
    if (url) {
      const parsed = new URL(url);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("DATABASE_URL must use PostgreSQL");
      // TLS policy is explicit; do not silently disable certificate verification.
      if ([...parsed.searchParams.keys()].some(k => k.startsWith("ssl"))) throw new Error("Configure DB_SSL and DB_SSL_CA_FILE separately from DATABASE_URL");
      config.connectionString = url;
    } else {
      if (!env("DB_HOST") || !env("DB_NAME") || !env("DB_USER") || !env("DB_PASSWORD")) throw new Error(`${this.prefix}DB_HOST/DB_NAME/DB_USER/DB_PASSWORD required`);
      Object.assign(config, { host: env("DB_HOST"), port: Number(env("DB_PORT") || 5432), database: env("DB_NAME"), user: env("DB_USER"), password: env("DB_PASSWORD") });
    }
    if (!Number.isInteger(config.max) || config.max! < 1 || config.max! > 100) throw new Error("Invalid DB_POOL_MAX");
    const ssl = env("DB_SSL") || "disable";
    if (!["disable", "verify-full"].includes(ssl)) throw new Error("DB_SSL must be disable or verify-full");
    config.ssl = ssl === "disable" ? false : { rejectUnauthorized: true, ...(env("DB_SSL_CA_FILE") ? { ca: readFileSync(env("DB_SSL_CA_FILE")!, "utf8") } : {}) };
    return config;
  }
  pool(): Pool {
    const key = this.prefix;
    let pool = pools.get(key);
    if (!pool) { pool = new Pool(this.config()); pool.on("error", () => console.error("PostgreSQL idle connection failed")); pools.set(key, pool); }
    return pool;
  }
  async query(text: string, values: DynamicValue[] = []) { return (this.context.getStore() || this.testDriver || this.pool()).query(text, values); }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    const client: SqlExecutor | PoolClient = this.testDriver || await this.pool().connect();
    try {
      await client.query("BEGIN");
      const result = await this.context.run(client, work);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { if ("release" in client) (client as PoolClient).release(); }
  }
  async close() { const pool = pools.get(this.prefix); if (pool) { pools.delete(this.prefix); await pool.end(); } }
}
