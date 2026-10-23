#!/usr/bin/env bash
# ينزّل النماذج ومكتبة onnxruntime-web إلى extension/.assets (يحتاج إنترنت، وpython3 وnpm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
A="$ROOT/extension/.assets"
ORT_VERSION="${ORT_VERSION:-1.20.1}"
mkdir -p "$A/models" "$A/ort" "$A/wheels"

echo "- YuNet (MIT)"
curl -fL --retry 3 -o "$A/models/face_detection_yunet_2023mar.onnx" \
  https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx

echo "- gender-v1 (CC0) من حزمة age-and-gender"
pip download age-and-gender==2.0.0 --no-deps -d "$A/wheels" -q
python3 - "$A" <<'PY'
import glob, sys, zipfile
a = sys.argv[1]
z = zipfile.ZipFile(glob.glob(a + "/wheels/*.whl")[0])
open(a + "/models/gender-v1.onnx", "wb").write(z.read("age_and_gender/models/gender-v1.onnx"))
PY

echo "- onnxruntime-web $ORT_VERSION (MIT)"
npm install --prefix "$A/npm" "onnxruntime-web@$ORT_VERSION" --no-audit --no-fund --silent
D="$A/npm/node_modules/onnxruntime-web/dist"
if [ -f "$D/ort.wasm.min.js" ]; then
  cp "$D/ort.wasm.min.js" "$A/ort/ort.min.js"
  cp "$D"/ort-wasm-simd-threaded.wasm "$D"/ort-wasm-simd-threaded.mjs "$A/ort/"
else
  echo "تنبيه: ort.wasm.min.js غير موجود، نستخدم ort.min.js" >&2
  cp "$D/ort.min.js" "$A/ort/ort.min.js"
  cp "$D"/ort-wasm-simd-threaded*.wasm "$D"/ort-wasm-simd-threaded*.mjs "$A/ort/"
fi
ls -l "$A/models" "$A/ort"
