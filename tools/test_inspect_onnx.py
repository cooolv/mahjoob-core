import tempfile
import unittest
import zipfile
from pathlib import Path

import inspect_onnx as m


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def fld(num, wire, payload):
    key = varint((num << 3) | wire)
    return key + (varint(len(payload)) + payload if wire == 2 else payload)


def s(num, text):
    return fld(num, 2, text.encode())


def tiny_identity_model():
    """نموذج ONNX صغير مبنيّ يدويًا: y = Identity(x) بشكل [1,3]"""
    dim = lambda n: fld(1, 2, fld(1, 0, varint(n)))  # noqa: E731
    shape = fld(2, 2, dim(1) + dim(3))
    tensor = fld(1, 2, fld(1, 0, varint(1)) + shape)       # elem_type=FLOAT + shape
    vi = lambda name: s(1, name) + fld(2, 2, tensor)       # noqa: E731
    node = s(1, "x") + s(2, "y") + s(4, "Identity")
    graph = fld(1, 2, node) + s(2, "g") + fld(11, 2, vi("x")) + fld(12, 2, vi("y"))
    opset = fld(2, 0, varint(13))
    return fld(1, 0, varint(8)) + fld(8, 2, opset) + fld(7, 2, graph)


class T(unittest.TestCase):
    def test_describe_and_extract(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            onnx = d / "tiny.onnx"
            onnx.write_bytes(tiny_identity_model())
            text = m.describe(onnx)
            self.assertIn("مدخل : x", text)
            self.assertIn("مخرج : y", text)
            self.assertIn("[1, 3]", text)

            whl = d / "pkg.whl"
            with zipfile.ZipFile(whl, "w") as z:
                z.writestr("pkg/models/tiny.onnx", tiny_identity_model())
                z.writestr("pkg/readme.txt", "x")
            found = m.extract_onnx(whl, d / "out")
            self.assertEqual([f.name for f in found], ["tiny.onnx"])

    def test_bad_model_reports_error(self):
        with tempfile.TemporaryDirectory() as t:
            bad = Path(t) / "bad.onnx"
            bad.write_bytes(b"not a model")
            self.assertIn("تعذّر فتح النموذج", m.describe(bad))


if __name__ == "__main__":
    unittest.main()
