package dev.mahjoob.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/** يتحقق أن نسخة Java تطابق المتجهات المشتركة المتولّدة من نسخة TypeScript (المرجع). */
public class VectorsTest {

    private static Double opt(String s) {
        return "-".equals(s) ? null : Double.valueOf(s);
    }

    private static String fmt(double v) {
        // تنسيق جافاسكربت لأعداد صحيحة (10 وليس 10.0) لمقارنة المناطق نصًا
        if (v == Math.rint(v) && Math.abs(v) < 1e15) return String.valueOf((long) v);
        return String.valueOf(v);
    }

    @Test
    public void policyVectors() throws Exception {
        List<String[]> rows = TestUtil.readVectors("policy.tsv");
        assertTrue(rows.size() > 1000);
        for (String[] r : rows) {
            TargetGender target = TargetGender.valueOf(r[0].toUpperCase());
            Policy policy = new Policy.Builder(target).strict(Boolean.parseBoolean(r[1]))
                    .blockThreshold(Double.parseDouble(r[2])).minPersonConfidence(Double.parseDouble(r[3]))
                    .minGenderConfidence(Double.parseDouble(r[4])).build();
            List<PersonDetection> dets = new ArrayList<PersonDetection>();
            if (!"-".equals(r[5])) {
                for (String d : r[5].split(";")) {
                    String[] f = d.split(",");
                    dets.add(new PersonDetection(
                            new Box(Double.parseDouble(f[0]), Double.parseDouble(f[1]), Double.parseDouble(f[2]), Double.parseDouble(f[3])),
                            Double.parseDouble(f[4]), opt(f[5]), opt(f[6])));
                }
            }
            Decision d = PolicyEngine.decide(dets, policy);
            String msg = String.join(" ", r[0], r[1], r[2], r[5]);
            assertEquals(msg, r[6].toUpperCase(), d.action.name());
            assertEquals(msg, r[7], d.reason.id());
            StringBuilder regions = new StringBuilder();
            for (Box b : d.regions) {
                if (regions.length() > 0) regions.append(';');
                regions.append(fmt(b.x)).append(',').append(fmt(b.y)).append(',').append(fmt(b.width)).append(',').append(fmt(b.height));
            }
            assertEquals(msg, r[8], regions.length() == 0 ? "-" : regions.toString());
        }
    }

    @Test
    public void imageVectors() throws Exception {
        int n = 0;
        for (String[] r : TestUtil.readVectors("image.tsv")) {
            int w = Integer.parseInt(r[1]);
            int h = Integer.parseInt(r[2]);
            RawImage img = new RawImage(TestUtil.unhex(r[3]), w, h);
            if ("RESIZE".equals(r[0])) {
                RawImage out = ImageOps.resizeRegion(img, Double.parseDouble(r[4]), Double.parseDouble(r[5]),
                        Double.parseDouble(r[6]), Double.parseDouble(r[7]), Integer.parseInt(r[8]), Integer.parseInt(r[9]));
                assertEquals("RESIZE " + n, r[10], TestUtil.hex(out.data));
            } else if ("LETTERBOX".equals(r[0])) {
                ImageOps.Letterboxed lb = ImageOps.letterbox(img, Integer.parseInt(r[4]), Integer.parseInt(r[5]), 114, Boolean.parseBoolean(r[6]));
                assertEquals(Double.parseDouble(r[7]), lb.scale, 0.0);
                assertEquals(Integer.parseInt(r[8]), lb.padX);
                assertEquals(Integer.parseInt(r[9]), lb.padY);
                assertEquals("LETTERBOX " + n, r[10], TestUtil.hex(lb.image.data));
            } else if ("CHW".equals(r[0])) {
                Normalize.Builder nb = new Normalize.Builder();
                if (!"-".equals(r[4])) nb.scale(Double.parseDouble(r[4]));
                if (!"-".equals(r[5])) { String[] m = r[5].split(","); nb.mean(Double.parseDouble(m[0]), Double.parseDouble(m[1]), Double.parseDouble(m[2])); }
                if (!"-".equals(r[6])) { String[] s = r[6].split(","); nb.std(Double.parseDouble(s[0]), Double.parseDouble(s[1]), Double.parseDouble(s[2])); }
                nb.bgr(Boolean.parseBoolean(r[7]));
                float[] got = ImageOps.toChw(img, nb.build());
                String[] exp = r[8].split(",");
                assertEquals(exp.length, got.length);
                for (int i = 0; i < got.length; i++) {
                    // قيم TypeScript float32 مطبوعة كـdouble، فالمقارنة بعد تحويلها إلى float
                    assertEquals("CHW " + n + "[" + i + "]", (float) Double.parseDouble(exp[i]), got[i], 0f);
                }
            }
            n++;
        }
        assertTrue(n >= 50);
    }

    @Test
    public void yunetVectors() throws Exception {
        List<String[]> rows = TestUtil.readVectors("yunet.tsv");
        assertEquals(18, rows.size());
        for (String[] r : rows) {
            int w = Integer.parseInt(r[1]);
            int h = Integer.parseInt(r[2]);
            Map<String, FloatTensor> outs = new LinkedHashMap<String, FloatTensor>();
            for (String part : r[5].split("\\|")) {
                String[] kv = part.split("=", 2);
                String[] vals = kv[1].split(",");
                float[] data = new float[vals.length];
                for (int i = 0; i < vals.length; i++) data[i] = Float.parseFloat(vals[i]);
                outs.put(kv[0], new FloatTensor(data, new long[]{1, data.length, 1}));
            }
            List<Candidate> got = Decoders.decodeYuNet(outs, w, h, Double.parseDouble(r[3]), Double.parseDouble(r[4]));
            if ("-".equals(r[6])) {
                assertEquals(0, got.size());
                continue;
            }
            String[] exp = r[6].split(";");
            assertEquals(exp.length, got.size());
            for (int i = 0; i < exp.length; i++) {
                String[] f = exp[i].split(",");
                Candidate c = got.get(i);
                // exp() قد يختلف بوحدة أخيرة بين JS وJava، فنقارن بتسامح نسبي صغير جدًا
                assertEquals(Double.parseDouble(f[0]), c.box.x, 1e-9 * Math.max(1, Math.abs(c.box.x)));
                assertEquals(Double.parseDouble(f[1]), c.box.y, 1e-9 * Math.max(1, Math.abs(c.box.y)));
                assertEquals(Double.parseDouble(f[2]), c.box.width, 1e-9 * Math.max(1, c.box.width));
                assertEquals(Double.parseDouble(f[3]), c.box.height, 1e-9 * Math.max(1, c.box.height));
                assertEquals(Double.parseDouble(f[4]), c.score, 1e-12);
            }
        }
    }
}
