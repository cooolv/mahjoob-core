import type { RawImage } from "../src/index.ts";

/** تحميل صورة من القرص بواسطة sharp (ثبّتها بـ: npm i -D sharp). تُصحَّح الدوران من EXIF. */
export async function loadWithSharp(path: string): Promise<RawImage> {
  const name = "sharp";
  let sharp: any;
  try {
    sharp = (await import(name)).default;
  } catch {
    throw new Error("حزمة sharp غير مثبّتة. نفّذ: npm i -D sharp");
  }
  const { data, info } = await sharp(path).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
