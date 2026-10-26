package dev.mahjoob.android;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.TextureView;
import dev.mahjoob.core.FrameSource;
import dev.mahjoob.core.RawImage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * مصدر إطارات من TextureView (مثل مشغّل فيديو يرسم عليه). يلتقط الإطار على خيط الواجهة،
 * ويحوّله في الخيط المستدعي. نادِ captureFrame من خيط خلفي (وإلا يحدث تجمّد).
 * ملاحظة: SurfaceView لا يدعم getBitmap؛ استخدم TextureView أو PixelCopy بنفسك.
 */
public final class TextureViewFrameSource implements FrameSource {
    private final TextureView view;
    private final int maxSide;
    private final Handler main = new Handler(Looper.getMainLooper());

    public TextureViewFrameSource(TextureView view, int maxSide) {
        this.view = view;
        this.maxSide = maxSide;
    }

    @Override
    public RawImage captureFrame() throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("captureFrame لا تُستدعى من خيط الواجهة");
        }
        final AtomicReference<Bitmap> ref = new AtomicReference<Bitmap>();
        final CountDownLatch latch = new CountDownLatch(1);
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    ref.set(view.isAvailable() ? view.getBitmap() : null);
                } finally {
                    latch.countDown();
                }
            }
        });
        if (!latch.await(2, TimeUnit.SECONDS)) return null;
        Bitmap b = ref.get();
        if (b == null) return null;
        try {
            return BitmapConverter.toRawImage(b, maxSide);
        } finally {
            b.recycle();
        }
    }
}
