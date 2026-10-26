package dev.mahjoob.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/** منافس لاختبارات TypeScript للمحوّل (نفس الأرقام) باستخدام جلسات وهمية. */
public class OnnxAnalyzerTest {

    private static Map<String, FloatTensor> one(String name, float[] data, long... dims) {
        Map<String, FloatTensor> m = new HashMap<String, FloatTensor>();
        m.put(name, new FloatTensor(data, dims));
        return m;
    }

    /** مخرجات كاشف بنمط channels-first: C=1، كل كشف [cx,cy,w,h,score] */
    private static Map<String, FloatTensor> detOut(float[][] items) {
        int n = items.length;
        float[] d = new float[5 * n];
        for (int k = 0; k < 5; k++) for (int i = 0; i < n; i++) d[k * n + i] = items[i][k];
        return one("out", d, 1, 5, n);
    }

    private static OnnxAnalyzer make(ModelSession cls, ModelSession det, int maxPeople) {
        OnnxAnalyzer.DetectorConfig dc = new OnnxAnalyzer.DetectorConfig(det, 100, 100, Normalize.defaults(), true,
                OnnxAnalyzer.yoloDecoder(new Decoders.YoloConfig(Decoders.YoloLayout.CHANNELS_FIRST, 0)));
        OnnxAnalyzer.ClassifierConfig cc = new OnnxAnalyzer.ClassifierConfig(cls, null, 8, 8, Normalize.defaults(),
                ClassifierOutput.singleProb(true), 0.2, true);
        return new OnnxAnalyzer(dc, cc, maxPeople);
    }

    private static TestUtil.FakeSession detSession(final float[][] items) {
        return new TestUtil.FakeSession("in", Arrays.asList("out"), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) { return detOut(items); }
        });
    }

    private static TestUtil.FakeSession clsSession(final float p) {
        return new TestUtil.FakeSession("in", Arrays.asList("out"), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) { return one("out", new float[]{p}, 1, 1); }
        });
    }

    @Test
    public void boxIsInOriginalImageCoordinatesAndGenderSet() throws Exception {
        OnnxAnalyzer a = make(clsSession(0.95f), detSession(new float[][]{{50, 50, 20, 20, 0.9f}}), 10);
        List<PersonDetection> r = a.analyze(TestUtil.solid(200, 100, 100, 100, 100));
        assertEquals(1, r.size());
        Box b = r.get(0).box;
        assertEquals(80, b.x, 1e-9);
        assertEquals(30, b.y, 1e-9);
        assertEquals(40, b.width, 1e-9);
        assertEquals(40, b.height, 1e-9);
        assertEquals(0.95, r.get(0).pFemale, 1e-6);
        assertEquals(0.95, r.get(0).genderConfidence, 1e-6);
    }

    @Test
    public void withGuardFemaleBlockedMaleAllowed() {
        RawImage img = TestUtil.solid(200, 100, 100, 100, 100);
        ImageGuard f = new ImageGuard(make(clsSession(0.95f), detSession(new float[][]{{50, 50, 20, 20, 0.9f}}), 10), Policy.defaults(TargetGender.FEMALE));
        ImageGuard m = new ImageGuard(make(clsSession(0.03f), detSession(new float[][]{{50, 50, 20, 20, 0.9f}}), 10), Policy.defaults(TargetGender.FEMALE));
        try {
            assertEquals(Action.BLOCK, f.check(img).action);
            assertEquals(Action.ALLOW, m.check(img).action);
        } finally { f.close(); m.close(); }
    }

    @Test
    public void classifierFailureBlocksAsUncertain() {
        ModelSession bad = new TestUtil.FakeSession("in", Arrays.asList("out"), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) throws Exception { throw new Exception("boom"); }
        });
        ImageGuard g = new ImageGuard(make(bad, detSession(new float[][]{{50, 50, 20, 20, 0.9f}}), 10), Policy.defaults(TargetGender.FEMALE));
        try {
            Decision d = g.check(TestUtil.solid(200, 100, 1, 2, 3));
            assertEquals(Action.BLOCK, d.action);
            assertEquals(Reason.UNCERTAIN_GENDER, d.reason);
        } finally { g.close(); }
    }

    @Test
    public void detectorFailureBlocksAsError() {
        ModelSession bad = new TestUtil.FakeSession("in", Arrays.asList("out"), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) throws Exception { throw new Exception("boom"); }
        });
        ImageGuard g = new ImageGuard(make(clsSession(0.1f), bad, 10), Policy.defaults(TargetGender.FEMALE));
        try {
            Decision d = g.check(TestUtil.solid(200, 100, 1, 2, 3));
            assertEquals(Action.BLOCK, d.action);
            assertEquals(Reason.ANALYSIS_ERROR, d.reason);
        } finally { g.close(); }
    }

    @Test
    public void noPeopleAllows() {
        ImageGuard g = new ImageGuard(make(clsSession(0.5f), detSession(new float[][]{{50, 50, 20, 20, 0.05f}}), 10), Policy.defaults(TargetGender.FEMALE));
        try {
            Decision d = g.check(TestUtil.solid(200, 100, 1, 2, 3));
            assertEquals(Action.ALLOW, d.action);
            assertEquals(Reason.NO_PERSON, d.reason);
        } finally { g.close(); }
    }

    @Test
    public void maxPeopleLeavesExtrasUnresolved() throws Exception {
        TestUtil.FakeSession cls = clsSession(0.01f);
        float[][] items = {{20, 20, 10, 10, 0.9f}, {50, 50, 30, 30, 0.9f}, {80, 80, 12, 12, 0.9f}};
        OnnxAnalyzer a = make(cls, detSession(items), 2);
        List<PersonDetection> r = a.analyze(TestUtil.solid(100, 100, 9, 9, 9));
        assertEquals(3, r.size());
        assertEquals(2, cls.calls);
        int unresolved = 0;
        for (PersonDetection p : r) if (p.pFemale == null) unresolved++;
        assertEquals(1, unresolved);
    }

    @Test
    public void femaleProbabilityModes() {
        assertEquals(0.9, ClassifierOutput.singleProb(true).femaleProbability(new float[]{0.9f}), 1e-6);
        assertEquals(0.1, ClassifierOutput.singleProb(false).femaleProbability(new float[]{0.9f}), 1e-6);
        assertEquals(0.5, ClassifierOutput.singleLogit(true).femaleProbability(new float[]{0f}), 1e-9);
        double sm = ClassifierOutput.softmax(1).femaleProbability(new float[]{0f, 2f});
        assertTrue(sm > 0.88 && sm < 0.89);
        assertEquals(0.3, ClassifierOutput.softmax(0).femaleProbability(new float[]{0.3f, 0.7f}), 1e-6);   // احتمالات جاهزة
        try { ClassifierOutput.singleProb(true).femaleProbability(new float[0]); throw new AssertionError("كان يجب أن يرمي"); }
        catch (IllegalArgumentException expected) { /* ok */ }
        try { ClassifierOutput.singleProb(true).femaleProbability(new float[]{Float.NaN}); throw new AssertionError("كان يجب أن يرمي"); }
        catch (IllegalArgumentException expected) { /* ok */ }
    }

    @Test
    public void yunetDecodeAndPresetWiring() throws Exception {
        // وجه عند stride 32 الخلية (10,10) بمركز (336,336) وحجب 32 (bbox=[0.5,0.5,0,0]) على لوحة 640
        final Map<String, FloatTensor> yo = TestUtil.yunetOut(640, 640, 32, 10, 10, 1f, 1f, new float[]{0.5f, 0.5f, 0f, 0f});
        TestUtil.FakeSession yunet = new TestUtil.FakeSession("input", TestUtil.yunetNames(), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) { return yo; }
        });
        TestUtil.FakeSession gender = new TestUtil.FakeSession("images", Arrays.asList("probabilities"), new TestUtil.FakeSession.Fn() {
            @Override public Map<String, FloatTensor> run(Map<String, FloatTensor> f) { return one("probabilities", new float[]{0.9f, 0.1f}, 1, 2); }
        });
        OnnxAnalyzer a = YuNetGenderV1.create(yunet, gender);
        List<PersonDetection> r = a.analyze(TestUtil.solid(100, 100, 123, 117, 104));

        // YuNet: [1,3,640,640]، BGR بقيم خام، والحشو 114 (صورة 100×100 لا تُكبَّر وتوسَّط بحشو 270)
        FloatTensor yin = yunet.lastFeeds.get("input");
        assertEquals(4, yin.shape.length);
        assertEquals(640, yin.shape[2]);
        assertEquals(114f, yin.data[0], 0f);

        assertEquals(1, r.size());
        Box b = r.get(0).box;
        assertEquals(50, b.x, 1e-3);
        assertEquals(50, b.y, 1e-3);
        assertEquals(32, b.width, 1e-3);

        // المصنّف: [1,3,32,32] وقيم قريبة من الصفر لأن اللون = المتوسط تقريبًا
        FloatTensor gin = gender.lastFeeds.get("images");
        assertEquals(32, gin.shape[2]);
        for (float v : gin.data) assertTrue(Math.abs(v) < 0.002);
        assertEquals(0.9, r.get(0).pFemale, 1e-6);
    }

    @Test
    public void yunetMissingOutputsThrow() {
        try {
            Decoders.decodeYuNet(new HashMap<String, FloatTensor>(), 64, 64, 0.6, 0.3);
            throw new AssertionError("كان يجب أن يرمي");
        } catch (IllegalArgumentException expected) { /* ok */ }
    }

    @Test
    public void yunetSingleCellDecode() {
        Map<String, FloatTensor> o = TestUtil.yunetOut(64, 64, 16, 1, 2, 0.81f, 1f,
                new float[]{0.5f, 0.5f, (float) Math.log(2), (float) Math.log(2)});
        List<Candidate> c = Decoders.decodeYuNet(o, 64, 64, 0.6, 0.3);
        assertEquals(1, c.size());
        assertEquals(0.9, c.get(0).score, 1e-6);
        assertEquals(24, c.get(0).box.x, 1e-4);
        assertEquals(8, c.get(0).box.y, 1e-4);
        assertEquals(32, c.get(0).box.width, 1e-4);
    }

    @Test
    public void nmsKeepsSeparatedBoxes() {
        List<Candidate> l = new ArrayList<Candidate>();
        l.add(new Candidate(new Box(0, 0, 10, 10), 0.9));
        l.add(new Candidate(new Box(1, 0, 10, 10), 0.8));
        l.add(new Candidate(new Box(50, 50, 10, 10), 0.7));
        assertEquals(2, Decoders.nms(l, 0.3).size());
    }

    @Test
    public void lruCacheEvictsOldest() {
        LruCache<String> c = new LruCache<String>(2);
        c.put("a", "1"); c.put("b", "2");
        c.get("a");
        c.put("c", "3");
        assertEquals("1", c.get("a"));
        assertNull(c.get("b"));
    }
}
