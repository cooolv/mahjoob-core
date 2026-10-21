import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OnnxAnalyzer, ImageGuard, decodeDetections, nms, unletterbox,
  letterbox, toCHW, resizeRegion, femaleProbability,
} from "../src/index.ts";
import type { OrtLike, OrtSessionLike, RawImage } from "../src/index.ts";

// ملاحظة: كل ما يلي جلسات ONNX وهمية للتحقق من منطق المحوّل فقط، وليس نماذج حقيقية.
const solid = (w: number, h: number, rgb: [number, number, number]): RawImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data.set([...rgb, 255], i * 4); }
  return { data, width: w, height: h };
};

const ort: OrtLike = {
  Tensor: class {
    type: string; data: Float32Array; dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) { this.type = type; this.data = data; this.dims = dims; }
  } as any,
};

const session = (out: { data: number[]; dims: number[] } | (() => never), calls?: { n: number }): OrtSessionLike => ({
  inputNames: ["in"], outputNames: ["out"],
  async run() {
    if (calls) calls.n++;
    if (typeof out === "function") out();
    const o = out as { data: number[]; dims: number[] };
    return { out: { data: Float32Array.from(o.data), dims: o.dims } };
  },
});

/** مخرجات كاشف بنمط channels-first: C=1، N كشفًا. كل كشف [cx,cy,w,h,score] */
const detOut = (items: number[][]) => {
  const n = items.length;
  const data: number[] = [];
  for (let k = 0; k < 5; k++) for (const it of items) data.push(it[k]!);
  return { data, dims: [1, 5, n] };
};

test("letterbox: النسبة والحشو", () => {
  const r = letterbox(solid(200, 100, [255, 0, 0]), 100, 100);
  assert.equal(r.scale, 0.5);
  assert.equal(r.padX, 0);
  assert.equal(r.padY, 25);
  assert.equal(r.image.data[0], 114);                      // حشو
  assert.equal(r.image.data[(30 * 100 + 10) * 4], 255);    // داخل الصورة (أحمر)
});

test("toCHW: ترتيب القنوات والتطبيع", () => {
  const img = solid(2, 2, [255, 0, 51]);
  const rgb = toCHW(img);
  assert.equal(rgb[0], 1); assert.equal(rgb[4], 0); assert.ok(Math.abs(rgb[8]! - 0.2) < 1e-6);
  const bgr = toCHW(img, { bgr: true });
  assert.ok(Math.abs(bgr[0]! - 0.2) < 1e-6); assert.equal(bgr[8], 1);
  const norm = toCHW(img, { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] });
  assert.equal(norm[0], 1); assert.equal(norm[4], -1);
});

test("resizeRegion: لون موحّد يبقى موحّدًا حتى خارج الحدود", () => {
  const r = resizeRegion(solid(10, 10, [10, 20, 30]), -5, -5, 30, 30, 4, 4);
  assert.deepEqual(Array.from(r.data.slice(0, 4)), [10, 20, 30, 255]);
});

test("decode channels-first + NMS", () => {
  const { data, dims } = detOut([[50, 50, 20, 20, 0.9], [51, 50, 20, 20, 0.8], [10, 10, 5, 5, 0.1]]);
  const r = decodeDetections(data, dims, { layout: "channels-first", classIndex: 0 });
  assert.equal(r.length, 1);                     // الثاني مكرّر، والثالث أقل من العتبة
  assert.equal(r[0]!.score, 0.9);
  assert.deepEqual(r[0]!.box, { x: 40, y: 40, width: 20, height: 20 });
});

test("decode rows-with-objectness: الدرجة = objectness × class", () => {
  // N=1, D=6: cx,cy,w,h,obj,cls0
  const r = decodeDetections([50, 50, 10, 10, 0.5, 0.8], [1, 1, 6], { layout: "rows-with-objectness", classIndex: 0, scoreThreshold: 0.3 });
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0]!.score - 0.4) < 1e-9);
});

test("decode: classIndex خارج النطاق يرمي خطأ", () => {
  assert.throws(() => decodeDetections([0, 0, 0, 0, 0], [1, 5, 1], { layout: "channels-first", classIndex: 3 }));
});

test("nms يبقي الصناديق المنفصلة", () => {
  const r = nms([
    { box: { x: 0, y: 0, width: 10, height: 10 }, score: 0.9 },
    { box: { x: 50, y: 50, width: 10, height: 10 }, score: 0.8 },
  ], 0.45);
  assert.equal(r.length, 2);
});

test("unletterbox يعيد الإحداثيات الأصلية", () => {
  const b = unletterbox({ x: 40, y: 40, width: 20, height: 20 }, { scale: 0.5, padX: 0, padY: 25 }, { width: 200, height: 100 });
  assert.deepEqual(b, { x: 80, y: 30, width: 40, height: 40 });
});

test("femaleProbability: الأنماط الثلاثة", () => {
  assert.equal(femaleProbability([0.9], { type: "single-prob", positive: "female" }), 0.9);
  assert.ok(Math.abs(femaleProbability([0.9], { type: "single-prob", positive: "male" }) - 0.1) < 1e-9);
  assert.ok(Math.abs(femaleProbability([0], { type: "single-logit", positive: "female" }) - 0.5) < 1e-9);
  const sm = femaleProbability([0, 2], { type: "softmax", femaleIndex: 1 });
  assert.ok(sm > 0.88 && sm < 0.89);
  assert.equal(femaleProbability([0.3, 0.7], { type: "softmax", femaleIndex: 0 }), 0.3); // احتمالات جاهزة
  assert.throws(() => femaleProbability([], { type: "single-prob", positive: "female" }));
  assert.throws(() => femaleProbability([NaN], { type: "single-prob", positive: "female" }));
});

const make = (cls: OrtSessionLike, det?: OrtSessionLike, extra = {}) =>
  new OnnxAnalyzer({
    ort,
    detector: { session: det ?? session(detOut([[50, 50, 20, 20, 0.9]])), inputSize: 100, decode: { layout: "channels-first", classIndex: 0 } },
    classifier: { session: cls, inputSize: [8, 8], output: { type: "single-prob", positive: "female" } },
    ...extra,
  });

test("المحلّل: صندوق بإحداثيات الصورة الأصلية + جنس", async () => {
  const a = make(session({ data: [0.95], dims: [1, 1] }));
  const r = await a.analyze(solid(200, 100, [100, 100, 100]));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0]!.box, { x: 80, y: 30, width: 40, height: 40 });
  assert.ok(Math.abs(r[0]!.pFemale! - 0.95) < 1e-6);
  assert.ok(Math.abs(r[0]!.genderConfidence! - 0.95) < 1e-6);
});

test("المحلّل مع ImageGuard: أنثى => حجب، ذكر => سماح", async () => {
  const img = solid(200, 100, [100, 100, 100]);
  const f = new ImageGuard({ target: "female", analyzer: make(session({ data: [0.95], dims: [1, 1] })) });
  const m = new ImageGuard({ target: "female", analyzer: make(session({ data: [0.03], dims: [1, 1] })) });
  assert.equal((await f.check(img)).action, "block");
  assert.equal((await m.check(img)).action, "allow");
});

test("فشل المصنّف => غير محسوم => حجب (صارم)", async () => {
  const bad = session(() => { throw new Error("boom"); });
  const g = new ImageGuard({ target: "female", analyzer: make(bad) });
  const d = await g.check(solid(200, 100, [1, 2, 3]));
  assert.deepEqual([d.action, d.reason], ["block", "uncertain-gender"]);
});

test("فشل الكاشف => حجب بسبب خطأ التحليل", async () => {
  const bad = session(() => { throw new Error("boom"); });
  const g = new ImageGuard({ target: "female", analyzer: make(session({ data: [0.1], dims: [1, 1] }), bad) });
  const d = await g.check(solid(200, 100, [1, 2, 3]));
  assert.deepEqual([d.action, d.reason], ["block", "analysis-error"]);
});

test("لا أشخاص => سماح", async () => {
  const g = new ImageGuard({ target: "female", analyzer: make(session({ data: [0.5], dims: [1, 1] }), session(detOut([[50, 50, 20, 20, 0.05]]))) });
  const d = await g.check(solid(200, 100, [1, 2, 3]));
  assert.deepEqual([d.action, d.reason], ["allow", "no-person"]);
});

test("maxPeople: الزائدون يُتركون غير محسومين => حجب", async () => {
  const calls = { n: 0 };
  const det = session(detOut([[20, 20, 10, 10, 0.9], [50, 50, 30, 30, 0.9], [80, 80, 12, 12, 0.9]]));
  const a = make(session({ data: [0.01], dims: [1, 1] }, calls), det, { maxPeople: 2 });
  const r = await a.analyze(solid(100, 100, [9, 9, 9]));
  assert.equal(r.length, 3);
  assert.equal(calls.n, 2);
  assert.equal(r.filter((x) => x.pFemale === undefined).length, 1);
  const g = new ImageGuard({ target: "female", analyzer: a });
  assert.equal((await g.check(solid(100, 100, [9, 9, 9]))).action, "block");
});

test("مدخل غير مدعوم خارج المتصفح => خطأ => حجب", async () => {
  const g = new ImageGuard({ target: "female", analyzer: make(session({ data: [0.1], dims: [1, 1] })) });
  const d = await g.check({ not: "an image" });
  assert.deepEqual([d.action, d.reason], ["block", "analysis-error"]);
});
