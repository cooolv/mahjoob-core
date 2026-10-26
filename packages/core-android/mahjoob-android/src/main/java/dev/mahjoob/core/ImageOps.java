package dev.mahjoob.core;

import java.util.Arrays;

/** معالجة الصور: اقتطاع/تغيير حجم، Letterbox، والتحويل إلى NCHW. تطابق نسخة TypeScript بايتًا ببايت. */
public final class ImageOps {
    private ImageOps() {}

    /** نتيجة Letterbox. */
    public static final class Letterboxed {
        public final RawImage image;
        public final double scale;
        public final int padX;
        public final int padY;

        Letterboxed(RawImage image, double scale, int padX, int padY) {
            this.image = image;
            this.scale = scale;
            this.padX = padX;
            this.padY = padY;
        }
    }

    /** مثل Math.round في جافاسكربت (للقيم الموجبة). */
    static int jsRound(double x) {
        return (int) Math.floor(x + 0.5);
    }

    /** مثل Uint8ClampedArray: NaN=0، تثبيت 0..255، تقريب إلى الأقرب مع الزوجي عند التعادل. */
    private static byte clampToByte(double v) {
        if (!(v > 0)) return 0;
        if (v >= 255) return (byte) 255;
        return (byte) (int) Math.rint(v);
    }

    /** اقتطاع منطقة وتغيير حجمها بالاستيفاء الخطي. الإحداثيات خارج الصورة تُثبَّت على الحافة. */
    public static RawImage resizeRegion(RawImage src, double rx, double ry, double rw, double rh, int dw, int dh) {
        byte[] out = new byte[dw * dh * 4];
        double xr = rw / dw;
        double yr = rh / dh;
        int maxX = src.width - 1;
        int maxY = src.height - 1;
        byte[] sd = src.data;
        for (int y = 0; y < dh; y++) {
            double sy = ry + (y + 0.5) * yr - 0.5;
            double y0f = Math.floor(sy);
            double fy = sy - y0f;
            int y0 = (int) Math.min(maxY, Math.max(0, y0f));
            int y1 = (int) Math.min(maxY, Math.max(0, y0f + 1));
            for (int x = 0; x < dw; x++) {
                double sx = rx + (x + 0.5) * xr - 0.5;
                double x0f = Math.floor(sx);
                double fx = sx - x0f;
                int x0 = (int) Math.min(maxX, Math.max(0, x0f));
                int x1 = (int) Math.min(maxX, Math.max(0, x0f + 1));
                int o = (y * dw + x) * 4;
                for (int c = 0; c < 4; c++) {
                    int p00 = sd[(y0 * src.width + x0) * 4 + c] & 0xFF;
                    int p10 = sd[(y0 * src.width + x1) * 4 + c] & 0xFF;
                    int p01 = sd[(y1 * src.width + x0) * 4 + c] & 0xFF;
                    int p11 = sd[(y1 * src.width + x1) * 4 + c] & 0xFF;
                    double top = p00 + (p10 - p00) * fx;
                    double bot = p01 + (p11 - p01) * fx;
                    out[o + c] = clampToByte(top + (bot - top) * fy);
                }
            }
        }
        return new RawImage(out, dw, dh);
    }

    public static Letterboxed letterbox(RawImage src, int tw, int th, int padValue, boolean allowUpscale) {
        double scale = Math.min((double) tw / src.width, (double) th / src.height);
        if (!allowUpscale) scale = Math.min(1.0, scale);
        int nw = Math.max(1, jsRound(src.width * scale));
        int nh = Math.max(1, jsRound(src.height * scale));
        int padX = (tw - nw) / 2;
        int padY = (th - nh) / 2;
        RawImage resized = resizeRegion(src, 0, 0, src.width, src.height, nw, nh);
        byte[] out = new byte[tw * th * 4];
        byte pv = (byte) padValue;
        for (int i = 0; i < out.length; i += 4) {
            out[i] = pv;
            out[i + 1] = pv;
            out[i + 2] = pv;
            out[i + 3] = (byte) 255;
        }
        for (int y = 0; y < nh; y++) {
            System.arraycopy(resized.data, y * nw * 4, out, ((y + padY) * tw + padX) * 4, nw * 4);
        }
        return new Letterboxed(new RawImage(out, tw, th), scale, padX, padY);
    }

    /** RGBA => float بصيغة [3, H, W] (بلا بُعد الدفعة). */
    public static float[] toChw(RawImage img, Normalize n) {
        int plane = img.width * img.height;
        float[] out = new float[3 * plane];
        int[] order = n.bgr ? new int[]{2, 1, 0} : new int[]{0, 1, 2};
        for (int i = 0; i < plane; i++) {
            for (int c = 0; c < 3; c++) {
                double v = (img.data[i * 4 + order[c]] & 0xFF) * n.scale;
                out[c * plane + i] = (float) ((v - n.mean[c]) / n.std[c]);
            }
        }
        return out;
    }

    static byte[] copy(byte[] a) {
        return Arrays.copyOf(a, a.length);
    }
}
