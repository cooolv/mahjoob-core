package dev.mahjoob.android;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import dev.mahjoob.core.FrameSource;
import dev.mahjoob.core.RawImage;
import java.util.function.LongSupplier;

/**
 * مصدر إطارات من ملف فيديو عبر MediaMetadataRetriever (مناسب لمصغّرات الفيديو والفحص عند مواضع محددة).
 * مرّر دالة تعيد الموضع الحالي بالميكروثانية. نادِ captureFrame من خيط خلفي.
 */
public final class MediaMetadataFrameSource implements FrameSource {
    private final MediaMetadataRetriever retriever;
    private final LongSupplier positionUs;
    private final int maxSide;

    public MediaMetadataFrameSource(MediaMetadataRetriever retriever, LongSupplier positionUs, int maxSide) {
        this.retriever = retriever;
        this.positionUs = positionUs;
        this.maxSide = maxSide;
    }

    @Override
    public RawImage captureFrame() {
        Bitmap b = retriever.getFrameAtTime(positionUs.getAsLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        if (b == null) return null;
        try {
            return BitmapConverter.toRawImage(b, maxSide);
        } finally {
            b.recycle();
        }
    }
}
