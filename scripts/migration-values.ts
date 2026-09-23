import type { DynamicValue } from "../packages/database/schema";
export function convertSource(value:DynamicValue):DynamicValue {
  if(value==null)return value;
  if(value instanceof Date)return new Date(value);
  if(value._bsontype==="ObjectId")return value.toHexString();
  if(value._bsontype==="Decimal128"||value._bsontype==="Long")return value.toString();
  if(value._bsontype==="Binary")return {$binary:Buffer.from(value.buffer).toString("base64"),subType:value.sub_type};
  if(Array.isArray(value))return value.map(convertSource);
  if(typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,convertSource(item)]));
  return value;
}
export function canonical(value:DynamicValue):string {
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(value===undefined)return "null";
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
