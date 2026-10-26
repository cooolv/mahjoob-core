package dev.mahjoob.android;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import dev.mahjoob.core.FloatTensor;
import dev.mahjoob.core.ModelSession;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** ModelSession فوق ONNX Runtime (Android). */
public final class OrtModelSession implements ModelSession, AutoCloseable {
    private final OrtEnvironment env;
    private final OrtSession session;
    private final List<String> inputNames;
    private final List<String> outputNames;

    public OrtModelSession(byte[] modelBytes, int intraOpThreads) throws OrtException {
        this.env = OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        try {
            if (intraOpThreads > 0) opts.setIntraOpNumThreads(intraOpThreads);
            this.session = env.createSession(modelBytes, opts);
        } finally {
            opts.close();
        }
        this.inputNames = new ArrayList<String>(session.getInputNames());
        this.outputNames = new ArrayList<String>(session.getOutputNames());
    }

    @Override
    public List<String> inputNames() {
        return inputNames;
    }

    @Override
    public List<String> outputNames() {
        return outputNames;
    }

    @Override
    public Map<String, FloatTensor> run(Map<String, FloatTensor> feeds) throws Exception {
        Map<String, OnnxTensor> inputs = new HashMap<String, OnnxTensor>();
        try {
            for (Map.Entry<String, FloatTensor> e : feeds.entrySet()) {
                FloatTensor t = e.getValue();
                FloatBuffer fb = ByteBuffer.allocateDirect(t.data.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
                fb.put(t.data);
                fb.rewind();
                inputs.put(e.getKey(), OnnxTensor.createTensor(env, fb, t.shape));
            }
            Map<String, FloatTensor> out = new LinkedHashMap<String, FloatTensor>();
            OrtSession.Result result = session.run(inputs);
            try {
                for (Map.Entry<String, OnnxValue> e : result) {
                    OnnxValue v = e.getValue();
                    if (v instanceof OnnxTensor) {
                        OnnxTensor ot = (OnnxTensor) v;
                        FloatBuffer src = ot.getFloatBuffer().duplicate();
                        float[] arr = new float[src.remaining()];
                        src.get(arr);
                        out.put(e.getKey(), new FloatTensor(arr, ot.getInfo().getShape()));
                    }
                }
            } finally {
                result.close();
            }
            return out;
        } finally {
            for (OnnxTensor t : inputs.values()) t.close();
        }
    }

    @Override
    public void close() {
        try {
            session.close();
        } catch (OrtException ignored) {
            // لا شيء نفعله
        }
    }
}
