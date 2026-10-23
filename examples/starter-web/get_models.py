#!/usr/bin/env python3
"""ينزّل النموذجين إلى مجلد models بجانب هذا الملف (يحتاج إنترنت وpip).
YuNet: ترخيص MIT. gender-v1: CC0 (من حزمة age-and-gender). احتفظ بإشعارات التراخيص."""
import glob
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

out = Path(__file__).parent / "models"
out.mkdir(exist_ok=True)

print("YuNet ...")
urllib.request.urlretrieve(
    "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    out / "face_detection_yunet_2023mar.onnx")

print("gender-v1 ...")
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([sys.executable, "-m", "pip", "download", "age-and-gender==2.0.0", "--no-deps", "-d", tmp, "-q"], check=True)
    whl = glob.glob(tmp + "/*.whl")[0]
    (out / "gender-v1.onnx").write_bytes(zipfile.ZipFile(whl).read("age_and_gender/models/gender-v1.onnx"))
print("تم:", sorted(p.name for p in out.iterdir()))
