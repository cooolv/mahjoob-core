package dev.mahjoob.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class ImageGuardTest {
    private static final RawImage IMG = TestUtil.solid(2, 2, 1, 2, 3);

    private static PersonAnalyzer returning(final List<PersonDetection> dets, final AtomicInteger calls) {
        return new PersonAnalyzer() {
            @Override
            public List<PersonDetection> analyze(RawImage image) {
                calls.incrementAndGet();
                return dets;
            }
        };
    }

    @Test
    public void analyzerErrorBlocks() {
        ImageGuard g = new ImageGuard(new PersonAnalyzer() {
            @Override public List<PersonDetection> analyze(RawImage i) throws Exception { throw new Exception("boom"); }
        }, Policy.defaults(TargetGender.FEMALE));
        try {
            Decision d = g.check(IMG);
            assertEquals(Action.BLOCK, d.action);
            assertEquals(Reason.ANALYSIS_ERROR, d.reason);
        } finally { g.close(); }
    }

    @Test
    public void timeoutBlocks() {
        ImageGuard g = new ImageGuard(new PersonAnalyzer() {
            @Override public List<PersonDetection> analyze(RawImage i) throws Exception { Thread.sleep(5000); return new ArrayList<PersonDetection>(); }
        }, new Policy.Builder(TargetGender.FEMALE).timeoutMs(50).build());
        try {
            long t0 = System.currentTimeMillis();
            Decision d = g.check(IMG);
            assertEquals(Reason.TIMEOUT, d.reason);
            assertEquals(Action.BLOCK, d.action);
            assertTrue("لم تُحترم المهلة", System.currentTimeMillis() - t0 < 2000);
        } finally { g.close(); }
    }

    @Test
    public void errorAllowedOnlyWhenNotStrict() {
        ImageGuard g = new ImageGuard(new PersonAnalyzer() {
            @Override public List<PersonDetection> analyze(RawImage i) throws Exception { throw new Exception("x"); }
        }, new Policy.Builder(TargetGender.FEMALE).strict(false).build());
        try { assertEquals(Action.ALLOW, g.check(IMG).action); } finally { g.close(); }
    }

    @Test
    public void cachePreventsReanalysis() {
        AtomicInteger calls = new AtomicInteger();
        List<PersonDetection> dets = new ArrayList<PersonDetection>();
        dets.add(TestUtil.det(0.01, 0.9, 0.9));
        ImageGuard g = new ImageGuard(returning(dets, calls), Policy.defaults(TargetGender.FEMALE));
        try {
            g.check(IMG, "k1");
            g.check(IMG, "k1");
            assertEquals(1, calls.get());
        } finally { g.close(); }
    }

    @Test
    public void errorsAreNotCached() {
        final AtomicInteger n = new AtomicInteger();
        ImageGuard g = new ImageGuard(new PersonAnalyzer() {
            @Override public List<PersonDetection> analyze(RawImage i) throws Exception { n.incrementAndGet(); throw new Exception("x"); }
        }, Policy.defaults(TargetGender.FEMALE));
        try {
            g.check(IMG, "k");
            g.check(IMG, "k");
            assertEquals(2, n.get());
        } finally { g.close(); }
    }

    @Test
    public void callsNeverOverlapEvenFromManyThreads() throws Exception {
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger maxActive = new AtomicInteger();
        final ImageGuard g = new ImageGuard(new PersonAnalyzer() {
            @Override public List<PersonDetection> analyze(RawImage i) throws Exception {
                int a = active.incrementAndGet();
                maxActive.set(Math.max(maxActive.get(), a));
                Thread.sleep(10);
                active.decrementAndGet();
                return new ArrayList<PersonDetection>();
            }
        }, new Policy.Builder(TargetGender.FEMALE).timeoutMs(10000).build());
        try {
            List<Thread> ts = new ArrayList<Thread>();
            for (int i = 0; i < 6; i++) {
                Thread t = new Thread(new Runnable() { @Override public void run() { g.check(IMG); } });
                ts.add(t);
                t.start();
            }
            for (Thread t : ts) t.join();
            assertEquals(1, maxActive.get());
        } finally { g.close(); }
    }

    @Test
    public void closedGuardFailsClosed() {
        ImageGuard g = new ImageGuard(returning(new ArrayList<PersonDetection>(), new AtomicInteger()), Policy.defaults(TargetGender.FEMALE));
        g.close();
        Decision d = g.check(IMG);
        assertEquals(Action.BLOCK, d.action);
    }
}
