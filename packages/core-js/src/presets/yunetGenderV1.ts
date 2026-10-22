import { OnnxAnalyzer } from "../adapters/onnx.ts";
import type { OrtLike, OrtSessionLike } from "../adapters/onnx.ts";
import type { ImageInput } from "../types.ts";
import type { RawImage } from "../adapters/image.ts";

/**
 * إعداد جاهز: كاشف الوجوه YuNet (MIT) + مصنّف الجنس gender-v1 (CC0، من dlib-models عبر حزمة age-and-gender).
 *
 * الأرقام أدناه مأخوذة من ملف manifest الخاص بالنموذج ومن قياسنا:
 *  - gender-v1: مدخل RGB بحجم 32×32، الصيغة (البكسل − المتوسط) ÷ 256، والفئة 0 = أنثى.
 *  - YuNet 2023mar: مدخل BGR بقيم 0..255 مثبّت على 640×640.
 *  - الهامش −0.1 هو أفضل قيمة في قياسنا على 200 صورة FairFace (انظر README).
 *
 * تحذير: النموذج مدرّب على وجوه مُحاذاة بنقاط dlib، ونحن نقتطع من صندوق YuNet دون محاذاة،
 * فالدقة أقل من المعلنة (الأرقام المقاسة في README).
 */
export const GENDER_V1_MEANS: [number, number, number] = [122.781998, 117.000999, 104.297997];

/** أفضل هامش اقتطاع في قياسنا (سالب = أضيق من صندوق الوجه) */
export const GENDER_V1_DEFAULT_CROP_MARGIN = -0.1;

export interface YuNetGenderV1Options {
  /** وحدة onnxruntime-web أو onnxruntime-node */
  ort: OrtLike;
  yunetSession: OrtSessionLike;
  genderSession: OrtSessionLike;
  /** حجم مدخل YuNet (افتراضي 640) */
  detectorInputSize?: number;
  /** أقل درجة لقبول وجه من YuNet (افتراضي 0.6) */
  faceScoreThreshold?: number;
  /** هامش الاقتطاع حول صندوق الوجه (افتراضي −0.1) */
  cropMargin?: number;
  maxPeople?: number;
  toRaw?: (input: ImageInput) => Promise<RawImage> | RawImage;
}

export function createYuNetGenderV1Analyzer(o: YuNetGenderV1Options): OnnxAnalyzer {
  return new OnnxAnalyzer({
    ort: o.ort,
    maxPeople: o.maxPeople,
    toRaw: o.toRaw,
    detector: {
      session: o.yunetSession,
      inputSize: o.detectorInputSize ?? 640,
      normalize: { scale: 1, bgr: true },
      allowUpscale: false,
      decode: { layout: "yunet", scoreThreshold: o.faceScoreThreshold ?? 0.6 },
    },
    classifier: {
      session: o.genderSession,
      inputSize: [32, 32],
      outputName: "probabilities",
      normalize: { scale: 1, mean: GENDER_V1_MEANS, std: [256, 256, 256] },
      output: { type: "softmax", femaleIndex: 0 },
      cropMargin: o.cropMargin ?? GENDER_V1_DEFAULT_CROP_MARGIN,
      squareCrop: true,
    },
  });
}
