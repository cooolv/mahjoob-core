#!/usr/bin/env python3
"""
يقيس خط المعالجة الكامل: كاشف الوجوه YuNet ثم نموذج الجنس gender-v1، على صور manifest.json،
بعدة قيم لهامش الاقتطاع حول الوجه، ليُختار الهامش الأنسب للمشروع.

يطابق منطق مكتبة @mahjoob/core (نفس Letterbox وفك YuNet والاقتطاع والتجهيز).

التجهيز: pip install onnxruntime pillow numpy
التشغيل:
    python eval_pipeline.py --yunet face_detection_yunet_2023mar.onnx --gender onnx_models\\gender-v1.onnx --manifest data\\manifest.json

ملاحظات صادقة:
  - لكل صورة يُصنَّف أكبر وجه فقط (صور FairFace فيها وجه واحد).
  - الصورة التي لا يُكتشف فيها وجه تُحسب "مسموحة" (كما يفعل المشروع)، فتدخل في التسرّب إن كانت أنثى.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MEANS = np.array([122.781998, 117.000999, 104.297997], dtype=np.float32)
GENDER_SIZE = 32
STRIDES = (8, 16, 32)


def js_round(x):
    return int(math.floor(x + 0.5))  # مثل Math.round في جافاسكربت


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 1.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def resize_region(src, rx, ry, rw, rh, dw, dh):
    """اقتطاع منطقة وتغيير حجمها بالاستيفاء الخطي مع تثبيت الحواف (نفس resizeRegion في المكتبة)."""
    h, w = src.shape[:2]
    xs = rx + (np.arange(dw) + 0.5) * (rw / dw) - 0.5
    ys = ry + (np.arange(dh) + 0.5) * (rh / dh) - 0.5
    x0f, y0f = np.floor(xs), np.floor(ys)
    fx = (xs - x0f)[None, :, None]
    fy = (ys - y0f)[:, None, None]
    x0 = np.clip(x0f, 0, w - 1).astype(int)
    x1 = np.clip(x0f + 1, 0, w - 1).astype(int)
    y0 = np.clip(y0f, 0, h - 1).astype(int)
    y1 = np.clip(y0f + 1, 0, h - 1).astype(int)
    a = src.astype(np.float64)
    p00, p10 = a[y0][:, x0], a[y0][:, x1]
    p01, p11 = a[y1][:, x0], a[y1][:, x1]
    top = p00 + (p10 - p00) * fx
    bot = p01 + (p11 - p01) * fx
    return np.clip(np.rint(top + (bot - top) * fy), 0, 255).astype(np.uint8)


def letterbox(arr, tw, th, pad=114, allow_upscale=False):
    h, w = arr.shape[:2]
    scale = min(tw / w, th / h)
    if not allow_upscale:
        scale = min(1.0, scale)
    nw, nh = max(1, js_round(w * scale)), max(1, js_round(h * scale))
    pad_x, pad_y = (tw - nw) // 2, (th - nh) // 2
    resized = resize_region(arr, 0, 0, w, h, nw, nh)
    out = np.full((th, tw, 3), pad, dtype=np.uint8)
    out[pad_y:pad_y + nh, pad_x:pad_x + nw] = resized
    return out, scale, pad_x, pad_y


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return 0.0 if union <= 0 else inter / union


def nms(cands, thr):
    kept = []
    for c in sorted(cands, key=lambda c: -c[1]):
        if all(iou(k[0], c[0]) < thr for k in kept):
            kept.append(c)
    return kept


def decode_yunet(outs, width, height, score_thr=0.6, iou_thr=0.3):
    """فك YuNet كما في OpenCV FaceDetectorYN. outs: قاموس اسم -> مصفوفة مسطّحة. يعيد [(x,y,w,h), score]."""
    res = []
    for s in STRIDES:
        try:
            cls, obj, bbox = (np.asarray(outs[f"{k}_{s}"], dtype=np.float64).reshape(-1) for k in ("cls", "obj", "bbox"))
        except KeyError as e:
            raise SystemExit(f"مخرجات YuNet ناقصة ({e}). المتاح: {sorted(outs)}")
        cols, rows = width // s, height // s
        n = cols * rows
        if cls.size < n or obj.size < n or bbox.size < n * 4:
            raise SystemExit(f"أبعاد مخرجات YuNet لا تطابق مدخل {width}x{height} عند stride {s}")
        score = np.sqrt(np.clip(cls[:n], 0, 1) * np.clip(obj[:n], 0, 1))
        for i in np.nonzero(score >= score_thr)[0]:
            r, c = divmod(int(i), cols)
            cx = (c + bbox[i * 4]) * s
            cy = (r + bbox[i * 4 + 1]) * s
            w, h = math.exp(bbox[i * 4 + 2]) * s, math.exp(bbox[i * 4 + 3]) * s
            if w > 0 and h > 0 and math.isfinite(w) and math.isfinite(h):
                res.append(((cx - w / 2, cy - h / 2, w, h), float(score[i])))
    return nms(res, iou_thr)


def detect_faces(session, arr):
    shp = session.get_inputs()[0].shape
    th = shp[2] if isinstance(shp[2], int) else 640
    tw = shp[3] if isinstance(shp[3], int) else 640
    lb, scale, px, py = letterbox(arr, tw, th)
    x = lb[:, :, ::-1].astype(np.float32).transpose(2, 0, 1)[None]  # BGR، قيم 0..255
    names = [o.name for o in session.get_outputs()]
    vals = session.run(None, {session.get_inputs()[0].name: np.ascontiguousarray(x)})
    cands = decode_yunet(dict(zip(names, vals)), tw, th)
    h, w = arr.shape[:2]
    faces = []
    for (bx, by, bw, bh), sc in cands:
        x1 = min(w, max(0.0, (bx - px) / scale)); y1 = min(h, max(0.0, (by - py) / scale))
        x2 = min(w, max(0.0, (bx + bw - px) / scale)); y2 = min(h, max(0.0, (by + bh - py) / scale))
        if x2 - x1 > 0 and y2 - y1 > 0:
            faces.append(((x1, y1, x2 - x1, y2 - y1), sc))
    return faces


def gender_chip(arr, box, margin):
    x, y, w, h = box
    side = max(w, h) * (1 + margin)
    cx, cy = x + w / 2, y + h / 2
    return resize_region(arr, cx - side / 2, cy - side / 2, side, side, GENDER_SIZE, GENDER_SIZE)


def female_prob(session, chips, batch=64):
    name = session.get_inputs()[0].name
    out = []
    for i in range(0, len(chips), batch):
        x = np.stack(chips[i:i + batch]).astype(np.float32)
        x -= MEANS
        x /= np.float32(256.0)
        p = session.run(None, {name: np.ascontiguousarray(x.transpose(0, 3, 1, 2))})[0]
        out.append(p[:, 0])  # labels: ["female","male"]
    return np.concatenate(out) if out else np.array([])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--yunet", required=True)
    ap.add_argument("--gender", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--margins", default="0,0.2,0.4,0.6,0.8")
    ap.add_argument("--out", default="pipeline_eval.md")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args(argv)

    import onnxruntime as ort  # noqa: PLC0415

    mp = Path(a.manifest)
    m = json.loads(mp.read_text(encoding="utf-8"))
    entries = [e for e in m["entries"] if e["gender"] in ("female", "male")]
    if a.limit:
        entries = entries[: a.limit]
    det = ort.InferenceSession(a.yunet, providers=["CPUExecutionProvider"])
    gen = ort.InferenceSession(a.gender, providers=["CPUExecutionProvider"])

    items = []  # (is_female, arr, face_box or None)
    bad = 0
    for i, e in enumerate(entries):
        try:
            arr = np.asarray(Image.open(mp.parent / e["path"]).convert("RGB"), dtype=np.uint8)
        except Exception:  # noqa: BLE001
            bad += 1
            continue
        faces = detect_faces(det, arr)
        box = max(faces, key=lambda f: f[0][2] * f[0][3])[0] if faces else None
        items.append((e["gender"] == "female", arr, box))
        if (i + 1) % 25 == 0:
            print(f"\r{i + 1}/{len(entries)}", end="", file=sys.stderr)
    print(file=sys.stderr)
    if not items:
        raise SystemExit("لم أستطع فتح أي صورة")

    is_f = np.array([x[0] for x in items])
    has = np.array([x[2] is not None for x in items])
    nf, nm = int(is_f.sum()), int((~is_f).sum())
    print(f"صور: {len(items)} (إناث {nf}، ذكور {nm}) | تعذّر فتح {bad} | اكتُشف وجه في {int(has.sum())} ({has.mean() * 100:.1f}%)")
    print(f"إناث بلا وجه مكتشف (ستمرّ): {int((is_f & ~has).sum())}")

    lines = [
        "# تقييم الخط الكامل: YuNet + gender-v1", "",
        f"- الصور: {len(items)} (إناث {nf}، ذكور {nm}). المصدر: {m.get('source', '')}",
        f"- اكتُشف وجه في {has.mean() * 100:.1f}% من الصور. الصورة بلا وجه مكتشف تُحسب مسموحة (تسرّب إن كانت أنثى).",
        "- يُصنَّف أكبر وجه في الصورة فقط. الهدف: حجب الإناث. الأرقام على وجوه FairFace فقط.", "",
        "| هامش الاقتطاع | تسرّب@0.2 (CI 95%) | حجب زائد@0.2 (CI 95%) | تسرّب@0.1 | حجب زائد@0.1 |",
        "|---|---|---|---|---|",
    ]
    idx = [i for i, x in enumerate(items) if x[2] is not None]
    for mg in [float(x) for x in a.margins.split(",")]:
        pf_all = np.full(len(items), np.nan)
        pf = female_prob(gen, [gender_chip(items[i][1], items[i][2], mg) for i in idx])
        for k, i in enumerate(idx):
            pf_all[i] = pf[k]
        cells = []
        for thr in (0.2, 0.1):
            blocked = has & (pf_all >= thr)          # NaN => False
            leak = int((is_f & ~blocked).sum())
            over = int(((~is_f) & blocked).sum())
            lo, hi = wilson(leak, nf)
            lo2, hi2 = wilson(over, nm)
            cells.append((f"{leak}/{nf} = {leak / max(nf, 1) * 100:.1f}% ({lo * 100:.1f}–{hi * 100:.1f})",
                          f"{over}/{nm} = {over / max(nm, 1) * 100:.1f}% ({lo2 * 100:.1f}–{hi2 * 100:.1f})"))
        row = f"| {mg} | {cells[0][0]} | {cells[0][1]} | {cells[1][0]} | {cells[1][1]} |"
        lines.append(row)
        print(row)
    if min(nf, nm) < 100:
        lines += ["", "> ⚠️ العيّنة أقل من 100 في إحدى الفئتين، فالنتائج غير حاسمة."]
    Path(a.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nحُفظ التقرير في {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
