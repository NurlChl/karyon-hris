import test from "node:test";
import assert from "node:assert/strict";
import {chaptersForRole} from "./content";

test("administrator guide explains automatic Pro activation and subscription expiry",()=>{
  const sections=chaptersForRole("SUPERADMIN",null).flatMap(chapter=>chapter.sections);
  const license=sections.find(section=>section.id==="lisensi-pro");
  assert.ok(license);
  const text=JSON.stringify(license);
  assert.match(text,/pengunduhan image Pro privat dimulai otomatis/);
  assert.match(text,/tidak melampaui akhir langganan/);
  assert.doesNotMatch(text,/default 14 hari/);
});
test("employee documentation cannot request administrator installation instructions",()=>{
  const sections=chaptersForRole("STAFF","SUPERADMIN").flatMap(chapter=>chapter.sections);
  assert.ok(!sections.some(section=>["instalasi","lisensi-pro"].includes(section.id)));
});
