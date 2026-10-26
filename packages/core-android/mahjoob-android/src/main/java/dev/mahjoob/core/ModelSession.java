package dev.mahjoob.core;

import java.util.List;
import java.util.Map;

/**
 * جلسة نموذج مجرّدة. في أندرويد تُنفَّذ بـOrtModelSession (ONNX Runtime). النواة لا تعتمد على أي مكتبة نماذج،
 * فيمكن اختبارها على JVM بجلسات وهمية.
 */
public interface ModelSession {
    List<String> inputNames();

    List<String> outputNames();

    Map<String, FloatTensor> run(Map<String, FloatTensor> feeds) throws Exception;
}
