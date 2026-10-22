import math
import unittest

import numpy as np

import eval_pipeline as p


def fake_outputs(w, h, stride, r, c, cls, obj, bbox):
    o = {}
    for s in (8, 16, 32):
        n = (w // s) * (h // s)
        o[f"cls_{s}"] = np.zeros((1, n, 1), np.float32)
        o[f"obj_{s}"] = np.zeros((1, n, 1), np.float32)
        o[f"bbox_{s}"] = np.zeros((1, n, 4), np.float32)
    i = r * (w // stride) + c
    o[f"cls_{stride}"][0, i, 0] = cls
    o[f"obj_{stride}"][0, i, 0] = obj
    o[f"bbox_{stride}"][0, i] = bbox
    return o


class T(unittest.TestCase):
    def test_decode_matches_js_test(self):
        o = fake_outputs(64, 64, 16, 1, 2, 0.81, 1.0, [0.5, 0.5, math.log(2), math.log(2)])
        r = p.decode_yunet(o, 64, 64)
        self.assertEqual(len(r), 1)
        (x, y, w, h), sc = r[0]
        self.assertAlmostEqual(sc, 0.9, places=5)
        for got, want in zip((x, y, w, h), (24, 8, 32, 32)):
            self.assertAlmostEqual(got, want, places=3)

    def test_missing_outputs_exit(self):
        with self.assertRaises(SystemExit):
            p.decode_yunet({"cls_8": np.zeros(1)}, 64, 64)

    def test_letterbox(self):
        arr = np.full((100, 200, 3), 255, np.uint8)
        out, scale, px, py = p.letterbox(arr, 100, 100, allow_upscale=True)
        self.assertEqual((scale, px, py), (0.5, 0, 25))
        self.assertEqual(int(out[0, 0, 0]), 114)
        small = np.full((50, 50, 3), 255, np.uint8)
        _, scale, px, py = p.letterbox(small, 100, 100)  # بدون تكبير
        self.assertEqual((scale, px, py), (1.0, 25, 25))

    def test_resize_region_constant_and_clamp(self):
        arr = np.full((10, 10, 3), [10, 20, 30], np.uint8)
        out = p.resize_region(arr, -5, -5, 30, 30, 4, 4)
        self.assertEqual(out.tolist()[0][0], [10, 20, 30])

    def test_nms(self):
        a = ((0, 0, 10, 10), 0.9)
        b = ((1, 0, 10, 10), 0.8)
        c = ((50, 50, 10, 10), 0.7)
        self.assertEqual(len(p.nms([a, b, c], 0.3)), 2)


if __name__ == "__main__":
    unittest.main()
