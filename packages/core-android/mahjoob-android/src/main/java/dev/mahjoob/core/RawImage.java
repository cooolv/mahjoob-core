package dev.mahjoob.core;

/** صورة خام بصيغة RGBA (4 بايت لكل بكسل، بلا حشو بين الأسطر). */
public final class RawImage {
    public final byte[] data;
    public final int width;
    public final int height;

    public RawImage(byte[] data, int width, int height) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("أبعاد غير صالحة");
        if (data == null || data.length < (long) width * height * 4) {
            throw new IllegalArgumentException("حجم البيانات لا يطابق الأبعاد");
        }
        this.data = data;
        this.width = width;
        this.height = height;
    }

    /** من مصفوفة ARGB (كما يعيدها Bitmap.getPixels). الألفا تُحفظ كما هي. */
    public static RawImage fromArgb(int[] argb, int width, int height) {
        byte[] out = new byte[width * height * 4];
        for (int i = 0; i < width * height; i++) {
            int p = argb[i];
            out[i * 4] = (byte) ((p >> 16) & 0xFF);
            out[i * 4 + 1] = (byte) ((p >> 8) & 0xFF);
            out[i * 4 + 2] = (byte) (p & 0xFF);
            out[i * 4 + 3] = (byte) ((p >>> 24) & 0xFF);
        }
        return new RawImage(out, width, height);
    }
}
