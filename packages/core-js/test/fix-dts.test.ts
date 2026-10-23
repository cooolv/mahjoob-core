import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fix-dts: يحوّل الاستيرادات النسبية فقط ولا يمسّ غيرها", () => {
  const d = mkdtempSync(join(tmpdir(), "fixdts-"));
  mkdirSync(join(d, "sub"));
  writeFileSync(join(d, "a.d.ts"), [
    'export * from "./types.ts";',
    "export type { X } from './sub/y.ts';",
    'import type { Z } from "../up/z.ts";',
    'import("./lazy.ts");',
    'import type { Ok } from "./already.js";',
    'import type { Pkg } from "some-pkg/file.ts";',
    'export declare const s: "keep.ts";',
  ].join("\n"));
  writeFileSync(join(d, "sub", "b.d.ts"), 'export * from "../a.ts";\n');
  writeFileSync(join(d, "c.js"), 'export * from "./d.ts";\n');   // ملفات js لا تُمسّ
  execFileSync("node", [join(import.meta.dirname, "..", "scripts", "fix-dts.mjs"), d]);

  const a = readFileSync(join(d, "a.d.ts"), "utf8").split("\n");
  assert.equal(a[0], 'export * from "./types.js";');
  assert.equal(a[1], "export type { X } from './sub/y.js';");
  assert.equal(a[2], 'import type { Z } from "../up/z.js";');
  assert.equal(a[3], 'import("./lazy.js");');
  assert.equal(a[4], 'import type { Ok } from "./already.js";');
  assert.equal(a[5], 'import type { Pkg } from "some-pkg/file.ts";');   // حزم خارجية لا تُمسّ
  assert.equal(a[6], 'export declare const s: "keep.ts";');
  assert.equal(readFileSync(join(d, "sub", "b.d.ts"), "utf8"), 'export * from "../a.js";\n');
  assert.equal(readFileSync(join(d, "c.js"), "utf8"), 'export * from "./d.ts";\n');
});
