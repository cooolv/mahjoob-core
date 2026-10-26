package dev.mahjoob.android;

import dev.mahjoob.core.TargetGender;
import dev.mahjoob.core.YuNetGenderV1;

/** إعدادات MahjoobGuard. القيم الافتراضية هي الموصى بها وتطابق قياسنا. */
public final class MahjoobOptions {
    final TargetGender target;
    final boolean strict;
    final double blockThreshold;
    final long timeoutMs;
    final double cropMargin;
    final int maxSide;
    final String assetDir;
    final int cacheSize;
    final int maxPeople;
    final double faceScoreThreshold;

    private MahjoobOptions(Builder b) {
        this.target = b.target;
        this.strict = b.strict;
        this.blockThreshold = b.blockThreshold;
        this.timeoutMs = b.timeoutMs;
        this.cropMargin = b.cropMargin;
        this.maxSide = b.maxSide;
        this.assetDir = b.assetDir;
        this.cacheSize = b.cacheSize;
        this.maxPeople = b.maxPeople;
        this.faceScoreThreshold = b.faceScoreThreshold;
    }

    public static final class Builder {
        private final TargetGender target;
        private boolean strict = true;
        private double blockThreshold = 0.2;
        private long timeoutMs = 15000;
        private double cropMargin = YuNetGenderV1.DEFAULT_CROP_MARGIN;
        private int maxSide = 1280;
        private String assetDir = "mahjoob";
        private int cacheSize = 500;
        private int maxPeople = 10;
        private double faceScoreThreshold = 0.6;

        public Builder(TargetGender target) {
            if (target == null) throw new IllegalArgumentException("target مطلوب");
            this.target = target;
        }

        /** الوضع الصارم (الافتراضي true): أي خطأ أو غموض = حجب. لا تعطّله إلا لسبب واضح. */
        public Builder strict(boolean v) { this.strict = v; return this; }

        /** عتبة الحجب لاحتمال الجنس المستهدف (الافتراضي 0.2). */
        public Builder blockThreshold(double v) { this.blockThreshold = v; return this; }

        /** مهلة تحليل الصورة الواحدة بالمللي ثانية (الافتراضي 15000؛ أول تشغيل على جهاز بطيء قد يحتاج وقتًا). */
        public Builder timeoutMs(long v) { this.timeoutMs = v; return this; }

        public Builder cropMargin(double v) { this.cropMargin = v; return this; }

        /** أكبر ضلع للصورة قبل التحليل (الافتراضي 1280). */
        public Builder maxSide(int v) { this.maxSide = v; return this; }

        /** مجلد النماذج داخل assets (الافتراضي "mahjoob"). */
        public Builder assetDir(String v) { this.assetDir = v; return this; }

        public Builder cacheSize(int v) { this.cacheSize = v; return this; }

        public Builder maxPeople(int v) { this.maxPeople = v; return this; }

        public Builder faceScoreThreshold(double v) { this.faceScoreThreshold = v; return this; }

        public MahjoobOptions build() {
            return new MahjoobOptions(this);
        }
    }
}
