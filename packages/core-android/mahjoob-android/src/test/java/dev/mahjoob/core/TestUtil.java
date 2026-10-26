package dev.mahjoob.core;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** أدوات مشتركة للاختبارات (جلسات وهمية، صور اصطناعية، قراءة متجهات spec). */
final class TestUtil {
    private TestUtil() {}

    static RawImage solid(int w, int h, int r, int g, int b) {
        byte[] d = new byte[w * h * 4];
        for (int i = 0; i < w * h; i++) {
            d[i * 4] = (byte) r;
            d[i * 4 + 1] = (byte) g;
            d[i * 4 + 2] = (byte) b;
            d[i * 4 + 3] = (byte) 255;
        }
        return new RawImage(d, w, h);
    }

    static Box box() {
        return new Box(0, 0, 10, 10);
    }

    static PersonDetection det(double pFemale, double genderConf, double conf) {
        return new PersonDetection(box(), conf, pFemale, genderConf);
    }

    /** جلسة وهمية يعاد منها قاموس ثابت (للاختبار فقط). */
    static final class FakeSession implements ModelSession {
        interface Fn { java.util.Map<String, FloatTensor> run(java.util.Map<String, FloatTensor> feeds) throws Exception; }

        private final List<String> in;
        private final List<String> out;
        private final Fn fn;
        int calls = 0;
        java.util.Map<String, FloatTensor> lastFeeds;

        FakeSession(String in, List<String> out, Fn fn) {
            this.in = Arrays.asList(in);
            this.out = out;
            this.fn = fn;
        }

        @Override public List<String> inputNames() { return in; }
        @Override public List<String> outputNames() { return out; }

        @Override
        public java.util.Map<String, FloatTensor> run(java.util.Map<String, FloatTensor> feeds) throws Exception {
            calls++;
            lastFeeds = feeds;
            return fn.run(feeds);
        }
    }

    static FloatTensor t(float[] data, long... shape) {
        return new FloatTensor(data, shape);
    }

    /** مخرجات YuNet وهمية لمدخل w×h: كلها أصفار عدا خلية واحدة. */
    static java.util.Map<String, FloatTensor> yunetOut(int w, int h, int stride, int r, int c,
                                                       float cls, float obj, float[] bbox) {
        java.util.Map<String, FloatTensor> o = new java.util.LinkedHashMap<String, FloatTensor>();
        for (int s : new int[]{8, 16, 32}) {
            int n = (w / s) * (h / s);
            o.put("cls_" + s, t(new float[n], 1, n, 1));
            o.put("obj_" + s, t(new float[n], 1, n, 1));
            o.put("bbox_" + s, t(new float[n * 4], 1, n, 4));
            o.put("kps_" + s, t(new float[n * 10], 1, n, 10));
        }
        if (bbox != null) {
            int i = r * (w / stride) + c;
            o.get("cls_" + stride).data[i] = cls;
            o.get("obj_" + stride).data[i] = obj;
            System.arraycopy(bbox, 0, o.get("bbox_" + stride).data, i * 4, 4);
        }
        return o;
    }

    static List<String> yunetNames() {
        List<String> n = new ArrayList<String>();
        for (String k : new String[]{"cls", "obj", "bbox", "kps"}) for (int s : new int[]{8, 16, 32}) n.add(k + "_" + s);
        return n;
    }

    /** يقرأ ملف متجهات من الموارد: يتجاوز التعليقات والأسطر الفارغة ويقسّم على TAB. */
    static List<String[]> readVectors(String name) throws IOException {
        InputStream in = TestUtil.class.getClassLoader().getResourceAsStream(name);
        if (in == null) throw new IOException("ملف المتجهات غير موجود في الموارد: " + name);
        BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        List<String[]> rows = new ArrayList<String[]>();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            rows.add(line.split("\t", -1));
        }
        br.close();
        return rows;
    }

    static byte[] unhex(String h) {
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xFF));
        return sb.toString();
    }
}
