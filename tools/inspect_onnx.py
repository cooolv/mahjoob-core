#!/usr/bin/env python3
"""
يعرض مدخلات ومخرجات أي نموذج ONNX (الأسماء والأبعاد)، ليُكتب إعداد المحوّل بدقة.

الاستخدام:
    pip install onnxruntime
    python inspect_onnx.py model.onnx
    python inspect_onnx.py some_package.whl      # يستخرج ملفات .onnx من الحزمة ثم يفحصها
"""
import sys
import zipfile
from pathlib import Path


def extract_onnx(archive: Path, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    found = []
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.lower().endswith(".onnx"):
                target = out / Path(name).name
                target.write_bytes(z.read(name))
                found.append(target)
    return found


def describe(path: Path) -> str:
    import onnxruntime as ort  # noqa: PLC0415

    lines = [f"=== {path.name} ({path.stat().st_size / 1e6:.1f} MB) ==="]
    try:
        s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    except Exception as e:  # noqa: BLE001
        return "\n".join(lines + [f"  تعذّر فتح النموذج: {e}"])
    for i in s.get_inputs():
        lines.append(f"  مدخل : {i.name}  الشكل={i.shape}  النوع={i.type}")
    for o in s.get_outputs():
        lines.append(f"  مخرج : {o.name}  الشكل={o.shape}  النوع={o.type}")
    return "\n".join(lines)


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    p = Path(argv[1])
    if not p.is_file():
        print(f"الملف غير موجود: {p}")
        return 2
    if p.suffix.lower() in (".whl", ".zip"):
        files = extract_onnx(p, Path("onnx_models"))
        if not files:
            print("لم أجد ملفات .onnx داخل الأرشيف")
            return 1
        print(f"استُخرجت {len(files)} ملف(ات) إلى مجلد onnx_models")
    else:
        files = [p]
    for f in files:
        print(describe(f))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
