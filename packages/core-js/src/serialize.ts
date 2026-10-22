import type { ImageInput, PersonAnalyzer, PersonDetection } from "./types.ts";

/**
 * يُجبر استدعاءات المحلّل على العمل واحدًا بعد الآخر.
 * ضروري مع onnxruntime-web: تشغيل جلسة واحدة بالتوازي قد يفشل ("Session already started").
 * فشل استدعاء لا يوقف الطابور، والاستدعاء الملغى قبل بدايته يُرفض دون تشغيل النموذج.
 */
export function serialized(inner: PersonAnalyzer): PersonAnalyzer {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    analyze(image: ImageInput, signal?: AbortSignal): Promise<PersonDetection[]> {
      const run = async (): Promise<PersonDetection[]> => {
        if (signal?.aborted) throw new Error("أُلغي التحليل قبل أن يبدأ");
        return inner.analyze(image, signal);
      };
      const p = tail.then(run, run);
      tail = p.catch(() => undefined);
      return p;
    },
  };
}
