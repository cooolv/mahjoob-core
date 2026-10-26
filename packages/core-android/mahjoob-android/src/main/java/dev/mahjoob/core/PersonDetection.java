package dev.mahjoob.core;

/** نتيجة كشف شخص/وجه واحد من النموذج. */
public final class PersonDetection {
    public final Box box;
    /** ثقة أن الكشف شخص/وجه فعلًا (0..1). */
    public final double confidence;
    /** احتمال أن يكون أنثى (0..1)، أو null إن لم يُصنَّف. */
    public final Double pFemale;
    /** ثقة تصنيف الجنس (0..1)، أو null. */
    public final Double genderConfidence;

    public PersonDetection(Box box, double confidence, Double pFemale, Double genderConfidence) {
        this.box = box;
        this.confidence = confidence;
        this.pFemale = pFemale;
        this.genderConfidence = genderConfidence;
    }

    public PersonDetection(Box box, double confidence) {
        this(box, confidence, null, null);
    }

    /** نسخة مع تصنيف الجنس. ثقة التصنيف = max(p, 1-p). */
    public PersonDetection withFemaleProbability(double pf) {
        return new PersonDetection(box, confidence, pf, Math.max(pf, 1 - pf));
    }
}
