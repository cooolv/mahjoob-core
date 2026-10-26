package dev.mahjoob.core;

/** مصدر إطارات للفيديو (مثلًا TextureView أو MediaMetadataRetriever). */
public interface FrameSource {
    /** يلتقط الإطار الحالي، أو يعيد null إن لم يتوفر إطار. */
    RawImage captureFrame() throws Exception;
}
