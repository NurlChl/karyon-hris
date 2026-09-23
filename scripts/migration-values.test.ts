import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { convertSource, canonical } from "./migration-values";
test("migration retains source IDs, dates, ciphertext and nested values",()=>{
  const id=new mongoose.Types.ObjectId();const date=new Date("2026-01-01T00:00:00Z");
  const result=convertSource({_id:id,ref:id,at:date,secret:"v1:encrypted-unchanged",nested:[{id,at:date}],unknown:{kept:true}});
  assert.equal(result._id,id.toHexString());assert.equal(result.ref,id.toHexString());
  assert.equal(result.at.toISOString(),date.toISOString());assert.equal(result.secret,"v1:encrypted-unchanged");
  assert.equal(result.nested[0].id,id.toHexString());assert.deepEqual(result.unknown,{kept:true});
  assert.equal(canonical({b:1,a:date}),canonical({a:date,b:1}));
});
