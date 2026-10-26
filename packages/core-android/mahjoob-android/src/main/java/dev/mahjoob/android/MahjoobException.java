package dev.mahjoob.android;

/** خطأ في إعداد المكتبة (مثل نموذج مفقود). استثناء غير مفحوص ليسهل استخدامه من Kotlin. */
public class MahjoobException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public MahjoobException(String message) {
        super(message);
    }

    public MahjoobException(String message, Throwable cause) {
        super(message, cause);
    }
}
