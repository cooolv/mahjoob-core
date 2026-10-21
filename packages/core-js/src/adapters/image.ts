/** صورة خام بصيغة RGBA (نفس بنية ImageData) */
export interface RawImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Normalize {
  /** المتوسط لكل قناة بعد القسمة على 255 (افتراضي 0) */
  mean?: [number, number, number];
  /** الانحراف المعياري لكل قناة (افتراضي 1) */
  std?: [number, number, number];
  /** ترتيب القنوات BGR بدل RGB (افتراضي false) */
  bgr?: boolean;
}

export interface LetterboxInfo {
  scale: number;
  padX: number;
  padY: number;
}

export function isRawImage(x: unknown): x is RawImage {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.data === "object" &&
    o.data !== null &&
    "length" in o.data &&
    (o.data as { length: number }).length >= (o.width as number) * (o.height as number) * 4
  );
}

/** اقتطاع منطقة وتغيير حجمها بالاستيفاء الخطي. الإحداثيات خارج الصورة تُثبَّت على الحافة. */
export function resizeRegion(
  src: RawImage, rx: number, ry: number, rw: number, rh: number, dw: number, dh: number,
): RawImage {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = rw / dw;
  const yr = rh / dh;
  const maxX = src.width - 1;
  const maxY = src.height - 1;
  for (let y = 0; y < dh; y++) {
    const sy = ry + (y + 0.5) * yr - 0.5;
    const y0f = Math.floor(sy);
    const fy = sy - y0f;
    const y0 = Math.min(maxY, Math.max(0, y0f));
    const y1 = Math.min(maxY, Math.max(0, y0f + 1));
    for (let x = 0; x < dw; x++) {
      const sx = rx + (x + 0.5) * xr - 0.5;
      const x0f = Math.floor(sx);
      const fx = sx - x0f;
      const x0 = Math.min(maxX, Math.max(0, x0f));
      const x1 = Math.min(maxX, Math.max(0, x0f + 1));
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c]!;
        const p10 = src.data[(y0 * src.width + x1) * 4 + c]!;
        const p01 = src.data[(y1 * src.width + x0) * 4 + c]!;
        const p11 = src.data[(y1 * src.width + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
    }
  }
  return { data: out, width: dw, height: dh };
}

/** تغيير الحجم مع الحفاظ على النسبة وحشو الباقي بلون رمادي (Letterbox) */
export function letterbox(
  src: RawImage, tw: number, th: number, padValue = 114,
): { image: RawImage } & LetterboxInfo {
  const scale = Math.min(tw / src.width, th / src.height);
  const nw = Math.max(1, Math.round(src.width * scale));
  const nh = Math.max(1, Math.round(src.height * scale));
  const padX = Math.floor((tw - nw) / 2);
  const padY = Math.floor((th - nh) / 2);
  const resized = resizeRegion(src, 0, 0, src.width, src.height, nw, nh);
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = padValue; out[i + 1] = padValue; out[i + 2] = padValue; out[i + 3] = 255;
  }
  for (let y = 0; y < nh; y++) {
    const from = y * nw * 4;
    out.set(resized.data.subarray(from, from + nw * 4), ((y + padY) * tw + padX) * 4);
  }
  return { image: { data: out, width: tw, height: th }, scale, padX, padY };
}

/** تحويل RGBA إلى Float32 بصيغة NCHW (بدون بُعد الدفعة): [3, H, W] */
export function toCHW(img: RawImage, n: Normalize = {}): Float32Array {
  const mean = n.mean ?? [0, 0, 0];
  const std = n.std ?? [1, 1, 1];
  const plane = img.width * img.height;
  const out = new Float32Array(3 * plane);
  const order = n.bgr ? [2, 1, 0] : [0, 1, 2];
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const v = img.data[i * 4 + order[c]!]! / 255;
      out[c * plane + i] = (v - mean[c]!) / std[c]!;
    }
  }
  return out;
}
