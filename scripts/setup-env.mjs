import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) throw new Error(".env already exists: preserved; edit it manually.");
let text=readFileSync(".env.example","utf8");
for(const name of ["HRIS_DB_PASSWORD","AUTH_SECRET","NEXTAUTH_SECRET","ENCRYPTION_KEY","STORAGE_SIGNING_SECRET","CRON_SECRET","SEED_ADMIN_PASSWORD","SEED_STAFF_PASSWORD"]) {const value=randomBytes(32).toString("hex");text=text.replace(new RegExp("^"+name+"=.*$","m"),name+"="+value);}
writeFileSync(".env",text,{flag:"wx",mode:0o600});
console.log("Created .env with random secrets. Review database settings and public URL. Keep this file private.");

