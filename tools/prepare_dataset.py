#!/usr/bin/env python3
"""
تجهيز بيانات القياس لمشروع mahjoob-core.

يعمل بمكتبات بايثون القياسية فقط (بدون pip install).

ما يفعله:
  1) يقرأ ملف FairFace CSV ويتأكد أن الصور موجودة فعلًا.
  2) (اختياري) ينزّل صورًا مرخّصة من Wikimedia Commons إلى مجلد data/none_review للمراجعة.
  3) يكتب data/manifest.json جاهزًا لسكربت القياس.

تنبيه: الصور المنزّلة من Commons لا يمكن التأكد آليًا أنها بلا أشخاص.
لذلك تُوضع في none_review ولا تدخل في manifest إلا بعد أن تراجعها بعينك وتنقل
الصالحة منها يدويًا إلى data/none.
"""
import argparse
import csv
import json
import random
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
UA = "mahjoob-core-eval/0.1 (open-source dataset prep; contact: project maintainer)"
SOURCE_FAIRFACE = ("FairFace (Kärkkäinen & Joo, WACV 2021), CC BY 4.0, "
                   "https://github.com/joojs/fairface")

# مواضيع غالبًا بلا أشخاص. لا ضمان: المراجعة اليدوية إلزامية.
NONE_TERMS = [
    "mountain landscape", "empty beach", "forest trees", "flower macro", "desert dunes",
    "building facade", "old bridge", "sky clouds", "food dish", "bicycle", "car parked",
    "lake reflection", "snow field", "waterfall", "mosque architecture", "stone wall texture",
]


# ---------- دوال نقية (قابلة للاختبار دون إنترنت) ----------
def license_ok(short):
    s = (short or "").strip().lower().replace("-", " ")
    if not s or " nc" in s or " nd" in s:
        return False
    return s.startswith(("cc by", "cc0", "public domain", "pd"))


def find_csv(data):
    cands = sorted(data.glob("*.csv"))
    for c in cands:
        if "label_val" in c.name.lower():
            return c
    for c in cands:
        try:
            with open(c, encoding="utf-8", newline="") as f:
                head = [h.strip().lower() for h in next(csv.reader(f))]
            if "file" in head and "gender" in head:
                return c
        except (StopIteration, UnicodeDecodeError):
            continue
    return None


def read_fairface(csv_path):
    rows = []
    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [h.strip().lower() for h in (reader.fieldnames or [])]
        if "file" not in reader.fieldnames or "gender" not in reader.fieldnames:
            raise SystemExit("لم أجد العمودين file و gender في ملف CSV")
        for r in reader:
            g = (r.get("gender") or "").strip().lower()
            fn = (r.get("file") or "").strip()
            if fn and g in ("female", "male"):
                rows.append((fn, g))
    return rows


def parse_commons_response(js):
    """يستخرج (عنوان، رابط الصورة، الترخيص، المؤلف، رابط الصفحة) من ردّ API ويستبعد الترخيص غير المسموح."""
    out = []
    for page in (js.get("query", {}).get("pages", {}) or {}).values():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        meta = info.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        if not license_ok(lic):
            continue
        if not str(info.get("mime", "")).startswith("image/") or info.get("mime") == "image/svg+xml":
            continue
        url = info.get("thumburl") or info.get("url")
        if not url:
            continue
        artist = (meta.get("Artist") or {}).get("value", "")
        out.append({
            "title": page.get("title", ""),
            "url": url,
            "license": lic,
            "artist": " ".join(artist.replace("<", " <").split())[:200],
            "page": info.get("descriptionurl", ""),
        })
    return out


def build_manifest(ff_pairs, per_class, seed, none_files):
    rnd = random.Random(seed)
    entries = []
    for g in ("female", "male"):
        pool = sorted(p for p, gg in ff_pairs if gg == g)
        if len(pool) < per_class:
            raise SystemExit(f"لا يكفي {g}: المتوفر {len(pool)} والمطلوب {per_class}")
        for p in rnd.sample(pool, per_class):
            entries.append({"path": "fairface/" + p, "gender": g, "tags": ["face", "fairface"]})
    for n in sorted(none_files):
        entries.append({"path": "none/" + n, "gender": "none", "tags": ["no-person"]})
    src = SOURCE_FAIRFACE + (". صور بلا أشخاص: Wikimedia Commons أو مصدر آخر، التراخيص في none/CREDITS.csv"
                             if none_files else "")
    return {"name": "FairFace subset" + (" + no-person images" if none_files else ""),
            "source": src, "entries": entries}


# ---------- الشبكة (غير مختبرة هنا) ----------
def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_commons(target, outdir, seed):
    outdir.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(seed)
    terms = NONE_TERMS[:]
    rnd.shuffle(terms)
    got, seen = [], set()
    credits = outdir / "CREDITS.csv"
    new_file = not credits.exists()
    with open(credits, "a", encoding="utf-8", newline="") as cf:
        w = csv.writer(cf)
        if new_file:
            w.writerow(["file", "title", "license", "artist", "page"])
        for term in terms:
            if len(got) >= target:
                break
            q = urllib.parse.urlencode({
                "action": "query", "format": "json", "generator": "search",
                "gsrsearch": term + " filetype:bitmap", "gsrnamespace": "6", "gsrlimit": "30",
                "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": "800",
            })
            try:
                js = json.loads(http_get("https://commons.wikimedia.org/w/api.php?" + q))
            except Exception as e:  # noqa: BLE001
                print(f"  تعذّر البحث عن '{term}': {e}")
                continue
            for c in parse_commons_response(js):
                if len(got) >= target:
                    break
                if c["title"] in seen:
                    continue
                seen.add(c["title"])
                name = f"commons_{len(got) + 1:04d}.jpg"
                try:
                    data = http_get(c["url"])
                except Exception as e:  # noqa: BLE001
                    print(f"  تعذّر تنزيل {c['title']}: {e}")
                    continue
                (outdir / name).write_bytes(data)
                w.writerow([name, c["title"], c["license"], c["artist"], c["page"]])
                got.append(name)
                time.sleep(1)  # احترامًا لسياسة ويكيميديا
            time.sleep(1)
    return got


# ---------- التشغيل ----------
def main(argv=None):
    ap = argparse.ArgumentParser(description="تجهيز manifest.json لقياس mahjoob-core")
    ap.add_argument("--data", default="data", help="مجلد البيانات (الافتراضي: data)")
    ap.add_argument("--per-class", type=int, default=100, help="عدد صور كل جنس من FairFace")
    ap.add_argument("--fetch-none", type=int, default=0,
                    help="نزّل هذا العدد من صور Commons إلى none_review للمراجعة")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--exclude", default="",
                    help="manifest قديم: صوره تُستبعد (للحصول على عيّنة جديدة لم يُقَس عليها من قبل)")
    ap.add_argument("--out", default="", help="مسار ملف الخرج (الافتراضي: data/manifest.json)")
    a = ap.parse_args(argv)

    data = Path(a.data)
    if not data.is_dir():
        raise SystemExit(f"المجلد {data} غير موجود")

    if a.fetch_none > 0:
        print(f"تنزيل حتى {a.fetch_none} صورة من Wikimedia Commons إلى {data / 'none_review'} ...")
        got = fetch_commons(a.fetch_none, data / "none_review", a.seed)
        print(f"نُزّلت {len(got)} صورة. راجعها بعينك، وانقل الخالية من الأشخاص فقط إلى {data / 'none'}")
        print("ثم انقل ملف CREDITS.csv (أو انسخه) إلى مجلد none أيضًا، وأعد تشغيل السكربت بدون --fetch-none.")
        return 0

    csv_path = find_csv(data)
    if not csv_path:
        raise SystemExit(f"لم أجد ملف FairFace CSV داخل {data}. ضع fairface_label_val.csv هناك.")
    rows = read_fairface(csv_path)
    existing = [(f, g) for f, g in rows if (data / "fairface" / f).is_file()]
    print(f"CSV: {csv_path.name} | صفوف {len(rows)} | صورها موجودة فعلًا: {len(existing)}")
    if a.exclude:
        old_m = json.loads(Path(a.exclude).read_text(encoding="utf-8"))
        used = {e["path"] for e in old_m.get("entries", [])}
        before = len(existing)
        existing = [(f, g) for f, g in existing if ("fairface/" + f) not in used]
        print(f"استُبعدت {before - len(existing)} صورة مستخدمة سابقًا، المتبقي {len(existing)}")
    if not existing:
        raise SystemExit(f"لم أجد أي صورة. المتوقع مثل {data / 'fairface' / rows[0][0] if rows else 'fairface/val/1.jpg'}")

    none_dir = data / "none"
    none_files = sorted(p.name for p in none_dir.iterdir()
                        if p.suffix.lower() in IMG_EXT) if none_dir.is_dir() else []
    if not none_files:
        print("تنبيه: لا توجد صور في data/none، فلن يحوي القياس صورًا بلا أشخاص (نتيجة أقل واقعية).")

    m = build_manifest(existing, a.per_class, a.seed, none_files)
    out = Path(a.out) if a.out else data / "manifest.json"
    out.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
    n = {g: sum(1 for e in m["entries"] if e["gender"] == g) for g in ("female", "male", "none")}
    print(f"كُتب {out}: إناث {n['female']}، ذكور {n['male']}، بلا أشخاص {n['none']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
