import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, parseFairFaceCsv } from "../eval/make-manifest.ts";
import { validateManifest } from "../eval/manifest.ts";

const csv = ["file,age,gender,race,service_test"]
  .concat(Array.from({ length: 30 }, (_, i) => `val/${i}.jpg,20-29,${i % 2 ? "Female" : "Male"},White,True`))
  .join("\n");

test("parseFairFaceCsv", () => {
  const rows = parseFairFaceCsv(csv);
  assert.equal(rows.length, 30);
  assert.equal(rows.filter((r) => r.gender === "female").length, 15);
  assert.throws(() => parseFairFaceCsv("a,b\n1,2"));
});

test("buildManifest: عدد متساوٍ، حتمي، ويجتاز التحقق", () => {
  const rows = parseFairFaceCsv(csv);
  const m1 = buildManifest({ rows, perClass: 10, seed: 7, prefix: "ff/", noneFiles: ["n/a.jpg", "n/b.jpg", "n/c.jpg"], noneCount: 2 });
  const m2 = buildManifest({ rows, perClass: 10, seed: 7, prefix: "ff/", noneFiles: ["n/a.jpg", "n/b.jpg", "n/c.jpg"], noneCount: 2 });
  assert.deepEqual(m1, m2);
  assert.equal(m1.entries.filter((e) => e.gender === "female").length, 10);
  assert.equal(m1.entries.filter((e) => e.gender === "male").length, 10);
  assert.equal(m1.entries.filter((e) => e.gender === "none").length, 2);
  assert.ok(m1.entries.every((e) => e.path.startsWith("ff/") || e.path.startsWith("n/")));
  validateManifest(m1);
  assert.match(m1.source!, /CC BY 4\.0/);
});

test("buildManifest: يرفض إن لم تكفِ الصور", () => {
  assert.throws(() => buildManifest({ rows: parseFairFaceCsv(csv), perClass: 50 }), /لا يكفي/);
});
