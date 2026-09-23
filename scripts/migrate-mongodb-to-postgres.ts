import type { DynamicValue } from "../packages/database/schema";
/** One-way, non-destructive importer. MongoDB is only a read-only migration source. */
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { migrateSchema } from "../packages/database/migrations";
import { ident } from "../packages/database/schema";
import { canonical, convertSource } from "./migration-values";

async function main() {
  const app = process.argv.find(a=>a.startsWith("--app="))?.slice(6);
  const apply = process.argv.includes("--apply");
  if (!["hris","control-plane"].includes(app || "")) throw new Error("Use --app=hris or --app=control-plane");
  const uri=process.env.MIGRATION_MONGODB_URI_DIRECT || process.env.MIGRATION_MONGODB_URI;
  if (!uri) throw new Error("MIGRATION_MONGODB_URI required (read-only source account recommended)");
  if (apply && process.env.MIGRATION_SOURCE_FROZEN !== "true") throw new Error("MIGRATION_SOURCE_FROZEN=true required after stopping source writes");
  await import("../src/lib/postgres-models");
  const {default: target}=await import("../src/lib/postgres");
  const client = new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:10000});
  try {
    await client.connect(); const source=client.db();
    const namespaces=await source.listCollections({}, {nameOnly:true}).toArray();
    const pluralize=mongoose.pluralize()!;
    const aliases:Record<string,string>={GeocodingCache:"geocoding_cache",GeocodingLock:"geocoding_locks",DemoSeedRun:"demo_seed_runs"};
    const mapping=new Map([...target.repositories.values()].map((repository:DynamicValue)=>[aliases[repository.name]||pluralize(repository.name),repository]));
    const report: Array<{collection:string;target:string;count:number}>=[];
    for(const ns of namespaces) if(!ns.name.startsWith("system.")) report.push({collection:ns.name,target:(mapping.get(ns.name) as DynamicValue)?.table||"migration_source_documents (archive)",count:await source.collection(ns.name).countDocuments()});
    if(!apply){console.log(JSON.stringify({mode:"plan-only",app,collections:report},null,2));return;}
    await migrateSchema(target);
    await target.transaction(async()=>{
      await target.connection.query("SELECT pg_advisory_xact_lock(hashtext('mongo-to-postgres-import'))");
      // A migration is an offline maintenance operation. Longer budget is local to this transaction.
      await target.connection.query("SET LOCAL statement_timeout = '10min'");
      for(const repository of target.repositories.values() as Iterable<DynamicValue>) {
        const existing=await target.connection.query(`SELECT 1 FROM ${ident(repository.table)} LIMIT 1`);
        if(existing.rows.length)throw new Error("Target must be empty; never merge or overwrite existing data");
      }
      await target.connection.query('CREATE TABLE IF NOT EXISTS "migration_source_documents" (collection_name text NOT NULL, source_id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(collection_name,source_id))');
      const archiveExists=await target.connection.query('SELECT 1 FROM "migration_source_documents" LIMIT 1');
      if(archiveExists.rows.length)throw new Error("Target archive must be empty");
      for(const item of report) {
        const repository:DynamicValue=mapping.get(item.collection); let count=0; const digest=createHash("sha256");
        const cursor=source.collection(item.collection).find({}).sort({_id:1}).batchSize(250);
        try { for await (const document of cursor) {
          const sourceId=String(document._id);
          const raw=mongoose.mongo.BSON.EJSON.stringify(document,{relaxed:false});
          await target.connection.query('INSERT INTO "migration_source_documents" (collection_name,source_id,payload) VALUES ($1,$2,$3::jsonb)',[item.collection,sourceId,raw]);
          if(repository) {
            const value=convertSource(document);
            const inserted=await repository.insert(value,true);
            const read=await target.connection.query(`SELECT * FROM ${ident(repository.table)} WHERE "_id"=$1`,[sourceId]);
            if(canonical(repository.decode(read.rows[0]))!==canonical(inserted))throw new Error("Target readback verification failed");
          }
          digest.update(canonical(JSON.parse(raw))); count++;
        }} finally {await cursor.close();}
        if(count!==item.count)throw new Error("Source count changed during import; keep source writes stopped");
        // Re-read source and archive in deterministic order to catch concurrent edits or data loss.
        const verify=createHash("sha256"); const verifyCursor=source.collection(item.collection).find({}).sort({_id:1});
        try {for await(const document of verifyCursor){const raw=JSON.parse(mongoose.mongo.BSON.EJSON.stringify(document,{relaxed:false}));const archived=await target.connection.query('SELECT payload FROM "migration_source_documents" WHERE collection_name=$1 AND source_id=$2',[item.collection,String(document._id)]);if(canonical(archived.rows[0]?.payload)!==canonical(raw))throw new Error("Archive/source content mismatch");verify.update(canonical(raw));}} finally {await verifyCursor.close();}
        if(digest.digest("hex")!==verify.digest("hex"))throw new Error("Source changed during import");
        console.log(JSON.stringify({collection:item.collection,count,verified:true}));
      }
      await target.connection.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    console.log(JSON.stringify({app,status:"committed",source:"unchanged",verification:"row readback, source/archive hash and foreign keys"}));
  } finally {await client.close();await target.disconnect();}
}
main().catch(error=>{console.error("Migration not completed. Any active import transaction was rolled back; MongoDB source unchanged.",{code:error?.code || "VALIDATION",reason:/required|must be empty|changed during|mismatch|Unregistered|Schema changed|Use --app|Validation failed/.test(error?.message)?error.message:"Check schema constraints and connectivity. Records/credentials are not logged."});process.exitCode=1;});
