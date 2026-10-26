package dev.mahjoob.core;

/** كيف نفسّر مخرجات مصنّف الجنس. */
public final class ClassifierOutput {
    enum Kind { SINGLE_PROB, SINGLE_LOGIT, SOFTMAX }

    final Kind kind;
    final boolean positiveIsFemale;
    final int femaleIndex;

    private ClassifierOutput(Kind kind, boolean positiveIsFemale, int femaleIndex) {
        this.kind = kind;
        this.positiveIsFemale = positiveIsFemale;
        this.femaleIndex = femaleIndex;
    }

    /** قيمة واحدة = احتمال (0..1) للفئة الموجبة. */
    public static ClassifierOutput singleProb(boolean positiveIsFemale) {
        return new ClassifierOutput(Kind.SINGLE_PROB, positiveIsFemale, 0);
    }

    /** قيمة واحدة = logit للفئة الموجبة. */
    public static ClassifierOutput singleLogit(boolean positiveIsFemale) {
        return new ClassifierOutput(Kind.SINGLE_LOGIT, positiveIsFemale, 0);
    }

    /** عدة قيم (logits أو احتمالات جاهزة) والأنثى عند الفهرس المحدد. */
    public static ClassifierOutput softmax(int femaleIndex) {
        return new ClassifierOutput(Kind.SOFTMAX, true, femaleIndex);
    }

    /** احتمال الأنثى من مخرجات المصنّف. */
    public double femaleProbability(float[] values) {
        if (values == null || values.length == 0 || Double.isNaN(values[0]) || Double.isInfinite(values[0])) {
            throw new IllegalArgumentException("مخرجات المصنّف فارغة أو غير صالحة");
        }
        double first = values[0];
        double p;
        if (kind == Kind.SINGLE_PROB) {
            p = positiveIsFemale ? first : 1 - first;
        } else if (kind == Kind.SINGLE_LOGIT) {
            double s = 1 / (1 + Math.exp(-first));
            p = positiveIsFemale ? s : 1 - s;
        } else {
            if (femaleIndex < 0 || femaleIndex >= values.length) throw new IllegalArgumentException("femaleIndex خارج النطاق");
            double sum = 0;
            boolean allUnit = true;
            for (float v : values) {
                sum += v;
                if (!(v >= 0 && v <= 1)) allUnit = false;
            }
            boolean isProb = allUnit && Math.abs(sum - 1) < 1e-3;
            if (isProb) {
                p = values[femaleIndex];
            } else {
                double m = Double.NEGATIVE_INFINITY;
                for (float v : values) m = Math.max(m, v);
                double total = 0;
                double[] e = new double[values.length];
                for (int i = 0; i < values.length; i++) {
                    e[i] = Math.exp(values[i] - m);
                    total += e[i];
                }
                p = e[femaleIndex] / total;
            }
        }
        if (Double.isNaN(p) || Double.isInfinite(p)) throw new IllegalArgumentException("احتمال غير صالح");
        return Math.min(1, Math.max(0, p));
    }
}
