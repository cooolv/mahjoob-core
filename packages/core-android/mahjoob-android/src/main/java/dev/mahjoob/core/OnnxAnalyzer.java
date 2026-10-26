package dev.mahjoob.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * محلّل بمرحلتين: (1) كشف أشخاص/وجوه، (2) تصنيف الجنس لكل اقتطاع. مستقل عن مكتبة النماذج (عبر ModelSession).
 * سلوك الفشل:
 *  - فشل الكاشف => يرمي استثناءً => ImageGuard يحجب.
 *  - فشل تصنيف شخص واحد => يبقى جنسه غير محسوم => الوضع الصارم يحجب.
 *  - أكثر من maxPeople => الزائدون غير محسومين => حجب.
 */
public final class OnnxAnalyzer implements PersonAnalyzer {

    /** يحوّل مخرجات الكاشف إلى مرشّحين بإحداثيات مدخل النموذج. */
    public interface DetectorDecoder {
        List<Candidate> decode(Map<String, FloatTensor> outputs, List<String> outputNames, int inputW, int inputH);
    }

    public static DetectorDecoder yunetDecoder(final double scoreThreshold, final double iouThreshold) {
        return new DetectorDecoder() {
            @Override
            public List<Candidate> decode(Map<String, FloatTensor> outputs, List<String> names, int w, int h) {
                return Decoders.decodeYuNet(outputs, w, h, scoreThreshold, iouThreshold);
            }
        };
    }

    public static DetectorDecoder yoloDecoder(final Decoders.YoloConfig cfg) {
        return new DetectorDecoder() {
            @Override
            public List<Candidate> decode(Map<String, FloatTensor> outputs, List<String> names, int w, int h) {
                FloatTensor t = outputs.get(names.get(0));
                if (t == null) throw new IllegalStateException("لا مخرجات من نموذج الكشف");
                return Decoders.decodeYolo(t.data, t.shape, cfg);
            }
        };
    }

    public static final class DetectorConfig {
        final ModelSession session;
        final int inputW;
        final int inputH;
        final Normalize normalize;
        final boolean allowUpscale;
        final DetectorDecoder decoder;

        public DetectorConfig(ModelSession session, int inputW, int inputH, Normalize normalize,
                              boolean allowUpscale, DetectorDecoder decoder) {
            this.session = session;
            this.inputW = inputW;
            this.inputH = inputH;
            this.normalize = normalize;
            this.allowUpscale = allowUpscale;
            this.decoder = decoder;
        }
    }

    public static final class ClassifierConfig {
        final ModelSession session;
        final String outputName;
        final int inputW;
        final int inputH;
        final Normalize normalize;
        final ClassifierOutput output;
        final double cropMargin;
        final boolean squareCrop;

        /** @param outputName اسم المخرج المطلوب، أو null لاستخدام الأول */
        public ClassifierConfig(ModelSession session, String outputName, int inputW, int inputH, Normalize normalize,
                                ClassifierOutput output, double cropMargin, boolean squareCrop) {
            this.session = session;
            this.outputName = outputName;
            this.inputW = inputW;
            this.inputH = inputH;
            this.normalize = normalize;
            this.output = output;
            this.cropMargin = cropMargin;
            this.squareCrop = squareCrop;
        }
    }

    private final DetectorConfig det;
    private final ClassifierConfig cls;
    private final int maxPeople;

    public OnnxAnalyzer(DetectorConfig det, ClassifierConfig cls, int maxPeople) {
        this.det = det;
        this.cls = cls;
        this.maxPeople = maxPeople;
    }

    private static void checkInterrupt() throws InterruptedException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException("أُلغي التحليل");
    }

    private static Map<String, FloatTensor> single(String name, FloatTensor t) {
        Map<String, FloatTensor> m = new HashMap<String, FloatTensor>();
        m.put(name, t);
        return m;
    }

    private static final class Person {
        final Box box;
        final double score;

        Person(Box box, double score) {
            this.box = box;
            this.score = score;
        }
    }

    @Override
    public List<PersonDetection> analyze(RawImage raw) throws Exception {
        checkInterrupt();

        // 1) الكشف
        ImageOps.Letterboxed lb = ImageOps.letterbox(raw, det.inputW, det.inputH, 114, det.allowUpscale);
        float[] chw = ImageOps.toChw(lb.image, det.normalize);
        FloatTensor input = new FloatTensor(chw, new long[]{1, 3, det.inputH, det.inputW});
        Map<String, FloatTensor> outs = det.session.run(single(det.session.inputNames().get(0), input));
        checkInterrupt();
        List<Candidate> cands = det.decoder.decode(outs, det.session.outputNames(), det.inputW, det.inputH);

        List<Person> people = new ArrayList<Person>();
        for (Candidate c : cands) {
            Box b = Decoders.unletterbox(c.box, lb.scale, lb.padX, lb.padY, raw.width, raw.height);
            if (b.width > 0 && b.height > 0) people.add(new Person(b, c.score));
        }
        Collections.sort(people, new Comparator<Person>() {
            @Override
            public int compare(Person a, Person b) {
                return Double.compare(b.box.width * b.box.height, a.box.width * a.box.height);   // الأكبر مساحةً أولًا
            }
        });

        // 2) التصنيف
        List<PersonDetection> result = new ArrayList<PersonDetection>();
        for (int i = 0; i < people.size(); i++) {
            Person p = people.get(i);
            PersonDetection d = new PersonDetection(p.box, p.score);
            if (i < maxPeople) {
                try {
                    checkInterrupt();
                    d = d.withFemaleProbability(classify(raw, p.box));
                } catch (InterruptedException e) {
                    throw e;
                } catch (Exception e) {
                    if (Thread.currentThread().isInterrupted()) throw e;
                    // يبقى غير محسوم => حجب في الوضع الصارم
                }
            }
            result.add(d);
        }
        return result;
    }

    private double classify(RawImage raw, Box box) throws Exception {
        double m = cls.cropMargin;
        double cx = box.x + box.width / 2;
        double cy = box.y + box.height / 2;
        double w = box.width * (1 + m);
        double h = box.height * (1 + m);
        if (cls.squareCrop) {
            w = Math.max(w, h);
            h = w;
        }
        RawImage crop = ImageOps.resizeRegion(raw, cx - w / 2, cy - h / 2, w, h, cls.inputW, cls.inputH);
        float[] chw = ImageOps.toChw(crop, cls.normalize);
        FloatTensor t = new FloatTensor(chw, new long[]{1, 3, cls.inputH, cls.inputW});
        Map<String, FloatTensor> outs = cls.session.run(single(cls.session.inputNames().get(0), t));
        String name = cls.outputName != null ? cls.outputName : cls.session.outputNames().get(0);
        FloatTensor out = outs.get(name);
        if (out == null) throw new IllegalStateException("لا مخرجات من المصنّف (تحقق من outputName)");
        return cls.output.femaleProbability(out.data);
    }
}
