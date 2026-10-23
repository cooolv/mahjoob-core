#!/usr/bin/env python3
"""
اختبار الإضافة في Chromium حقيقي (إضافة محمَّلة فعلًا، service worker وoffscreen وcontent script).

يستخدم onnxruntime وهميًا (صورة ساطعة = أنثى، مظلمة = ذكر) للتحقق من المنظومة كلها:
التغطية، الاتصال بين المكوّنات، الفحص عبر canvas وعبر الرابط، الفيديو، الإعدادات، وسلوك الفشل.
لا يختبر دقة النماذج الحقيقية.

التشغيل:
    DIST_OK=/path/to/dist-with-fake-ort DIST_FAIL=/path/to/dist-with-failing-ort python3 test_extension.py
"""
import base64
import functools
import http.server
import os
import socketserver
import sys
import tempfile
import threading
import time
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

DIST_OK = os.environ["DIST_OK"]
DIST_FAIL = os.environ["DIST_FAIL"]
PORT_A, PORT_B = 8781, 8782  # localhost (نفس الأصل) و127.0.0.1 (أصل آخر)

site = Path(tempfile.mkdtemp())


def png(path, w, h, v):
    Image.new("RGB", (w, h), (v, v, v)).save(path)


png(site / "white.png", 200, 200, 255)
png(site / "black.png", 200, 200, 0)
png(site / "tiny.png", 16, 16, 255)
(site / "logo.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100'/></svg>")
buf = BytesIO(); Image.new("RGB", (200, 200), (255, 255, 255)).save(buf, "PNG")
DATA_WHITE = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

PAGE = f"""<!doctype html><meta charset=utf-8><body>
<img id=white src="white.png"><img id=black src="black.png">
<img id=xwhite src="http://127.0.0.1:{PORT_B}/white.png"><img id=xblack src="http://127.0.0.1:{PORT_B}/black.png">
<img id=tiny src="tiny.png"><img id=svg src="logo.svg"><img id=datawhite src="{DATA_WHITE}">
<img id=broken src="missing-file.png">
<video id=vw muted playsinline src="w.webm" width=320></video>
<video id=vb muted playsinline src="b.webm" width=320></video>
</body>"""
(site / "page.html").write_text(PAGE, encoding="utf-8")


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
for port in (PORT_A, PORT_B):
    srv = socketserver.TCPServer(("127.0.0.1", port), functools.partial(H, directory=str(site)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

failed = []


def check(name, cond, extra=""):
    print(("PASS" if cond else "FAIL"), name, extra)
    if not cond:
        failed.append(name)


def launch(p, dist):
    ud = tempfile.mkdtemp()
    ctx = p.chromium.launch_persistent_context(
        ud, headless=False,
        args=["--headless=new", f"--disable-extensions-except={dist}", f"--load-extension={dist}",
              "--autoplay-policy=no-user-gesture-required"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    return ctx, sw


def attr(pg, i, name="data-sv"):
    return pg.evaluate(f"document.getElementById('{i}').getAttribute('{name}')")


def wait_sv(pg, ids, timeout=20000):
    cond = " && ".join(f"document.getElementById('{i}').hasAttribute('data-sv')" for i in ids)
    try:
        pg.wait_for_function(cond, timeout=timeout)
    except Exception:
        for i in ids:
            print("  [تشخيص]", i, pg.evaluate(f"(()=>{{const e=document.getElementById('{i}'); return e ? [e.getAttribute('data-sv'), e.getAttribute('data-sv-reason'), e.complete, e.naturalWidth, e.currentSrc] : null}})()"))
        raise


def make_videos(p):
    b = p.chromium.launch()
    pg = b.new_page()
    for color, name in (("#fff", "w"), ("#000", "b")):
        b64 = pg.evaluate("""async (color) => {
          const c = document.createElement('canvas'); c.width = 320; c.height = 240;
          const ctx = c.getContext('2d'); const stream = c.captureStream(15);
          const rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); const chunks = [];
          rec.ondataavailable = e => chunks.push(e.data); const done = new Promise(r => rec.onstop = r);
          rec.start(); const t0 = performance.now();
          while (performance.now() - t0 < 6000) { ctx.fillStyle = color; ctx.fillRect(0,0,320,240); await new Promise(r => setTimeout(r, 60)); }
          rec.stop(); await done;
          const buf = await new Blob(chunks, {type:'video/webm'}).arrayBuffer();
          let s = ''; const u = new Uint8Array(buf); for (let i=0;i<u.length;i+=0x8000) s += String.fromCharCode.apply(null, u.subarray(i,i+0x8000));
          return btoa(s); }""", color)
        (site / f"{name}.webm").write_bytes(base64.b64decode(b64))
    b.close()


with sync_playwright() as p:
    make_videos(p)

    # ================= الإضافة السليمة =================
    ctx, sw = launch(p, DIST_OK)
    ext_id = sw.url.split("/")[2]
    errors = []
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    sw_eval = lambda js: sw.evaluate(js)

    pg.goto(f"http://localhost:{PORT_A}/page.html", wait_until="domcontentloaded")
    # 1) ثابتة التغطية: أي صورة بلا قرار تكون مخفية
    ok_invariant = True
    for _ in range(6):
        bad = pg.evaluate("""Array.from(document.querySelectorAll('img,video')).filter(e => !e.hasAttribute('data-sv')
            && getComputedStyle(e).visibility !== 'hidden').map(e => e.id)""")
        if bad: ok_invariant = False; print("  مكشوفة بلا قرار:", bad)
        time.sleep(0.05)
    check("Fail-Closed: لا صورة تظهر قبل القرار", ok_invariant)

    # 2) الافتراضي target=any: كل الوجوه محجوبة
    wait_sv(pg, ["white", "black", "xwhite", "xblack", "tiny", "svg", "datawhite", "broken"])
    check("الافتراضي any: الأبيض والأسود محجوبان", attr(pg, "white") == "blocked" and attr(pg, "black") == "blocked",
          f"{attr(pg, 'white')} {attr(pg, 'black')}")
    check("أصل آخر (via=url) يُفحص ويُحجب", attr(pg, "xwhite") == "blocked" and attr(pg, "xwhite", "data-sv-via") == "url",
          f"{attr(pg, 'xwhite')} {attr(pg, 'xwhite', 'data-sv-via')}")
    check("صورة نفس الأصل تُفحص عبر canvas", attr(pg, "white", "data-sv-via") == "canvas", attr(pg, "white", "data-sv-via"))
    check("الصور الصغيرة وSVG والتالفة تُسمح", attr(pg, "tiny") == "ok" and attr(pg, "svg") == "ok" and attr(pg, "broken") == "ok",
          f"{attr(pg, 'tiny')} {attr(pg, 'svg')} {attr(pg, 'broken')}")

    # 3) هدف الإناث
    sw_eval("chrome.storage.local.set({target:'female', configured:true})")
    pg.wait_for_function("document.getElementById('black').getAttribute('data-sv') === 'ok'", timeout=20000)
    wait_sv(pg, ["white", "black", "xwhite", "xblack", "datawhite"])
    r = {i: attr(pg, i) for i in ("white", "black", "xwhite", "xblack", "datawhite")}
    check("هدف إناث: الأبيض (أنثى) محجوب بأنواعه الثلاثة", r["white"] == r["xwhite"] == r["datawhite"] == "blocked", str(r))
    check("هدف إناث: الأسود (ذكر) مسموح بنوعيه", r["black"] == r["xblack"] == "ok", str(r))
    vis = pg.evaluate("getComputedStyle(document.getElementById('white')).visibility")
    check("الصورة المحجوبة تُستبدل بمكان رمادي مرئي (لا تظهر الأصلية)", vis == "visible" and attr(pg, "white") == "blocked")

    # 4) عناصر تُضاف لاحقًا + تغيّر src
    pg.evaluate("""() => { for (const [id, src] of [['dynb','black.png'],['dynw','white.png']]) {
        const i = document.createElement('img'); i.id = id; i.src = src; document.body.appendChild(i); } }""")
    wr = pg.evaluate("(() => { const r = document.getElementById('white').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()")
    check("المحجوبة تحتفظ بمقاس الصورة الأصلية (لا تمتد)", wr == [200, 200], str(wr))
    wait_sv(pg, ["dynb", "dynw"])
    check("صورة مضافة ديناميكيًا تُفحص", attr(pg, "dynb") == "ok" and attr(pg, "dynw") == "blocked", f"{attr(pg, 'dynb')} {attr(pg, 'dynw')}")
    pg.evaluate("document.getElementById('dynb').src = 'white.png'")
    pg.wait_for_function("document.getElementById('dynb').getAttribute('data-sv') === 'blocked'", timeout=20000)
    check("تغيير src يعيد الفحص (من أسود إلى أبيض)", True)

    # 5) هدف الذكور
    sw_eval("chrome.storage.local.set({target:'male'})")
    pg.wait_for_function("document.getElementById('black').getAttribute('data-sv') === 'blocked'", timeout=20000)
    wait_sv(pg, ["white", "black"])
    check("هدف ذكور: الأسود محجوب والأبيض مسموح", attr(pg, "black") == "blocked" and attr(pg, "white") == "ok", f"{attr(pg, 'black')} {attr(pg, 'white')}")

    # 6) فيديو (هدف إناث)
    sw_eval("chrome.storage.local.set({target:'female'})")
    pg.wait_for_function("document.getElementById('black').getAttribute('data-sv') === 'ok'", timeout=20000)
    pg.evaluate("document.getElementById('vb').play(); document.getElementById('vw').play()")
    pg.wait_for_function("document.getElementById('vb').getAttribute('data-sv') === 'ok'", timeout=25000)
    time.sleep(3)
    check("فيديو آمن (أسود) يُكشف", attr(pg, "vb") == "ok")
    check("فيديو الهدف (أبيض) يبقى مغطّى", attr(pg, "vw") != "ok" and pg.evaluate("getComputedStyle(document.getElementById('vw')).visibility") == "hidden",
          f"{attr(pg, 'vw')} / {attr(pg, 'vw', 'data-sv-reason')}")
    pg.evaluate("document.getElementById('vb').currentTime = 0.3")
    time.sleep(0.2)
    check("التقديم/التأخير يعيد تغطية الفيديو فورًا", attr(pg, "vb") is None)
    pg.wait_for_function("document.getElementById('vb').getAttribute('data-sv') === 'ok'", timeout=25000)
    check("ثم يُكشف بعد إطارات آمنة", True)

    # 7) تعطيل الإضافة / الموقع
    sw_eval("chrome.storage.local.set({enabled:false})")
    pg.wait_for_function("document.documentElement.hasAttribute('data-sv-off')", timeout=10000)
    vis_all = pg.evaluate("Array.from(document.querySelectorAll('img')).every(e => getComputedStyle(e).visibility === 'visible')")
    check("التعطيل: كل الصور تظهر", vis_all)
    sw_eval("chrome.storage.local.set({enabled:true})")
    pg.wait_for_function("!document.documentElement.hasAttribute('data-sv-off')", timeout=10000)
    wait_sv(pg, ["white", "black"])
    check("إعادة التفعيل: يعاد الفحص", attr(pg, "white") == "blocked")
    sw_eval("chrome.storage.local.set({disabledHosts:['localhost']})")
    pg.wait_for_function("document.documentElement.hasAttribute('data-sv-off')", timeout=10000)
    check("تعطيل موقع محدد يعمل", True)
    sw_eval("chrome.storage.local.set({disabledHosts:[]})")
    pg.wait_for_function("!document.documentElement.hasAttribute('data-sv-off')", timeout=10000)

    # 8) النافذة المنبثقة
    pop = ctx.new_page()
    pop.goto(f"chrome-extension://{ext_id}/popup.html")
    def wait_status(page, word, timeout=10):
        t0 = time.time()
        while time.time() - t0 < timeout:
            txt = page.text_content("#status") or ""
            if word in txt:
                return txt
            time.sleep(0.2)
        return None
    st = wait_status(pop, "جاهزة")
    check("النافذة: حالة النماذج «جاهزة»", st is not None, str(st))
    pop.select_option("#target", "any")
    time.sleep(0.3)
    check("النافذة: تغيير الإعداد يُحفظ", sw_eval("chrome.storage.local.get('target')")["target"] == "any")
    check("لا أخطاء JavaScript في الصفحة", not errors, "; ".join(errors)[:200])
    ctx.close()

    # ================= فشل تحميل النماذج =================
    ctx, sw = launch(p, DIST_FAIL)
    ext_id = sw.url.split("/")[2]
    sw.evaluate("chrome.storage.local.set({target:'female', configured:true})")
    pg = ctx.new_page()
    pg.goto(f"http://localhost:{PORT_A}/page.html", wait_until="domcontentloaded")
    wait_sv(pg, ["white", "black", "xwhite", "datawhite"], timeout=30000)
    r = [attr(pg, i) for i in ("white", "black", "xwhite", "datawhite")]
    check("فشل النماذج: كل الصور المفحوصة تبقى محجوبة (Fail-Closed)", all(x == "blocked" for x in r), str(r))
    check("سبب الحجب: خطأ تحليل", attr(pg, "white", "data-sv-reason") == "analysis-error", str(attr(pg, "white", "data-sv-reason")))
    pop = ctx.new_page()
    pop.goto(f"chrome-extension://{ext_id}/popup.html")
    st = wait_status(pop, "خطأ")
    check("النافذة تعرض خطأ النماذج", st is not None, str(st)[:90])
    ctx.close()

print("FAILED:", failed) if failed else print("ALL PASSED")
sys.exit(1 if failed else 0)
