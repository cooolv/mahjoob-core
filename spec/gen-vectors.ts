// يولّد متجهات اختبار مشتركة (تُقرأ من TypeScript وJava) انطلاقًا من نسخة TypeScript، وهي المرجع.
// التشغيل (من جذر المستودع): node --experimental-strip-types spec/gen-vectors.ts
import { writeFileSync } from "node:fs";
import { decide, DEFAULT_POLICY, decodeYuNet, resizeRegion, letterbox, toCHW } from "../packages/core-js/src/index.ts";
import type { PersonDetection, Policy, TargetGender, RawImage } from "../packages/core-js/src/index.ts";

const OUT = new URL("./vectors/", import.meta.url).pathname;

// مولّد عشوائي حتمي
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
const num = (x: number | undefined) => (x === undefined ? "-" : String(x));

/* ================= policy ================= */
{
  const r = rng(7);
  const confs = [0, 0.1, 0.34, 0.35, 0.36, 0.5, 0.9, 1];
  const pfs = [undefined, -0.5, 0, 0.01, 0.19, 0.2, 0.21, 0.5, 0.79, 0.8, 0.99, 1, 1.5];
  const gcs = [undefined, 0, 0.5, 0.59, 0.6, 0.61, 0.9, 1];
  const lines: string[] = ["# target\tstrict\tthreshold\tminPerson\tminGender\tdetections(x,y,w,h,conf,pFemale,gconf;...)\texpAction\texpReason\texpRegions"];
  for (let i = 0; i < 1200; i++) {
    const n = Math.floor(r() * 4);
    const dets: PersonDetection[] = [];
    for (let k = 0; k < n; k++) {
      dets.push({
        box: { x: k * 10 + 1, y: k * 5 + 2, width: 8 + k, height: 9 + k },
        confidence: pick(r, confs), pFemale: pick(r, pfs), genderConfidence: pick(r, gcs),
      });
    }
    const target = pick<TargetGender>(r, ["female", "male", "any"]);
    const strict = r() < 0.7;
    const thr = pick(r, [0.2, 0.5, 0.05]);
    const minPerson = pick(r, [0.35, 0.6]);
    const policy: Policy = { ...DEFAULT_POLICY, target, strict, blockThreshold: thr, minPersonConfidence: minPerson };
    const d = decide(dets, policy);
    const detStr = dets.length === 0 ? "-" : dets.map((x) =>
      [x.box.x, x.box.y, x.box.width, x.box.height, x.confidence, num(x.pFemale), num(x.genderConfidence)].join(",")).join(";");
    const regStr = d.regions.length === 0 ? "-" : d.regions.map((b) => [b.x, b.y, b.width, b.height].join(",")).join(";");
    lines.push([target, strict, thr, minPerson, policy.minGenderConfidence, detStr, d.action, d.reason, regStr].join("\t"));
  }
  writeFileSync(OUT + "policy.tsv", lines.join("\n") + "\n");
}

/* ================= image ops ================= */
const hex = (a: ArrayLike<number>) => Buffer.from(Uint8Array.from(a as ArrayLike<number>)).toString("hex");
function randImage(r: () => number, w: number, h: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}
{
  const r = rng(11);
  const lines: string[] = ["# RESIZE w h hexRGBA rx ry rw rh dw dh hexOut | LETTERBOX w h hexRGBA tw th allowUpscale scale padX padY hexOut | CHW w h hexRGBA scale mean std bgr floats"];
  const sizes: Array<[number, number]> = [[5, 4], [9, 7], [3, 3], [16, 11]];
  for (const [w, h] of sizes) {
    const img = randImage(r, w, h);
    const regions: number[][] = [
      [0, 0, w, h, 4, 4], [-2.5, -1.5, w + 3, h + 2, 6, 5], [1.25, 0.75, w / 2, h / 2, 8, 8],
      [0.3, 0.2, w - 0.6, h - 0.4, 3, 2], [2, 1, 2.5, 2.5, 7, 9],
    ];
    for (const [rx, ry, rw, rh, dw, dh] of regions) {
      const out = resizeRegion(img, rx!, ry!, rw!, rh!, dw!, dh!);
      lines.push(["RESIZE", w, h, hex(img.data), rx, ry, rw, rh, dw, dh, hex(out.data)].join("\t"));
    }
    for (const [tw, th, up] of [[10, 10, true], [10, 10, false], [32, 20, true], [4, 4, false], [20, 12, false]] as Array<[number, number, boolean]>) {
      const lb = letterbox(img, tw, th, 114, up);
      lines.push(["LETTERBOX", w, h, hex(img.data), tw, th, up, lb.scale, lb.padX, lb.padY, hex(lb.image.data)].join("\t"));
    }
    const norms: Array<{ scale?: number; mean?: number[]; std?: number[]; bgr?: boolean }> = [
      {}, { scale: 1, bgr: true }, { scale: 1, mean: [122.781998, 117.000999, 104.297997], std: [256, 256, 256] },
      { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
    ];
    for (const n of norms) {
      const f = toCHW(img, n as never);
      lines.push(["CHW", w, h, hex(img.data), num(n.scale), n.mean ? n.mean.join(",") : "-", n.std ? n.std.join(",") : "-", !!n.bgr,
        Array.from(f).map((v) => String(v)).join(",")].join("\t"));
    }
  }
  writeFileSync(OUT + "image.tsv", lines.join("\n") + "\n");
}

/* ================= YuNet ================= */
{
  const r = rng(23);
  const lines: string[] = ["# YUNET width height scoreThr iouThr outputs(name=v,v,...|name=...) expected(x,y,w,h,score;...)"];
  for (const [w, h] of [[64, 64], [96, 64], [128, 96]] as Array<[number, number]>) {
    for (let trial = 0; trial < 6; trial++) {
      const outs: Record<string, { data: Float32Array; dims: number[] }> = {};
      for (const s of [8, 16, 32]) {
        const n = Math.floor(w / s) * Math.floor(h / s);
        const cls = new Float32Array(n), obj = new Float32Array(n), bbox = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const hot = r() < 0.12;
          cls[i] = Math.fround(hot ? 0.5 + r() * 0.6 : r() * 0.4 - 0.1);
          obj[i] = Math.fround(hot ? 0.5 + r() * 0.6 : r() * 0.4);
          bbox[i * 4] = Math.fround(r() * 1.2 - 0.1); bbox[i * 4 + 1] = Math.fround(r() * 1.2 - 0.1);
          bbox[i * 4 + 2] = Math.fround(r() * 1.6 - 0.8); bbox[i * 4 + 3] = Math.fround(r() * 1.6 - 0.8);
        }
        outs[`cls_${s}`] = { data: cls, dims: [1, n, 1] };
        outs[`obj_${s}`] = { data: obj, dims: [1, n, 1] };
        outs[`bbox_${s}`] = { data: bbox, dims: [1, n, 4] };
      }
      const thr = pick(r, [0.6, 0.3]);
      const iouThr = pick(r, [0.3, 0.5]);
      const cands = decodeYuNet(outs, w, h, { scoreThreshold: thr, iouThreshold: iouThr });
      const outStr = Object.entries(outs).map(([k, v]) => `${k}=${Array.from(v.data).map(String).join(",")}`).join("|");
      const expStr = cands.length === 0 ? "-" : cands.map((c) => [c.box.x, c.box.y, c.box.width, c.box.height, c.score].join(",")).join(";");
      lines.push(["YUNET", w, h, thr, iouThr, outStr, expStr].join("\t"));
    }
  }
  writeFileSync(OUT + "yunet.tsv", lines.join("\n") + "\n");
}
console.log("vectors written to", OUT);
