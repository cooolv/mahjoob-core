// يتحقق أن نسخة TypeScript ما زالت تطابق المتجهات المشتركة (spec/vectors) التي تعتمد عليها نسخة Java.
// إن تغيّر سلوك النواة عمدًا: أعد توليدها بـ node --experimental-strip-types spec/gen-vectors.ts وحدّث نسخة Java.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide, DEFAULT_POLICY, decodeYuNet, resizeRegion, letterbox, toCHW } from "../src/index.ts";
import type { PersonDetection, Policy, TargetGender } from "../src/index.ts";

const read = (name: string) =>
  readFileSync(new URL(`../../../spec/vectors/${name}`, import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));
const opt = (s: string) => (s === "-" ? undefined : Number(s));
const unhex = (h: string) => Uint8ClampedArray.from(Buffer.from(h, "hex"));

test("متجهات السياسة (decide) تطابق", () => {
  const rows = read("policy.tsv");
  assert.ok(rows.length > 1000);
  for (const [target, strict, thr, minP, minG, dets, eAction, eReason, eRegions] of rows) {
    const detections: PersonDetection[] = dets === "-" ? [] : dets!.split(";").map((d) => {
      const [x, y, w, h, c, pf, gc] = d.split(",");
      return { box: { x: +x!, y: +y!, width: +w!, height: +h! }, confidence: +c!, pFemale: opt(pf!), genderConfidence: opt(gc!) };
    });
    const policy: Policy = { ...DEFAULT_POLICY, target: target as TargetGender, strict: strict === "true",
      blockThreshold: +thr!, minPersonConfidence: +minP!, minGenderConfidence: +minG! };
    const d = decide(detections, policy);
    const regions = d.regions.length === 0 ? "-" : d.regions.map((b) => [b.x, b.y, b.width, b.height].join(",")).join(";");
    assert.deepEqual([d.action, d.reason, regions], [eAction, eReason, eRegions], `${target} ${strict} ${thr} ${dets}`);
  }
});

test("متجهات معالجة الصور (resize/letterbox/toCHW) تطابق", () => {
  let n = 0;
  for (const row of read("image.tsv")) {
    const kind = row[0];
    const w = +row[1]!, h = +row[2]!;
    const img = { data: unhex(row[3]!), width: w, height: h };
    if (kind === "RESIZE") {
      const out = resizeRegion(img, +row[4]!, +row[5]!, +row[6]!, +row[7]!, +row[8]!, +row[9]!);
      assert.equal(Buffer.from(out.data).toString("hex"), row[10]);
    } else if (kind === "LETTERBOX") {
      const lb = letterbox(img, +row[4]!, +row[5]!, 114, row[6] === "true");
      assert.deepEqual([lb.scale, lb.padX, lb.padY], [+row[7]!, +row[8]!, +row[9]!]);
      assert.equal(Buffer.from(lb.image.data).toString("hex"), row[10]);
    } else if (kind === "CHW") {
      const f = toCHW(img, { scale: opt(row[4]!), mean: row[5] === "-" ? undefined : row[5]!.split(",").map(Number) as [number, number, number],
        std: row[6] === "-" ? undefined : row[6]!.split(",").map(Number) as [number, number, number], bgr: row[7] === "true" });
      assert.deepEqual(Array.from(f), row[8]!.split(",").map(Number));
    }
    n++;
  }
  assert.ok(n >= 50);
});

test("متجهات YuNet تطابق", () => {
  const rows = read("yunet.tsv");
  assert.equal(rows.length, 18);
  for (const row of rows) {
    const w = +row[1]!, h = +row[2]!;
    const outs: Record<string, { data: Float32Array; dims: number[] }> = {};
    for (const part of row[5]!.split("|")) {
      const [name, vals] = part.split("=");
      const data = Float32Array.from(vals!.split(",").map(Number));
      outs[name!] = { data, dims: [1, data.length, 1] };
    }
    const c = decodeYuNet(outs, w, h, { scoreThreshold: +row[3]!, iouThreshold: +row[4]! });
    const got = c.length === 0 ? "-" : c.map((x) => [x.box.x, x.box.y, x.box.width, x.box.height, x.score].join(",")).join(";");
    assert.equal(got, row[6]);
  }
});
