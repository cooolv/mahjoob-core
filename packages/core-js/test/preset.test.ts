import { test } from "node:test";
import assert from "node:assert/strict";
import { createYuNetGenderV1Analyzer, ImageGuard } from "../src/index.ts";
import type { OrtLike, OrtSessionLike, RawImage } from "../src/index.ts";

// جلسات وهمية للتحقق من توصيل الإعداد فقط، وليست نماذج حقيقية.
const ort: OrtLike = {
  Tensor: class {
    type: string; data: Float32Array; dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) { this.type = type; this.data = data; this.dims = dims; }
  } as any,
};

const solid = (w: number, h: number, rgb: [number, number, number]): RawImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { data, width: w, height: h };
};

/** مخرجات YuNet وهمية بحجم 640: وجه واحد عند stride 32، الخلية (10,10) بمركز (336,336) وحجم 32 */
function yunetOut() {
  const o: Record<string, { data: Float32Array; dims: number[] }> = {};
  for (const s of [8, 16, 32]) {
    const n = (640 / s) * (640 / s);
    o[`cls_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] };
    o[`obj_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] };
    o[`bbox_${s}`] = { data: new Float32Array(n * 4), dims: [1, n, 4] };
    o[`kps_${s}`] = { data: new Float32Array(n * 10), dims: [1, n, 10] };
  }
  const i = 10 * 20 + 10;
  o["cls_32"]!.data[i] = 1; o["obj_32"]!.data[i] = 1;
  o["bbox_32"]!.data.set([0.5, 0.5, 0, 0], i * 4); // w=h=exp(0)*32
  return o;
}

test("الإعداد الجاهز: توصيل YuNet وgender-v1 بالقيم الصحيحة", async () => {
  const feeds: { yunet?: any; gender?: any } = {};
  const yunet: OrtSessionLike = {
    inputNames: ["input"], outputNames: Object.keys(yunetOut()),
    async run(f) { feeds.yunet = f["input"]; return yunetOut(); },
  };
  const gender: OrtSessionLike = {
    inputNames: ["images"], outputNames: ["probabilities"],
    async run(f) {
      feeds.gender = f["images"];
      return { probabilities: { data: Float32Array.from([0.9, 0.1]), dims: [1, 2] } };
    },
  };
  const a = createYuNetGenderV1Analyzer({ ort, yunetSession: yunet, genderSession: gender });
  const r = await a.analyze(solid(100, 100, [123, 117, 104]));

  // YuNet: [1,3,640,640]، BGR بدون قسمة على 255، والحشو 114
  assert.deepEqual(feeds.yunet.dims, [1, 3, 640, 640]);
  assert.equal(feeds.yunet.data[0], 114);

  // صورة 100×100 لا تُكبَّر: موضوعة في المنتصف (حشو 270)، فالوجه عند (50,50) بحجم 32
  assert.equal(r.length, 1);
  const b = r[0]!.box;
  assert.ok(Math.abs(b.x - 50) < 1e-3 && Math.abs(b.y - 50) < 1e-3 && Math.abs(b.width - 32) < 1e-3);

  // المصنّف: [1,3,32,32] وقيم قريبة من الصفر لأن اللون = المتوسط تقريبًا
  assert.deepEqual(feeds.gender.dims, [1, 3, 32, 32]);
  assert.ok(Array.from(feeds.gender.data as Float32Array).every((v) => Math.abs(v) < 0.002));
  assert.ok(Math.abs(r[0]!.pFemale! - 0.9) < 1e-6);
});

test("الإعداد الجاهز مع ImageGuard: أنثى => حجب", async () => {
  const yunet: OrtSessionLike = { inputNames: ["input"], outputNames: Object.keys(yunetOut()), async run() { return yunetOut(); } };
  const mk = (pf: number): OrtSessionLike => ({
    inputNames: ["images"], outputNames: ["probabilities"],
    async run() { return { probabilities: { data: Float32Array.from([pf, 1 - pf]), dims: [1, 2] } }; },
  });
  const img = solid(100, 100, [10, 20, 30]);
  const f = new ImageGuard({ target: "female", analyzer: createYuNetGenderV1Analyzer({ ort, yunetSession: yunet, genderSession: mk(0.95) }) });
  const m = new ImageGuard({ target: "female", analyzer: createYuNetGenderV1Analyzer({ ort, yunetSession: yunet, genderSession: mk(0.02) }) });
  assert.equal((await f.check(img)).action, "block");
  assert.equal((await m.check(img)).action, "allow");
});
