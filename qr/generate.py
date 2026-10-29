#!/usr/bin/env python3
"""Tracka+ referral QR codes.

Usage:
    python generate.py                         # just the Tracka+ house code
    python generate.py BEAUTYHUT "Beauty Hut"  # a partner code
    python generate.py BEAUTYHUT "Beauty Hut" "Lekki branch"

Writes a print-ready PNG flyer card and a bare SVG (vector, so it stays sharp
at any flyer size — give the printer the SVG, not the PNG).
Error correction is H: up to 30% of the code can be smudged, folded or
covered and it still scans. That matters on paper in a shop.

The code must ALSO exist in the database (Admin → Referrals → "Add a store
or clinic code", or admin_upsert_referral_code) — otherwise scans of it are
ignored.

Needs: pip install segno pillow, and the Inter font (FONTS below is the
Linux path; on Windows/macOS point it at wherever Inter is installed).
"""
import sys, os, segno
from PIL import Image, ImageDraw, ImageFont

BASE   = "https://trackaplus.app/?ref="
BLUE   = "#2563eb"
INK    = "#0f172a"
MUTED  = "#64748b"
OUT    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qr")
FONTS  = "/usr/share/fonts/opentype/inter/"
os.makedirs(OUT, exist_ok=True)

def font(name, size):
    return ImageFont.truetype(FONTS + name, size)

def centred(d, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((1200 - w) / 2, y), text, font=f, fill=fill)
    return w

def make(code, partner, label=None):
    code = code.upper()
    url  = BASE + code
    qr   = segno.make(url, error="h")

    qr.save(f"{OUT}/{code}.svg", kind="svg", scale=10, dark=BLUE,
            light=None, border=2)                     # transparent, for print
    qr.save(f"{OUT}/{code}-qr.png", kind="png", scale=22, dark=BLUE,
            light="white", border=2)

    # flyer card, 4:5 — fits an A6 handout or an Instagram post
    W, H = 1200, 1500
    card = Image.new("RGB", (W, H), "white")
    d    = ImageDraw.Draw(card)
    d.rounded_rectangle([24, 24, W - 24, H - 24], radius=48, outline="#e2e8f0", width=4)

    centred(d, 92,  "Tracka+",                            font("Inter-Bold.otf", 76),    BLUE)
    centred(d, 196, "Your skincare routine, remembered.",  font("Inter-Regular.otf", 34), MUTED)

    q = Image.open(f"{OUT}/{code}-qr.png").convert("RGB")
    q = q.resize((760, 760), Image.LANCZOS)
    card.paste(q, ((W - 760) // 2, 300))

    centred(d, 1116, "SCAN TO START", font("Inter-SemiBold.otf", 30), MUTED)
    centred(d, 1172, partner,         font("Inter-Bold.otf", 56),     INK)
    y = 1252
    if label:
        centred(d, y, label, font("Inter-Regular.otf", 34), MUTED)
        y += 54
    centred(d, y + 8, code, font("Inter-Bold.otf", 30), BLUE)

    card.save(f"{OUT}/{code}-flyer.png")
    print(f"{code:12} -> {url}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        make(*sys.argv[1:4])
    else:
        make("TRACKA", "Tracka+", "trackaplus.app")
