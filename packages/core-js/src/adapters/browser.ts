import { isRawImage } from "./image.ts";
import type { RawImage } from "./image.ts";

/**
 * يحوّل مصدرًا شائعًا في المتصفح إلى RawImage.
 * يدعم: ImageData/RawImage، Blob، ImageBitmap، <img>، <canvas>، <video>.
 * أي فشل (صورة لم تُحمَّل، Canvas ملوّث CORS...) يرمي خطأً => الحارس يحجب.
 * في الإضافات: الأفضل جلب بايتات الصورة من الـbackground وتمريرها كـBlob لتفادي CORS.
 */
export async function toRawImage(src: unknown, maxSide = 1280): Promise<RawImage> {
  if (isRawImage(src)) return src;
  const g = globalThis as any;
  if (typeof g.OffscreenCanvas === "undefined" && typeof g.document === "undefined") {
    throw new Error("لا توجد بيئة Canvas. مرّر RawImage مباشرة.");
  }

  let source: any = src;
  let closeAfter = false;
  if (typeof g.Blob !== "undefined" && src instanceof g.Blob) {
    source = await g.createImageBitmap(src);
    closeAfter = true;
  }

  const w: number = source.videoWidth || source.naturalWidth || source.width;
  const h: number = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) throw new Error("مصدر الصورة بلا أبعاد (لم يُحمَّل بعد؟)");

  const k = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas: any =
    typeof g.OffscreenCanvas !== "undefined"
      ? new g.OffscreenCanvas(cw, ch)
      : Object.assign(g.document.createElement("canvas"), { width: cw, height: ch });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("تعذّر إنشاء سياق Canvas");
  ctx.drawImage(source, 0, 0, cw, ch);
  const id = ctx.getImageData(0, 0, cw, ch); // يرمي SecurityError إن كان Canvas ملوّثًا
  if (closeAfter) source.close?.();
  return { data: id.data, width: id.width, height: id.height };
}
