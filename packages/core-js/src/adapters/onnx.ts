import type { ImageInput, PersonAnalyzer, PersonDetection } from "../types.ts";
import { decodeDetections, decodeYuNet, unletterbox } from "./decode.ts";
import type { DecodeConfig, YuNetDecodeConfig } from "./decode.ts";
import { isRawImage, letterbox, resizeRegion, toCHW } from "./image.ts";
import type { Normalize, RawImage } from "./image.ts";
import { toRawImage } from "./browser.ts";

/* ===== واجهات الحد الأدنى من onnxruntime (تُمرَّر من الخارج، فلا اعتماد مباشر عليها) ===== */
export interface OrtTensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}
export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
}
export interface OrtLike {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensorLike;
}

export interface DetectorConfig {
  session: OrtSessionLike;
  /** حجم المدخل المربّع (مثلًا 640) أو [عرض, ارتفاع] */
  inputSize: number | [number, number];
  normalize?: Normalize;
  decode: DecodeConfig | YuNetDecodeConfig;
}

/** كيف نفسّر مخرجات مصنّف الجنس */
export type ClassifierOutput =
  | { type: "single-prob"; positive: "female" | "male" }   // قيمة واحدة احتمال (0..1)
  | { type: "single-logit"; positive: "female" | "male" }  // قيمة واحدة logit
  | { type: "softmax"; femaleIndex: number }               // عدة قيم (logits أو احتمالات)

export interface ClassifierConfig {
  session: OrtSessionLike;
  /** اسم المخرج المطلوب إن كان للنموذج أكثر من مخرج (افتراضي: الأول) */
  outputName?: string;
  inputSize: [number, number]; // [عرض, ارتفاع]
  normalize?: Normalize;
  output: ClassifierOutput;
  /** هامش حول الصندوق كنسبة من حجمه (افتراضي 0.2) */
  cropMargin?: number;
  /** جعل الاقتطاع مربّعًا (افتراضي true) */
  squareCrop?: boolean;
}

export interface OnnxAnalyzerOptions {
  /** وحدة onnxruntime-web أو onnxruntime-node (يكفي أن تحوي Tensor) */
  ort: OrtLike;
  detector: DetectorConfig;
  classifier: ClassifierConfig;
  /** أقصى عدد أشخاص يُصنَّفون (الأكبر مساحةً أولًا). الباقي يُترك غير محسوم => حجب في الصارم. افتراضي 10 */
  maxPeople?: number;
  /** محوّل المدخل إلى RawImage. الافتراضي: toRawImage للمتصفح */
  toRaw?: (input: ImageInput) => Promise<RawImage> | RawImage;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function softmax(v: number[]): number[] {
  const m = Math.max(...v);
  const e = v.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** احتمال الأنثى من مخرجات المصنّف */
export function femaleProbability(values: ArrayLike<number>, o: ClassifierOutput): number {
  const first = values[0];
  if (first === undefined || !Number.isFinite(first)) throw new Error("مخرجات المصنّف فارغة أو غير صالحة");
  let p: number;
  if (o.type === "single-prob") {
    p = o.positive === "female" ? first : 1 - first;
  } else if (o.type === "single-logit") {
    const s = sigmoid(first);
    p = o.positive === "female" ? s : 1 - s;
  } else {
    const arr = Array.from(values as ArrayLike<number>);
    if (o.femaleIndex < 0 || o.femaleIndex >= arr.length) throw new Error("femaleIndex خارج النطاق");
    const sum = arr.reduce((a, b) => a + b, 0);
    const isProb = arr.every((x) => x >= 0 && x <= 1) && Math.abs(sum - 1) < 1e-3;
    p = (isProb ? arr : softmax(arr))[o.femaleIndex]!;
  }
  if (!Number.isFinite(p)) throw new Error("احتمال غير صالح");
  return Math.min(1, Math.max(0, p));
}

/**
 * محلّل ONNX بمرحلتين: (1) كشف أشخاص/وجوه، (2) تصنيف الجنس لكل اقتطاع.
 * السلوك عند الفشل:
 *  - فشل الكشف => يرمي خطأً => ImageGuard يحجب.
 *  - فشل تصنيف شخص واحد => يُترك pFemale غير محدد => الوضع الصارم يحجب.
 */
export class OnnxAnalyzer implements PersonAnalyzer {
  private readonly o: OnnxAnalyzerOptions;

  constructor(options: OnnxAnalyzerOptions) {
    this.o = options;
  }

  async analyze(image: ImageInput, signal?: AbortSignal): Promise<PersonDetection[]> {
    const raw = isRawImage(image) ? image : await (this.o.toRaw ?? toRawImage)(image);
    this.check(signal);

    // 1) الكشف
    const dc = this.o.detector;
    const [tw, th] = typeof dc.inputSize === "number" ? [dc.inputSize, dc.inputSize] : dc.inputSize;
    const lb = letterbox(raw, tw, th);
    const input = new this.o.ort.Tensor("float32", toCHW(lb.image, dc.normalize), [1, 3, th, tw]);
    const outs = await dc.session.run({ [dc.session.inputNames[0]!]: input });
    this.check(signal);
    let cands;
    if (dc.decode.layout === "yunet") {
      cands = decodeYuNet(outs, tw, th, dc.decode);
    } else {
      const outTensor = outs[dc.session.outputNames[0]!];
      if (!outTensor) throw new Error("لا مخرجات من نموذج الكشف");
      cands = decodeDetections(outTensor.data, outTensor.dims, dc.decode);
    }

    const people = cands
      .map((c) => ({ box: unletterbox(c.box, lb, raw), score: c.score }))
      .filter((p) => p.box.width > 0 && p.box.height > 0)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);

    // 2) التصنيف
    const max = this.o.maxPeople ?? 10;
    const result: PersonDetection[] = [];
    for (let i = 0; i < people.length; i++) {
      const p = people[i]!;
      const det: PersonDetection = { box: p.box, confidence: p.score };
      if (i < max) {
        try {
          this.check(signal);
          const pf = await this.classify(raw, p.box);
          det.pFemale = pf;
          det.genderConfidence = Math.max(pf, 1 - pf);
        } catch (e) {
          if (signal?.aborted) throw e;
          // يبقى غير محسوم => حجب في الوضع الصارم
        }
      }
      result.push(det);
    }
    return result;
  }

  private async classify(raw: RawImage, box: { x: number; y: number; width: number; height: number }): Promise<number> {
    const c = this.o.classifier;
    const m = c.cropMargin ?? 0.2;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    let w = box.width * (1 + m);
    let h = box.height * (1 + m);
    if (c.squareCrop ?? true) w = h = Math.max(w, h);
    const crop = resizeRegion(raw, cx - w / 2, cy - h / 2, w, h, c.inputSize[0], c.inputSize[1]);
    const t = new this.o.ort.Tensor("float32", toCHW(crop, c.normalize), [1, 3, c.inputSize[1], c.inputSize[0]]);
    const outs = await c.session.run({ [c.session.inputNames[0]!]: t });
    const out = outs[c.outputName ?? c.session.outputNames[0]!];
    if (!out) throw new Error("لا مخرجات من المصنّف (تحقق من outputName)");
    return femaleProbability(out.data, c.output);
  }

  private check(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("أُلغي التحليل");
  }
}
