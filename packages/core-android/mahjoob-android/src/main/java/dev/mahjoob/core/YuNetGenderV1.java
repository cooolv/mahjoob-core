package dev.mahjoob.core;

/**
 * إعداد جاهز: كاشف الوجوه YuNet (MIT) + مصنّف الجنس gender-v1 (CC0، من dlib-models عبر حزمة age-and-gender).
 *
 * القيم من manifest النموذج ومن قياسنا:
 *  - gender-v1: مدخل RGB بحجم 32×32، الصيغة (البكسل − المتوسط) ÷ 256، والفئة 0 = أنثى، والمخرج "probabilities".
 *  - YuNet 2023mar: مدخل BGR بقيم 0..255 مثبّت على 640×640.
 *  - الهامش −0.1 أفضل قيمة في قياسنا على FairFace.
 *
 * تحذير: النموذج مدرّب على وجوه مُحاذاة بنقاط dlib ونحن نقتطع من صندوق YuNet دون محاذاة،
 * فالدقة أقل من المعلنة (انظر README: نحو 7% تسرّب على وجوه واضحة).
 */
public final class YuNetGenderV1 {
    private YuNetGenderV1() {}

    public static final double[] MEANS = {122.781998, 117.000999, 104.297997};
    public static final double DEFAULT_CROP_MARGIN = -0.1;
    public static final String YUNET_ASSET = "face_detection_yunet_2023mar.onnx";
    public static final String GENDER_ASSET = "gender-v1.onnx";

    public static final class Options {
        public int detectorInputSize = 640;
        public double faceScoreThreshold = 0.6;
        public double cropMargin = DEFAULT_CROP_MARGIN;
        public int maxPeople = 10;
    }

    public static OnnxAnalyzer create(ModelSession yunet, ModelSession gender) {
        return create(yunet, gender, new Options());
    }

    public static OnnxAnalyzer create(ModelSession yunet, ModelSession gender, Options o) {
        OnnxAnalyzer.DetectorConfig det = new OnnxAnalyzer.DetectorConfig(
                yunet, o.detectorInputSize, o.detectorInputSize,
                new Normalize.Builder().scale(1).bgr(true).build(),
                false,
                OnnxAnalyzer.yunetDecoder(o.faceScoreThreshold, 0.3));
        OnnxAnalyzer.ClassifierConfig cls = new OnnxAnalyzer.ClassifierConfig(
                gender, "probabilities", 32, 32,
                new Normalize.Builder().scale(1).mean(MEANS[0], MEANS[1], MEANS[2]).std(256, 256, 256).build(),
                ClassifierOutput.softmax(0), o.cropMargin, true);
        return new OnnxAnalyzer(det, cls, o.maxPeople);
    }
}
