package dev.mahjoob.core;

/** تطبيع المدخل: (البكسل × scale − mean) ÷ std لكل قناة، مع اختيار ترتيب BGR. */
public final class Normalize {
    /** معامل الضرب الافتراضي 1/255. استخدم 1 للنماذج التي تتوقع 0..255. */
    public final double scale;
    public final double[] mean;
    public final double[] std;
    public final boolean bgr;

    private Normalize(Builder b) {
        this.scale = b.scale;
        this.mean = b.mean.clone();
        this.std = b.std.clone();
        this.bgr = b.bgr;
    }

    public static Normalize defaults() {
        return new Builder().build();
    }

    public static final class Builder {
        private double scale = 1.0 / 255;
        private double[] mean = {0, 0, 0};
        private double[] std = {1, 1, 1};
        private boolean bgr = false;

        public Builder scale(double v) { this.scale = v; return this; }

        public Builder mean(double r, double g, double b) {
            this.mean = new double[]{r, g, b};
            return this;
        }

        public Builder std(double r, double g, double b) {
            this.std = new double[]{r, g, b};
            return this;
        }

        public Builder bgr(boolean v) { this.bgr = v; return this; }

        public Normalize build() {
            return new Normalize(this);
        }
    }
}
