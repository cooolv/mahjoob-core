import json
import tempfile
import unittest
from pathlib import Path

import prepare_dataset as p


class T(unittest.TestCase):
    def test_license(self):
        for ok in ["CC BY 4.0", "CC BY-SA 3.0", "CC0", "Public domain", "PD-old"]:
            self.assertTrue(p.license_ok(ok), ok)
        for bad in ["", "CC BY-NC 2.0", "CC BY-ND 4.0", "All rights reserved", "Fair use"]:
            self.assertFalse(p.license_ok(bad), bad)

    def test_parse_commons(self):
        js = {"query": {"pages": {
            "1": {"title": "File:A.jpg", "imageinfo": [{"thumburl": "http://x/a.jpg", "mime": "image/jpeg",
                  "descriptionurl": "http://x/A", "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"},
                  "Artist": {"value": "<a href='u'>Ali</a>"}}}]},
            "2": {"title": "File:B.jpg", "imageinfo": [{"url": "http://x/b.jpg", "mime": "image/jpeg",
                  "extmetadata": {"LicenseShortName": {"value": "CC BY-NC 4.0"}}}]},
            "3": {"title": "File:C.svg", "imageinfo": [{"url": "http://x/c.svg", "mime": "image/svg+xml",
                  "extmetadata": {"LicenseShortName": {"value": "CC0"}}}]},
            "4": {"title": "File:D.jpg"},
        }}}
        r = p.parse_commons_response(js)
        self.assertEqual([x["title"] for x in r], ["File:A.jpg"])
        self.assertEqual(r[0]["url"], "http://x/a.jpg")

    def _fake(self, d):
        (d / "fairface" / "val").mkdir(parents=True)
        lines = ["file,age,gender,race,service_test"]
        for i in range(1, 41):
            (d / "fairface" / "val" / f"{i}.jpg").write_bytes(b"x")
            lines.append(f"val/{i}.jpg,20-29,{'Female' if i % 2 else 'Male'},White,True")
        lines.append("val/999.jpg,20-29,Female,White,True")  # صورتها غير موجودة
        (d / "fairface_label_val.csv").write_text("\n".join(lines), encoding="utf-8")

    def test_end_to_end(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            self._fake(d)
            (d / "none").mkdir()
            for n in ("a.jpg", "b.png", "note.txt"):
                (d / "none" / n).write_bytes(b"x")
            self.assertEqual(p.main(["--data", str(d), "--per-class", "10", "--seed", "3"]), 0)
            m1 = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
            p.main(["--data", str(d), "--per-class", "10", "--seed", "3"])
            m2 = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(m1, m2)  # حتمي
            g = [e["gender"] for e in m1["entries"]]
            self.assertEqual((g.count("female"), g.count("male"), g.count("none")), (10, 10, 2))
            self.assertTrue(all(e["path"] != "fairface/val/999.jpg" for e in m1["entries"]))
            self.assertIn("CC BY 4.0", m1["source"])

    def test_exclude_gives_disjoint_sample(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            self._fake(d)
            p.main(["--data", str(d), "--per-class", "8", "--seed", "1"])
            first = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
            p.main(["--data", str(d), "--per-class", "8", "--seed", "2",
                    "--exclude", str(d / "manifest.json"), "--out", str(d / "m2.json")])
            second = json.loads((d / "m2.json").read_text(encoding="utf-8"))
            a = {e["path"] for e in first["entries"]}
            b = {e["path"] for e in second["entries"]}
            self.assertEqual(len(b), 16)
            self.assertFalse(a & b)                       # لا تداخل
            # الملف الأصلي لم يُمسّ
            self.assertEqual(first, json.loads((d / "manifest.json").read_text(encoding="utf-8")))

    def test_not_enough(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            self._fake(d)
            with self.assertRaises(SystemExit):
                p.main(["--data", str(d), "--per-class", "50"])


if __name__ == "__main__":
    unittest.main()
