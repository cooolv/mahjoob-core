package dev.mahjoob.core;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class VideoGuardTest {
    /** إطارات وهمية: الكلمة "safe" = ذكر، و"target" = أنثى، و"none" = لا أشخاص، وnull = لا إطار. */
    private static VideoGuard make(final String[] frames) {
        final int[] i = {0};
        // نمرّر الإطار عبر لون البكسل الأول: 255 = target، 0 = safe، 128 = none
        PersonAnalyzer analyzer = new PersonAnalyzer() {
            @Override
            public List<PersonDetection> analyze(RawImage img) {
                int v = img.data[0] & 0xFF;
                List<PersonDetection> l = new ArrayList<PersonDetection>();
                if (v == 255) l.add(TestUtil.det(0.95, 0.9, 0.9));
                else if (v == 0) l.add(TestUtil.det(0.01, 0.9, 0.9));
                return l;
            }
        };
        ImageGuard guard = new ImageGuard(analyzer, new Policy.Builder(TargetGender.FEMALE).timeoutMs(5000).build());
        FrameSource src = new FrameSource() {
            @Override
            public RawImage captureFrame() {
                String f = i[0] < frames.length ? frames[i[0]] : null;
                i[0]++;
                if (f == null) return null;
                return TestUtil.solid(2, 2, "target".equals(f) ? 255 : ("safe".equals(f) ? 0 : 128), 0, 0);
            }
        };
        return new VideoGuard(guard, src, 2, 1000, null);
    }

    @Test
    public void startsCovered() {
        assertEquals(VideoState.COVERED, make(new String[0]).state());
    }

    @Test
    public void clearsOnlyAfterTwoSafeFrames() {
        VideoGuard v = make(new String[]{"safe", "safe"});
        assertEquals(VideoState.COVERED, v.tick(0));
        assertEquals(VideoState.CLEAR, v.tick(500));
    }

    @Test
    public void targetFrameCoversImmediatelyAndResetsCount() {
        VideoGuard v = make(new String[]{"safe", "safe", "target", "safe", "safe"});
        v.tick(0);
        v.tick(500);
        assertEquals(VideoState.CLEAR, v.state());
        assertEquals(VideoState.COVERED, v.tick(1000));
        assertEquals(VideoState.COVERED, v.tick(1500));
        assertEquals(VideoState.CLEAR, v.tick(2100));
    }

    @Test
    public void holdTimePreventsEarlyClear() {
        VideoGuard v = make(new String[]{"target", "safe", "safe", "safe"});
        v.tick(1000);
        v.tick(1200);
        assertEquals(VideoState.COVERED, v.tick(1400));
        assertEquals(VideoState.CLEAR, v.tick(2100));
    }

    @Test
    public void missingFrameCovers() {
        VideoGuard v = make(new String[]{"safe", "safe", null});
        v.tick(0);
        v.tick(500);
        assertEquals(VideoState.COVERED, v.tick(1000));
    }

    @Test
    public void resetCoversImmediately() {
        VideoGuard v = make(new String[]{"safe", "safe"});
        v.tick(0);
        v.tick(500);
        v.reset();
        assertEquals(VideoState.COVERED, v.state());
    }
}
