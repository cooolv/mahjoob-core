package dev.mahjoob.android;

import android.graphics.Bitmap;
import dev.mahjoob.core.RawImage;

/** يحوّل Bitmap إلى RawImage (RGBA) للنواة. */
public final class BitmapConverter {
    private BitmapConverter() {}

    /**
     * @param maxSide أكبر ضلع بعد التصغير (الصور الأكبر تُصغَّر، ولا تُكبَّر الأصغر).
     * لا يغيّر الـBitmap الأصلي ولا يعيد تدويره (recycle). صور HARDWARE تُنسخ إلى ARGB_8888 أولًا.
     * ملاحظة: لا يطبّق اتجاه EXIF؛ مرّر Bitmap مُدوَّرًا بالاتجاه الصحيح (ImageDecoder يفعل ذلك تلقائيًا).
     */
    public static RawImage toRawImage(Bitmap src, int maxSide) {
        if (src == null || src.isRecycled()) throw new IllegalArgumentException("Bitmap فارغ أو مُعاد تدويره");
        Bitmap work = src;
        boolean ownsWork = false;
        try {
            if (work.getConfig() != Bitmap.Config.ARGB_8888) {
                Bitmap copy = work.copy(Bitmap.Config.ARGB_8888, false);
                if (copy == null) throw new IllegalStateException("تعذّر نسخ الـBitmap إلى ARGB_8888");
                work = copy;
                ownsWork = true;
            }
            int w = work.getWidth();
            int h = work.getHeight();
            float k = Math.min(1f, (float) maxSide / Math.max(w, h));
            if (k < 1f) {
                int nw = Math.max(1, Math.round(w * k));
                int nh = Math.max(1, Math.round(h * k));
                Bitmap scaled = Bitmap.createScaledBitmap(work, nw, nh, true);
                if (ownsWork) work.recycle();
                work = scaled;
                ownsWork = true;
                w = nw;
                h = nh;
            }
            int[] px = new int[w * h];
            work.getPixels(px, 0, w, 0, 0, w, h);
            return RawImage.fromArgb(px, w, h);
        } finally {
            if (ownsWork && work != src) work.recycle();
        }
    }
}
