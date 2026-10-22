import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, shouldBlock } from "../eval/manifest.ts";
import { wilson, percentile, summarize, byTag } from "../eval/metrics.ts";
import { collect, score } from "../eval/runner.ts";
import { renderReport } from "../eval/report.ts";
import type { PersonAnalyzer, PersonDetection, RawImage } from "../src/index.ts";

// محلّل وهمي: الحكم يُقرأ من اسم الملف (للاختبار فقط، وليس نموذجًا)
const box = { x: 0, y: 0, width: 1, height: 1 };
const det = (pFemale: number): PersonDetection => ({ box, confidence: 0.9, pFemale, genderConfidence: 0.95 });
const fakeAnalyzer: PersonAnalyzer = {
  async analyze(img) {
    const name = (img as unknown as { name: string }).name;
    if (name.includes("boom")) throw new Error("boom");
    if (name.includes("miss")) return [det(0.01)];   // أنثى لكن المحلّل أخطأ وقال ذكر
    if (name.includes("female")) return [det(0.97)];
    if (name.includes("male")) return [det(0.02)];
    return [];
  },
};
const loadImage = async (p: string) => ({ name: p, data: new Uint8ClampedArray(4), width: 1, height: 1 }) as unknown as RawImage;

const manifest = validateManifest({
  name: "test",
  entries: [
    { path: "f1.female", gender: "female", tags: ["face"] },
    { path: "f2.miss", gender: "female", tags: ["small"] },
    { path: "m1.male", gender: "male", tags: ["face"] },
    { path: "n1.none", gender: "none" },
    { path: "x.boom", gender: "male", tags: ["face"] },
  ],
});

test("validateManifest: أخطاء واضحة", () => {
  assert.throws(() => validateManifest({ name: "x", entries: [] }));
  assert.throws(() => validateManifest({ name: "x", entries: [{ path: "a", gender: "other" }] }));
  assert.throws(() => validateManifest({ name: "x", entries: [{ path: "a", gender: "none" }, { path: "a", gender: "none" }] }), /مكرر/);
  assert.throws(() => validateManifest({ entries: [{ path: "a", gender: "none" }] }));
});

test("shouldBlock: الحقيقة الأرضية", () => {
  assert.equal(shouldBlock({ path: "a", gender: "mixed" }, "female"), true);
  assert.equal(shouldBlock({ path: "a", gender: "female" }, "female"), true);
  assert.equal(shouldBlock({ path: "a", gender: "male" }, "female"), false);
  assert.equal(shouldBlock({ path: "a", gender: "none" }, "male"), false);
});

test("wilson: قيم معروفة", () => {
  const w = wilson(0, 100);
  assert.equal(w.low, 0);
  assert.ok(w.high > 0.03 && w.high < 0.04);       // ≈ 3.7%
  const h = wilson(50, 100);
  assert.ok(h.low > 0.40 && h.high < 0.60);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
});

test("percentile", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
  assert.equal(percentile([], 0.5), 0);
});

test("collect + score: تسرّب وحجب زائد وأخطاء (صارم)", async () => {
  const samples = await collect(manifest.entries, { analyzer: fakeAnalyzer, loadImage, resolvePath: (p) => p });
  assert.equal(samples.length, 5);
  assert.equal(samples[4]!.error, "boom");

  const out = score(samples, "female");
  const s = summarize(out);
  assert.equal(s.positives, 2);          // f1, f2
  assert.equal(s.leaked, 1);             // f2 مرّت لأن المحلّل أخطأ
  assert.equal(s.negatives, 3);          // m1, n1, x.boom
  assert.equal(s.overblocked, 1);        // x.boom حُجبت بسبب الخطأ (صارم)
  assert.equal(out[4]!.reason, "analysis-error");
});

test("score غير صارم: الخطأ لا يحجب", async () => {
  const samples = await collect(manifest.entries, { analyzer: fakeAnalyzer, loadImage, resolvePath: (p) => p });
  const s = summarize(score(samples, "female", { strict: false }));
  assert.equal(s.overblocked, 0);
});

test("خفض العتبة لا يزيد التسرّب أبدًا", async () => {
  const samples = await collect(manifest.entries, { analyzer: fakeAnalyzer, loadImage, resolvePath: (p) => p });
  const hi = summarize(score(samples, "female", { blockThreshold: 0.9 })).leaked;
  const lo = summarize(score(samples, "female", { blockThreshold: 0.01 })).leaked;
  assert.ok(lo <= hi);
});

test("byTag", async () => {
  const samples = await collect(manifest.entries, { analyzer: fakeAnalyzer, loadImage, resolvePath: (p) => p });
  const t = byTag(score(samples, "female"));
  assert.equal(t["small"]!.leaked, 1);
  assert.equal(t["face"]!.leaked, 0);
});

test("التقرير: يحوي تحذير العيّنة الصغيرة والأرقام الفعلية", async () => {
  const samples = await collect(manifest.entries, { analyzer: fakeAnalyzer, loadImage, resolvePath: (p) => p });
  const md = renderReport({
    datasetName: "test", target: "female", samples,
    policy: { strict: true, blockThreshold: 0.2 }, thresholds: [0.1, 0.5], analyzerName: "fake",
  });
  assert.match(md, /العيّنة صغيرة/);
  assert.match(md, /تقرير القياس: test/);
  assert.match(md, /strict=false, threshold=0.5/);
  assert.match(md, /فشل تحليلها أو تحميلها: 1/);
  assert.match(md, /أول خطأ: boom/);
});

test('shouldBlock مع target="any": كل صورة فيها أشخاص تُحجب', () => {
  assert.equal(shouldBlock({ path: "a", gender: "male" }, "any"), true);
  assert.equal(shouldBlock({ path: "a", gender: "mixed" }, "any"), true);
  assert.equal(shouldBlock({ path: "a", gender: "none" }, "any"), false);
});
