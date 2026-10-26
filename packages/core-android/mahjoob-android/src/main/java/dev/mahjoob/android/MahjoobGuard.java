package dev.mahjoob.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import ai.onnxruntime.OrtException;
import dev.mahjoob.core.Action;
import dev.mahjoob.core.Box;
import dev.mahjoob.core.Decision;
import dev.mahjoob.core.FrameSource;
import dev.mahjoob.core.ImageGuard;
import dev.mahjoob.core.OnnxAnalyzer;
import dev.mahjoob.core.Policy;
import dev.mahjoob.core.RawImage;
import dev.mahjoob.core.Reason;
import dev.mahjoob.core.TargetGender;
import dev.mahjoob.core.VideoGuard;
import dev.mahjoob.core.YuNetGenderV1;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * نقطة الدخول لمطوّري تطبيقات أندرويد: كاشف وجوه + مصنّف جنس يعملان على الجهاز.
 *
 * <pre>{@code
 * MahjoobGuard guard = MahjoobGuard.create(context, TargetGender.FEMALE);
 * // من خيط خلفي:
 * Decision d = guard.check(bitmap);
 * if (d.isBlocked()) { ... }
 * }</pre>
 *
 * النماذج لا تأتي مع المكتبة: ضعها في <code>assets/mahjoob/</code> (انظر README).
 * القاعدة المهمة: <b>أخفِ الصورة أولًا ثم اكشفها فقط إن سمح القرار</b>.
 */
public final class MahjoobGuard implements AutoCloseable {

    /** نداء يعود على خيط الواجهة الرئيسي. */
    public interface DecisionCallback {
        void onDecision(Decision decision);
    }

    private final ImageGuard imageGuard;
    private final OrtModelSession yunet;
    private final OrtModelSession gender;
    private final MahjoobOptions options;
    private final ExecutorService callers;
    private final Handler main;

    private MahjoobGuard(ImageGuard guard, OrtModelSession yunet, OrtModelSession gender, MahjoobOptions options) {
        this.imageGuard = guard;
        this.yunet = yunet;
        this.gender = gender;
        this.options = options;
        this.callers = Executors.newCachedThreadPool(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "mahjoob-caller");
                t.setDaemon(true);
                return t;
            }
        });
        this.main = new Handler(Looper.getMainLooper());
    }

    public static MahjoobGuard create(Context context, TargetGender target) {
        return create(context, new MahjoobOptions.Builder(target).build());
    }

    /** يحمّل النموذجين من assets ويبني الحارس. عملية بطيئة نسبيًا (حمّلها مرة واحدة، من خيط خلفي). */
    public static MahjoobGuard create(Context context, MahjoobOptions options) {
        int threads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
        OrtModelSession yunet = null;
        OrtModelSession gender = null;
        try {
            yunet = new OrtModelSession(readAsset(context, options.assetDir, YuNetGenderV1.YUNET_ASSET), threads);
            gender = new OrtModelSession(readAsset(context, options.assetDir, YuNetGenderV1.GENDER_ASSET), threads);
            YuNetGenderV1.Options o = new YuNetGenderV1.Options();
            o.cropMargin = options.cropMargin;
            o.maxPeople = options.maxPeople;
            o.faceScoreThreshold = options.faceScoreThreshold;
            OnnxAnalyzer analyzer = YuNetGenderV1.create(yunet, gender, o);
            Policy policy = new Policy.Builder(options.target).strict(options.strict)
                    .blockThreshold(options.blockThreshold).timeoutMs(options.timeoutMs).build();
            return new MahjoobGuard(new ImageGuard(analyzer, policy, options.cacheSize), yunet, gender, options);
        } catch (OrtException e) {
            closeQuietly(yunet);
            closeQuietly(gender);
            throw new MahjoobException("تعذّر تحميل نموذج ONNX: " + e.getMessage(), e);
        } catch (RuntimeException e) {
            closeQuietly(yunet);
            closeQuietly(gender);
            throw e;
        }
    }

    private static void closeQuietly(OrtModelSession s) {
        if (s != null) s.close();
    }

    private static byte[] readAsset(Context context, String dir, String name) {
        String path = dir + "/" + name;
        InputStream in = null;
        try {
            in = context.getAssets().open(path);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            throw new MahjoobException("النموذج غير موجود في assets: " + path
                    + ". انسخ النموذجين إلى مجلد assets/" + dir + " (انظر README).", e);
        } finally {
            if (in != null) {
                try { in.close(); } catch (IOException ignored) { /* لا شيء */ }
            }
        }
    }

    /** الحارس الأساسي (للاستخدام المتقدم). */
    public ImageGuard imageGuard() {
        return imageGuard;
    }

    /**
     * يفحص صورة. <b>تحجب الخيط المستدعي</b> حتى صدور القرار، فلا تستدعها من خيط الواجهة (يرمي IllegalStateException).
     * أي خطأ أو مهلة => حجب (في الوضع الصارم).
     */
    public Decision check(Bitmap bitmap) {
        return check(bitmap, null);
    }

    /** @param cacheKey مفتاح اختياري (مثل رابط الصورة) لتفادي إعادة التحليل */
    public Decision check(Bitmap bitmap, String cacheKey) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("لا تستدعِ MahjoobGuard.check من خيط الواجهة. استخدم checkAsync أو خيطًا خلفيًا.");
        }
        RawImage raw;
        try {
            raw = BitmapConverter.toRawImage(bitmap, options.maxSide);
        } catch (RuntimeException e) {
            return new Decision(options.strict ? Action.BLOCK : Action.ALLOW, Reason.ANALYSIS_ERROR, Collections.<Box>emptyList());
        }
        return imageGuard.check(raw, cacheKey);
    }

    /** يفحص في الخلفية ويعيد النتيجة على خيط الواجهة. */
    public void checkAsync(final Bitmap bitmap, final DecisionCallback callback) {
        checkAsync(bitmap, null, callback);
    }

    public void checkAsync(final Bitmap bitmap, final String cacheKey, final DecisionCallback callback) {
        callers.execute(new Runnable() {
            @Override
            public void run() {
                final Decision d = check(bitmap, cacheKey);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        callback.onDecision(d);
                    }
                });
            }
        });
    }

    /**
     * حارس فيديو يستخدم نفس النماذج. نادِ tick(...) من خيط خلفي كل 300–500ms أثناء التشغيل،
     * وغطِّ الفيديو حتى يصبح state() = CLEAR.
     */
    public VideoGuard newVideoGuard(FrameSource source, VideoGuard.Listener listener) {
        return new VideoGuard(imageGuard, source, 2, 1500, listener);
    }

    @Override
    public void close() {
        imageGuard.close();
        callers.shutdownNow();
        yunet.close();
        gender.close();
    }
}
