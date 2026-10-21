import type { LetterboxInfo, RawImage } from "./image.ts";
import type { Box } from "../types.ts";

export interface DecodeConfig {
  /**
   * "channels-first": الشكل [1, 4+C, N] (نمط YOLOv8/YOLO11، بلا objectness)
   * "rows-with-objectness": الشكل [1, N, 5+C] (نمط YOLOX/YOLOv5)
   * في الحالتين الصناديق cx,cy,w,h بإحداثيات مدخل النموذج.
   */
  layout: "channels-first" | "rows-with-objectness";
  /** رقم الفئة المطلوبة (مثلًا person = 0 في COCO، أو 0 لنموذج وجوه) */
  classIndex: number;
  /** أقل درجة لقبول الكشف (افتراضي 0.25) */
  scoreThreshold?: number;
  /** عتبة IoU لإزالة التكرار (افتراضي 0.45) */
  iouThreshold?: number;
}

export interface Candidate {
  box: Box;
  score: number;
}

export function decodeDetections(
  data: ArrayLike<number>, dims: readonly number[], cfg: DecodeConfig,
): Candidate[] {
  const thr = cfg.scoreThreshold ?? 0.25;
  const out: Candidate[] = [];
  const d = dims.filter((_, i) => !(i === 0 && dims[0] === 1));
  if (d.length !== 2) throw new Error(`شكل مخرجات الكشف غير مدعوم: [${dims.join(",")}]`);
  const push = (cx: number, cy: number, w: number, h: number, score: number) => {
    if (score >= thr && w > 0 && h > 0) {
      out.push({ box: { x: cx - w / 2, y: cy - h / 2, width: w, height: h }, score });
    }
  };

  if (cfg.layout === "channels-first") {
    const [ch, n] = d as [number, number];
    if (cfg.classIndex < 0 || 4 + cfg.classIndex >= ch) throw new Error("classIndex خارج النطاق");
    for (let i = 0; i < n; i++) {
      push(data[i]!, data[n + i]!, data[2 * n + i]!, data[3 * n + i]!, data[(4 + cfg.classIndex) * n + i]!);
    }
  } else {
    const [n, dd] = d as [number, number];
    if (cfg.classIndex < 0 || 5 + cfg.classIndex >= dd) throw new Error("classIndex خارج النطاق");
    for (let i = 0; i < n; i++) {
      const o = i * dd;
      push(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!, data[o + 4]! * data[o + 5 + cfg.classIndex]!);
    }
  }
  return nms(out, cfg.iouThreshold ?? 0.45);
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

export function nms(c: Candidate[], iouThr: number): Candidate[] {
  const sorted = [...c].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const cand of sorted) {
    if (kept.every((k) => iou(k.box, cand.box) < iouThr)) kept.push(cand);
  }
  return kept;
}

/** إعادة الصندوق من إحداثيات المدخل (بعد Letterbox) إلى إحداثيات الصورة الأصلية */
export function unletterbox(b: Box, lb: LetterboxInfo, orig: Pick<RawImage, "width" | "height">): Box {
  const x1 = Math.min(orig.width, Math.max(0, (b.x - lb.padX) / lb.scale));
  const y1 = Math.min(orig.height, Math.max(0, (b.y - lb.padY) / lb.scale));
  const x2 = Math.min(orig.width, Math.max(0, (b.x + b.width - lb.padX) / lb.scale));
  const y2 = Math.min(orig.height, Math.max(0, (b.y + b.height - lb.padY) / lb.scale));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}
