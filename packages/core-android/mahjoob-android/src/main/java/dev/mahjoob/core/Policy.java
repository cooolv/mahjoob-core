package dev.mahjoob.core;

/** سياسة الحجب. القيم الافتراضية تطابق نسخة TypeScript. */
public final class Policy {
    public final TargetGender target;
    /** وضع صارم: أي غموض أو خطأ => حجب. */
    public final boolean strict;
    /** يُحجب إن كان احتمال الجنس المستهدف >= هذه القيمة. */
    public final double blockThreshold;
    public final double minPersonConfidence;
    public final double minGenderConfidence;
    /** مهلة التحليل بالمللي ثانية، وبعدها يُحجب. */
    public final long timeoutMs;

    private Policy(Builder b) {
        this.target = b.target;
        this.strict = b.strict;
        this.blockThreshold = b.blockThreshold;
        this.minPersonConfidence = b.minPersonConfidence;
        this.minGenderConfidence = b.minGenderConfidence;
        this.timeoutMs = b.timeoutMs;
    }

    public static Policy defaults(TargetGender target) {
        return new Builder(target).build();
    }

    public static final class Builder {
        private final TargetGender target;
        private boolean strict = true;
        private double blockThreshold = 0.2;
        private double minPersonConfidence = 0.35;
        private double minGenderConfidence = 0.6;
        private long timeoutMs = 3000;

        public Builder(TargetGender target) {
            if (target == null) throw new IllegalArgumentException("target مطلوب");
            this.target = target;
        }

        public Builder strict(boolean v) { this.strict = v; return this; }
        public Builder blockThreshold(double v) { this.blockThreshold = v; return this; }
        public Builder minPersonConfidence(double v) { this.minPersonConfidence = v; return this; }
        public Builder minGenderConfidence(double v) { this.minGenderConfidence = v; return this; }
        public Builder timeoutMs(long v) { this.timeoutMs = v; return this; }

        public Policy build() {
            return new Policy(this);
        }
    }
}
