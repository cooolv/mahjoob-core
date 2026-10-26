package com.example.myapp;

import android.content.Context;
import android.graphics.Bitmap;
import dev.mahjoob.android.MahjoobGuard;
import dev.mahjoob.android.MahjoobOptions;
import dev.mahjoob.core.Decision;
import dev.mahjoob.core.FrameSource;
import dev.mahjoob.core.TargetGender;
import dev.mahjoob.core.VideoGuard;
import dev.mahjoob.core.VideoState;

/**
 * مثال استخدام مكتبة mahjoob-android (Java). نفس الواجهة تعمل من Kotlin.
 * المبادئ: (1) أخفِ الصورة أولًا (2) افحص في خيط خلفي (3) اكشفها فقط إن سمح القرار (4) الخطأ = حجب.
 */
public class UsageExample {
    private MahjoobGuard guard;

    /** استدعِها مرة واحدة من خيط خلفي (تحميل النماذج بطيء نسبيًا). */
    public void init(Context context) {
        guard = MahjoobGuard.create(context, new MahjoobOptions.Builder(TargetGender.FEMALE)
                .blockThreshold(0.2)   // الافتراضي
                .strict(true)          // الافتراضي، ولا تعطّله إلا لسبب واضح
                .build());
    }

    /** من خيط خلفي: يحجب الخيط حتى صدور القرار. */
    public boolean isSafeToShow(Bitmap bitmap) {
        Decision d = guard.check(bitmap);
        return !d.isBlocked();
    }

    /** من خيط الواجهة: النتيجة تعود على خيط الواجهة. */
    public void show(Bitmap bitmap, final android.view.View imageView) {
        imageView.setVisibility(android.view.View.INVISIBLE);          // مخفية حتى يصدر القرار
        guard.checkAsync(bitmap, new MahjoobGuard.DecisionCallback() {
            @Override
            public void onDecision(Decision decision) {
                if (!decision.isBlocked()) imageView.setVisibility(android.view.View.VISIBLE);
                // وإلا تبقى مخفية (أو اعرض بديلًا رماديًا)
            }
        });
    }

    /** فيديو: نادِ tick من خيط خلفي كل 300–500ms، وغطِّ الفيديو ما دامت الحالة COVERED. */
    public VideoGuard videoGuard(FrameSource frames) {
        return guard.newVideoGuard(frames, new VideoGuard.Listener() {
            @Override
            public void onStateChanged(VideoState state, Decision last) {
                // حدّث الواجهة (انتبه: هذا النداء يأتي من خيط tick، فانتقل لخيط الواجهة قبل لمس الـViews)
            }
        });
    }

    public void release() {
        if (guard != null) guard.close();
    }
}
