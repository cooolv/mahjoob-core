#!/usr/bin/env bash
# يجمع الإضافة الجاهزة للتحميل في extension/dist
# المتغيرات (اختيارية): MODELS_DIR, ORT_DIR, CORE_DIST
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/extension/dist"
MODELS_DIR="${MODELS_DIR:-$ROOT/extension/.assets/models}"
ORT_DIR="${ORT_DIR:-$ROOT/extension/.assets/ort}"
CORE_DIST="${CORE_DIST:-$ROOT/packages/core-js/dist}"

need() {
  if [ ! -f "$1" ]; then
    echo "ملف مفقود: $1" >&2
    ls -la "$(dirname "$1")" >&2 || true
    exit 1
  fi
}
need "$MODELS_DIR/face_detection_yunet_2023mar.onnx"
need "$MODELS_DIR/gender-v1.onnx"
need "$ORT_DIR/ort.min.js"
need "$CORE_DIST/index.js"

rm -rf "$OUT"
mkdir -p "$OUT/core" "$OUT/models" "$OUT/vendor"
cp -r "$ROOT/extension/src/." "$OUT/"
cp "$ROOT/extension/manifest.json" "$OUT/"
cp -r "$ROOT/extension/icons" "$OUT/"
cp -r "$CORE_DIST/." "$OUT/core/"
find "$OUT/core" -name "*.d.ts" -delete
cp "$MODELS_DIR/face_detection_yunet_2023mar.onnx" "$MODELS_DIR/gender-v1.onnx" "$OUT/models/"
cp "$ORT_DIR/ort.min.js" "$OUT/vendor/"
for f in "$ORT_DIR"/*.wasm "$ORT_DIR"/*.mjs; do
  if [ -f "$f" ]; then cp "$f" "$OUT/vendor/"; fi
done

echo "تم: $OUT"
du -sh "$OUT" | cut -f1 | sed 's/^/الحجم: /'
