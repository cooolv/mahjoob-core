package dev.mahjoob.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** فك مخرجات الكواشف: YuNet وأنماط YOLO، مع NMS. */
public final class Decoders {
    private Decoders() {}

    /** تنسيق مخرجات YOLO العامة. */
    public enum YoloLayout {
        /** [1, 4+C, N] (نمط YOLOv8/YOLO11، بلا objectness) */
        CHANNELS_FIRST,
        /** [1, N, 5+C] (نمط YOLOX/YOLOv5) */
        ROWS_WITH_OBJECTNESS
    }

    public static final class YoloConfig {
        public final YoloLayout layout;
        public final int classIndex;
        public final double scoreThreshold;
        public final double iouThreshold;

        public YoloConfig(YoloLayout layout, int classIndex, double scoreThreshold, double iouThreshold) {
            this.layout = layout;
            this.classIndex = classIndex;
            this.scoreThreshold = scoreThreshold;
            this.iouThreshold = iouThreshold;
        }

        public YoloConfig(YoloLayout layout, int classIndex) {
            this(layout, classIndex, 0.25, 0.45);
        }
    }

    private static double clamp01(double x) {
        return x < 0 ? 0 : (x > 1 ? 1 : x);
    }

    public static double iou(Box a, Box b) {
        double x1 = Math.max(a.x, b.x);
        double y1 = Math.max(a.y, b.y);
        double x2 = Math.min(a.x + a.width, b.x + b.width);
        double y2 = Math.min(a.y + a.height, b.y + b.height);
        double inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        double union = a.width * a.height + b.width * b.height - inter;
        return union <= 0 ? 0 : inter / union;
    }

    public static List<Candidate> nms(List<Candidate> c, double iouThr) {
        List<Candidate> sorted = new ArrayList<Candidate>(c);
        Collections.sort(sorted, new Comparator<Candidate>() {
            @Override
            public int compare(Candidate a, Candidate b) {
                return Double.compare(b.score, a.score);     // ترتيب مستقر: التعادل يبقى بترتيبه الأصلي
            }
        });
        List<Candidate> kept = new ArrayList<Candidate>();
        for (Candidate cand : sorted) {
            boolean ok = true;
            for (Candidate k : kept) {
                if (!(iou(k.box, cand.box) < iouThr)) { ok = false; break; }
            }
            if (ok) kept.add(cand);
        }
        return kept;
    }

    /** إعادة الصندوق من إحداثيات المدخل (بعد Letterbox) إلى إحداثيات الصورة الأصلية. */
    public static Box unletterbox(Box b, double scale, int padX, int padY, int origW, int origH) {
        double x1 = Math.min(origW, Math.max(0, (b.x - padX) / scale));
        double y1 = Math.min(origH, Math.max(0, (b.y - padY) / scale));
        double x2 = Math.min(origW, Math.max(0, (b.x + b.width - padX) / scale));
        double y2 = Math.min(origH, Math.max(0, (b.y + b.height - padY) / scale));
        return new Box(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
    }

    /**
     * فك مخرجات YuNet كما في OpenCV FaceDetectorYN: الدرجة = sqrt(clamp(cls)×clamp(obj))،
     * المركز = (عمود + انحراف) × stride، العرض/الارتفاع = exp(قيمة) × stride.
     * الصناديق بإحداثيات مدخل النموذج.
     */
    public static List<Candidate> decodeYuNet(Map<String, FloatTensor> outputs, int width, int height,
                                              double scoreThreshold, double iouThreshold) {
        List<Candidate> out = new ArrayList<Candidate>();
        int[] strides = {8, 16, 32};
        for (int s : strides) {
            FloatTensor cls = outputs.get("cls_" + s);
            FloatTensor obj = outputs.get("obj_" + s);
            FloatTensor bbox = outputs.get("bbox_" + s);
            if (cls == null || obj == null || bbox == null) {
                throw new IllegalArgumentException("مخرجات YuNet ناقصة للـstride " + s
                        + " (المتوقع cls_" + s + " وobj_" + s + " وbbox_" + s + ")");
            }
            int cols = width / s;
            int rows = height / s;
            int n = cols * rows;
            if (cls.data.length < n || obj.data.length < n || bbox.data.length < n * 4) {
                throw new IllegalArgumentException("أبعاد مخرجات YuNet لا تطابق حجم المدخل " + width + "x" + height
                        + " عند stride " + s);
            }
            for (int r = 0; r < rows; r++) {
                for (int c = 0; c < cols; c++) {
                    int i = r * cols + c;
                    double score = Math.sqrt(clamp01(cls.data[i]) * clamp01(obj.data[i]));
                    if (!(score >= scoreThreshold)) continue;
                    double cx = (c + (double) bbox.data[i * 4]) * s;
                    double cy = (r + (double) bbox.data[i * 4 + 1]) * s;
                    double w = Math.exp(bbox.data[i * 4 + 2]) * s;
                    double h = Math.exp(bbox.data[i * 4 + 3]) * s;
                    if (!Double.isInfinite(w) && !Double.isNaN(w) && !Double.isInfinite(h) && !Double.isNaN(h)
                            && w > 0 && h > 0) {
                        out.add(new Candidate(new Box(cx - w / 2, cy - h / 2, w, h), score));
                    }
                }
            }
        }
        return nms(out, iouThreshold);
    }

    /** فك مخرجات YOLO العامة. dims مثل [1, 84, 8400]. */
    public static List<Candidate> decodeYolo(float[] data, long[] dims, YoloConfig cfg) {
        List<Long> d = new ArrayList<Long>();
        for (int i = 0; i < dims.length; i++) {
            if (!(i == 0 && dims[0] == 1)) d.add(dims[i]);
        }
        if (d.size() != 2) throw new IllegalArgumentException("شكل مخرجات الكشف غير مدعوم");
        List<Candidate> out = new ArrayList<Candidate>();

        if (cfg.layout == YoloLayout.CHANNELS_FIRST) {
            int ch = (int) (long) d.get(0);
            int n = (int) (long) d.get(1);
            if (cfg.classIndex < 0 || 4 + cfg.classIndex >= ch) throw new IllegalArgumentException("classIndex خارج النطاق");
            for (int i = 0; i < n; i++) {
                push(out, data[i], data[n + i], data[2 * n + i], data[3 * n + i],
                        data[(4 + cfg.classIndex) * n + i], cfg.scoreThreshold);
            }
        } else {
            int n = (int) (long) d.get(0);
            int dd = (int) (long) d.get(1);
            if (cfg.classIndex < 0 || 5 + cfg.classIndex >= dd) throw new IllegalArgumentException("classIndex خارج النطاق");
            for (int i = 0; i < n; i++) {
                int o = i * dd;
                push(out, data[o], data[o + 1], data[o + 2], data[o + 3],
                        (double) data[o + 4] * data[o + 5 + cfg.classIndex], cfg.scoreThreshold);
            }
        }
        return nms(out, cfg.iouThreshold);
    }

    private static void push(List<Candidate> out, double cx, double cy, double w, double h, double score, double thr) {
        if (score >= thr && w > 0 && h > 0) {
            out.add(new Candidate(new Box(cx - w / 2, cy - h / 2, w, h), score));
        }
    }
}
