package dev.mahjoob.core;

import java.util.Collections;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.List;

/**
 * الواجهة الرئيسية للصور والمصغّرات.
 * أي خطأ أو مهلة => حجب (Fail-Closed) في الوضع الصارم.
 * استدعاءات المحلّل تُنفَّذ واحدًا بعد الآخر على خيط خلفي واحد، فالاستدعاء من أي خيط آمن.
 * <b>check() تحجب الخيط المستدعي</b> حتى صدور القرار، فلا تستدعها من خيط الواجهة (UI).
 */
public final class ImageGuard implements AutoCloseable {
    private final PersonAnalyzer analyzer;
    private final Policy policy;
    private final LruCache<Decision> cache;
    private final ExecutorService executor;

    public ImageGuard(PersonAnalyzer analyzer, Policy policy) {
        this(analyzer, policy, 500);
    }

    public ImageGuard(PersonAnalyzer analyzer, Policy policy, int cacheSize) {
        if (analyzer == null || policy == null) throw new IllegalArgumentException("analyzer وpolicy مطلوبان");
        this.analyzer = analyzer;
        this.policy = policy;
        this.cache = new LruCache<Decision>(Math.max(1, cacheSize));
        this.executor = Executors.newSingleThreadExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "mahjoob-analyzer");
                t.setDaemon(true);
                return t;
            }
        });
    }

    public Policy policy() {
        return policy;
    }

    public Decision check(RawImage image) {
        return check(image, null);
    }

    /** @param cacheKey مفتاح اختياري (مثل رابط الصورة) لتفادي إعادة التحليل */
    public Decision check(RawImage image, String cacheKey) {
        if (cacheKey != null) {
            synchronized (cache) {
                Decision hit = cache.get(cacheKey);
                if (hit != null) return hit;
            }
        }
        Decision d = run(image);
        boolean transientFailure = d.reason == Reason.ANALYSIS_ERROR || d.reason == Reason.TIMEOUT;
        if (cacheKey != null && !transientFailure) {
            synchronized (cache) {
                cache.put(cacheKey, d);
            }
        }
        return d;
    }

    private Decision run(final RawImage image) {
        Future<List<PersonDetection>> f;
        try {
            f = executor.submit(new Callable<List<PersonDetection>>() {
                @Override
                public List<PersonDetection> call() throws Exception {
                    return analyzer.analyze(image);
                }
            });
        } catch (RuntimeException e) {          // المنفّذ أُغلق
            return failure(Reason.ANALYSIS_ERROR);
        }
        try {
            List<PersonDetection> dets = f.get(policy.timeoutMs, TimeUnit.MILLISECONDS);
            return PolicyEngine.decide(dets, policy);
        } catch (TimeoutException e) {
            f.cancel(true);
            return failure(Reason.TIMEOUT);
        } catch (InterruptedException e) {
            f.cancel(true);
            Thread.currentThread().interrupt();
            return failure(Reason.ANALYSIS_ERROR);
        } catch (ExecutionException e) {
            return failure(Reason.ANALYSIS_ERROR);
        } catch (RuntimeException e) {
            return failure(Reason.ANALYSIS_ERROR);
        }
    }

    private Decision failure(Reason reason) {
        return new Decision(policy.strict ? Action.BLOCK : Action.ALLOW, reason, Collections.<Box>emptyList());
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }
}
