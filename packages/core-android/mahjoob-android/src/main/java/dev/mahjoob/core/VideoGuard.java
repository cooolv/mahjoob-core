package dev.mahjoob.core;

import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * آلة حالة للفيديو. تبدأ مغطّاة (COVERED) ولا ترفع التغطية إلا بعد عدد من الإطارات الآمنة المتتالية
 * ومرور مدة التثبيت. الجدولة (كل كم مللي ثانية نستدعي tick) مسؤولية المستخدم، ويجب أن تتم على خيط خلفي
 * لأن tick تحجب حتى صدور القرار. reset() آمنة من أي خيط.
 */
public final class VideoGuard {
    public interface Listener {
        void onStateChanged(VideoState state, Decision last);
    }

    private final ImageGuard guard;
    private final FrameSource source;
    private final int clearAfter;
    private final long holdMs;
    private final Listener listener;

    private volatile VideoState state = VideoState.COVERED;
    private int clean = 0;
    private long lastBlockAt = Long.MIN_VALUE;
    private final AtomicInteger epoch = new AtomicInteger();

    public VideoGuard(ImageGuard guard, FrameSource source) {
        this(guard, source, 2, 1500, null);
    }

    public VideoGuard(ImageGuard guard, FrameSource source, int clearAfter, long holdMs, Listener listener) {
        this.guard = guard;
        this.source = source;
        this.clearAfter = clearAfter;
        this.holdMs = holdMs;
        this.listener = listener;
    }

    public VideoState state() {
        return state;
    }

    /** @param nowMs ساعة رتيبة بالمللي ثانية (مثل SystemClock.elapsedRealtime) */
    public VideoState tick(long nowMs) {
        final int myEpoch = epoch.get();
        Decision decision;
        try {
            RawImage frame = source.captureFrame();
            decision = frame == null
                    ? new Decision(Action.BLOCK, Reason.ANALYSIS_ERROR, Collections.<Box>emptyList())
                    : guard.check(frame);
        } catch (Exception e) {
            decision = new Decision(Action.BLOCK, Reason.ANALYSIS_ERROR, Collections.<Box>emptyList());
        }
        synchronized (this) {
            if (epoch.get() != myEpoch) return state;   // حدث reset أثناء الفحص: نتجاهل هذه النتيجة
            if (decision.action == Action.BLOCK) {
                clean = 0;
                lastBlockAt = nowMs;
                set(VideoState.COVERED, decision);
            } else {
                clean++;
                boolean held = lastBlockAt != Long.MIN_VALUE && nowMs - lastBlockAt < holdMs;
                if (clean >= clearAfter && !held) set(VideoState.CLEAR, decision);
            }
            return state;
        }
    }

    /** عند التنقّل/السحب في الفيديو: غطِّ فورًا وأعد العدّ. */
    public synchronized void reset() {
        epoch.incrementAndGet();
        clean = 0;
        state = VideoState.COVERED;
    }

    private void set(VideoState next, Decision d) {
        if (state != next) {
            state = next;
            if (listener != null) listener.onStateChanged(next, d);
        }
    }
}
