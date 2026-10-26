package dev.mahjoob.core;

/** تنسور float32 بسيط (بيانات مسطّحة + شكل). */
public final class FloatTensor {
    public final float[] data;
    public final long[] shape;

    public FloatTensor(float[] data, long[] shape) {
        this.data = data;
        this.shape = shape;
    }
}
