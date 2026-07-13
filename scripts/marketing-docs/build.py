#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Figurunica pazarlama dokümanları — ODT (OpenDocument) + HTML üreteci.

Kullanım:
    python3 scripts/marketing-docs/build.py

Çıktı:
    docs/pazarlama/*.odt          → LibreOffice / Word ile düzenlenebilir
    docs/pazarlama/.build/*.html  → PDF üretimi için ara dosya (render_pdf.mjs)

İçerik `content.py` içindedir; metni oradan değiştirin.
"""
from __future__ import annotations

import base64
import os
import re
import shutil
import sys
import zipfile
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content import BRAND, DOCS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(ROOT, "docs", "pazarlama")
BUILD_DIR = os.path.join(OUT_DIR, ".build")
MASCOT = os.path.join(ROOT, "public", "maskot-face.png")

# Marka paleti — src/app/globals.css ile aynı
INK = "#0B0C0F"
DEEP = "#0B3D4C"
TEAL = "#0E7490"
CYAN = "#0891B2"
GLOW = "#00D4FF"
MUTED = "#8A8C93"
SECOND = "#44464E"
LINE = "#E3E7EA"
SOFT = "#F5F9FB"

KINDS = {
    "danger": ("#FEF2F2", "#DC2626", "#B91C1C"),
    "warn": ("#FFFBEB", "#F59E0B", "#92400E"),
    "info": ("#ECFEFF", CYAN, DEEP),
    "ok": ("#ECFDF5", "#059669", "#065F46"),
}


# ─────────────────────────────────────────────────────────────── inline **bold**
def split_bold(text: str):
    """'a **b** c' → [('a ', False), ('b', True), (' c', False)]"""
    return [(part, i % 2 == 1) for i, part in enumerate(re.split(r"\*\*(.+?)\*\*", text, flags=re.S)) if part]


# ═════════════════════════════════════════════════════════════════════════ ODT

NS = (
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" '
    'xmlns:dc="http://purl.org/dc/elements/1.1/"'
)

FONT_DECLS = (
    '<office:font-face-decls>'
    '<style:font-face style:name="Liberation Sans" svg:font-family="&apos;Liberation Sans&apos;, Arial, sans-serif" '
    'style:font-family-generic="swiss" style:font-pitch="variable"/>'
    '</office:font-face-decls>'
)


def _p(name, parent=None, props="", tprops=""):
    par = f' style:parent-style-name="{parent}"' if parent else ""
    p = f"<style:paragraph-properties {props}/>" if props else ""
    t = f"<style:text-properties {tprops}/>" if tprops else ""
    return f'<style:style style:name="{name}" style:family="paragraph"{par}>{p}{t}</style:style>'


FONT = 'style:font-name="Liberation Sans"'


def styles_xml() -> str:
    s = []
    # ── temel
    s.append(
        '<style:default-style style:family="paragraph">'
        f'<style:paragraph-properties fo:hyphenate="false" style:line-height-at-least="0.42cm"/>'
        f'<style:text-properties {FONT} fo:font-size="10.5pt" fo:color="{INK}" fo:language="tr" fo:country="TR"/>'
        "</style:default-style>"
    )
    s.append(_p("Standard", None, 'fo:margin-bottom="0.26cm" fo:line-height="138%"',
                f'{FONT} fo:font-size="10.5pt" fo:color="{INK}"'))
    s.append(_p("Body", "Standard", 'fo:margin-bottom="0.26cm" fo:line-height="138%" fo:text-align="justify"'))
    s.append(_p("Lead", "Standard",
                'fo:margin-bottom="0.36cm" fo:line-height="146%"',
                f'fo:font-size="11.5pt" fo:color="{SECOND}"'))
    s.append(_p("Note", "Standard", 'fo:margin-top="0.1cm" fo:margin-bottom="0.3cm"',
                f'fo:font-size="9.5pt" fo:font-style="italic" fo:color="{MUTED}"'))

    # ── başlıklar
    h1p = ('fo:margin-top="0.75cm" fo:margin-bottom="0.3cm" fo:keep-with-next="always" '
           f'fo:padding-bottom="0.12cm" fo:border-bottom="1.5pt solid {GLOW}" fo:border-top="none" '
           'fo:border-left="none" fo:border-right="none"')
    s.append(_p("H1", "Standard", h1p, f'fo:font-size="16.5pt" fo:font-weight="bold" fo:color="{DEEP}"'))
    s.append(_p("H1PB", "H1", f'{h1p} fo:break-before="page"'))
    s.append(_p("H2", "Standard", 'fo:margin-top="0.5cm" fo:margin-bottom="0.18cm" fo:keep-with-next="always"',
                f'fo:font-size="12pt" fo:font-weight="bold" fo:color="{TEAL}"'))

    # ── liste gövdesi
    s.append(_p("ListBody", "Standard", 'fo:margin-bottom="0.16cm" fo:line-height="136%"'))

    # ── alıntı / konuşma metni
    s.append(_p("Quote", "Standard",
                'fo:margin-left="0.5cm" fo:margin-right="0.3cm" fo:margin-top="0.25cm" fo:margin-bottom="0.35cm" '
                f'fo:padding="0.32cm" fo:background-color="{SOFT}" fo:border-left="3pt solid {CYAN}" '
                'fo:border-top="none" fo:border-bottom="none" fo:border-right="none" fo:line-height="150%"',
                f'fo:font-size="11.5pt" fo:font-style="italic" fo:color="{DEEP}"'))

    # ── soru / cevap
    s.append(_p("QaQ", "Standard", 'fo:margin-top="0.28cm" fo:margin-bottom="0.08cm" fo:keep-with-next="always"',
                f'fo:font-size="10.5pt" fo:font-weight="bold" fo:color="{DEEP}"'))
    s.append(_p("QaA", "Standard", 'fo:margin-left="0.35cm" fo:margin-bottom="0.1cm" fo:line-height="138%"'))

    # ── tablo hücreleri
    s.append(_p("Th", "Standard", 'fo:margin-bottom="0cm"',
               'fo:font-size="9.5pt" fo:font-weight="bold" fo:color="#FFFFFF"'))
    s.append(_p("Td", "Standard", 'fo:margin-bottom="0cm" fo:line-height="130%"', 'fo:font-size="9.5pt"'))
    s.append(_p("TdK", "Standard", 'fo:margin-bottom="0cm" fo:line-height="130%"',
               f'fo:font-size="9.5pt" fo:font-weight="bold" fo:color="{DEEP}"'))

    # ── callout
    s.append(_p("CoTitle", "Standard", 'fo:margin-bottom="0.12cm"', 'fo:font-size="10.5pt" fo:font-weight="bold"'))
    s.append(_p("CoBody", "Standard", 'fo:margin-bottom="0.1cm" fo:line-height="136%"', 'fo:font-size="10pt"'))

    # ── kapak
    s.append(_p("CvLabel", "Standard", 'fo:margin-bottom="0.15cm"',
                f'fo:font-size="9pt" fo:font-weight="bold" fo:color="{GLOW}" fo:letter-spacing="0.06cm"'))
    s.append(_p("CvNum", "Standard", 'fo:margin-bottom="0.1cm"',
                f'fo:font-size="40pt" fo:font-weight="bold" fo:color="{GLOW}"'))
    s.append(_p("CvTitle", "Standard", 'fo:margin-bottom="0.25cm"',
                'fo:font-size="30pt" fo:font-weight="bold" fo:color="#FFFFFF"'))
    s.append(_p("CvSub", "Standard", 'fo:margin-bottom="0.3cm" fo:line-height="140%"',
                'fo:font-size="11.5pt" fo:color="#CDF6FD"'))
    s.append(_p("CvAud", "Standard", 'fo:margin-bottom="0cm"',
                f'fo:font-size="10pt" fo:font-weight="bold" fo:color="{GLOW}"'))
    s.append(_p("CvImg", "Standard", 'fo:text-align="center" fo:margin-top="0.6cm" fo:margin-bottom="0.4cm"'))
    s.append(_p("TocItem", "Standard", 'fo:margin-bottom="0.12cm" fo:margin-left="0.3cm"', 'fo:font-size="10.5pt"'))
    s.append(_p("Footer", "Standard", 'fo:margin-bottom="0cm" fo:text-align="center"',
                f'fo:font-size="8.5pt" fo:color="{MUTED}"'))

    # ── satır içi
    s.append(f'<style:style style:name="B" style:family="text">'
             f'<style:text-properties fo:font-weight="bold" fo:color="{DEEP}"/></style:style>')
    s.append('<style:style style:name="BW" style:family="text">'
             '<style:text-properties fo:font-weight="bold" fo:color="#FFFFFF"/></style:style>')

    # ── liste stilleri
    s.append(
        '<text:list-style style:name="UL">'
        + "".join(
            f'<text:list-level-style-bullet text:level="{i}" text:bullet-char="{c}">'
            f'<style:list-level-properties text:space-before="{0.35 + 0.5*(i-1)}cm" '
            f'text:min-label-width="0.42cm"/>'
            f'<style:text-properties {FONT} fo:color="{CYAN}"/>'
            "</text:list-level-style-bullet>"
            for i, c in ((1, "•"), (2, "–"))
        )
        + "</text:list-style>"
    )
    s.append(
        '<text:list-style style:name="OL">'
        '<text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1">'
        '<style:list-level-properties text:space-before="0.35cm" text:min-label-width="0.55cm"/>'
        f'<style:text-properties {FONT} fo:font-weight="bold" fo:color="{CYAN}"/>'
        "</text:list-level-style-number></text:list-style>"
    )

    page = (
        '<office:automatic-styles>'
        '<style:page-layout style:name="PL">'
        '<style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" '
        'style:print-orientation="portrait" fo:margin-top="1.9cm" fo:margin-bottom="1.7cm" '
        'fo:margin-left="2.1cm" fo:margin-right="2.1cm"/>'
        '<style:footer-style>'
        '<style:header-footer-properties fo:min-height="0.7cm" fo:margin-top="0.5cm"/>'
        "</style:footer-style>"
        "</style:page-layout>"
        "</office:automatic-styles>"
    )
    master = (
        "<office:master-styles>"
        '<style:master-page style:name="Standard" style:page-layout-name="PL">'
        "<style:footer>"
        '<text:p text:style-name="Footer">Figurunica · Pazarlama Kiti · '
        f'{escape(BRAND["version"])} · {escape(BRAND["date"])} · '
        '<text:page-number text:select-page="current">1</text:page-number></text:p>'
        "</style:footer>"
        "</style:master-page>"
        "</office:master-styles>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<office:document-styles {NS} office:version=\"1.3\">"
        f"{FONT_DECLS}<office:styles>{''.join(s)}</office:styles>{page}{master}"
        "</office:document-styles>"
    )


class OdtBody:
    """content.xml gövdesini ve otomatik (tablo) stillerini biriktirir."""

    def __init__(self):
        self.body: list[str] = []
        self.auto: list[str] = []
        self.n = 0

    def uid(self) -> str:
        self.n += 1
        return f"a{self.n}"

    # ── satır içi
    def spans(self, text: str, white=False) -> str:
        out = []
        for chunk, bold in split_bold(text):
            for i, line in enumerate(chunk.split("\n")):
                if i:
                    out.append("<text:line-break/>")
                e = escape(line)
                out.append(f'<text:span text:style-name="{"BW" if white else "B"}">{e}</text:span>' if bold else e)
        return "".join(out)

    def para(self, style: str, text: str, white=False):
        self.body.append(f'<text:p text:style-name="{style}">{self.spans(text, white)}</text:p>')

    def heading(self, style: str, level: int, text: str):
        self.body.append(
            f'<text:h text:style-name="{style}" text:outline-level="{level}">{self.spans(text)}</text:h>'
        )

    def lst(self, items: list[str], ordered=False):
        style = "OL" if ordered else "UL"
        rows = "".join(
            f'<text:list-item><text:p text:style-name="ListBody">{self.spans(i)}</text:p></text:list-item>'
            for i in items
        )
        self.body.append(f'<text:list text:style-name="{style}">{rows}</text:list>')

    def _cell_style(self, bg: str, border_left: str | None = None) -> str:
        name = self.uid()
        bl = f'fo:border-left="{border_left}"' if border_left else 'fo:border-left="none"'
        self.auto.append(
            f'<style:style style:name="{name}" style:family="table-cell">'
            f'<style:table-cell-properties fo:background-color="{bg}" fo:padding-top="0.14cm" '
            f'fo:padding-bottom="0.14cm" fo:padding-left="0.2cm" fo:padding-right="0.2cm" '
            f'fo:border-top="none" fo:border-right="none" fo:border-bottom="0.5pt solid {LINE}" {bl} '
            f'style:vertical-align="top"/></style:style>'
        )
        return name

    def table(self, head: list[str], rows: list[list[str]], widths: list[float]):
        tname = self.uid()
        total = sum(widths)
        self.auto.append(
            f'<style:style style:name="{tname}" style:family="table">'
            f'<style:table-properties style:width="{total}cm" table:align="left" '
            f'fo:margin-top="0.15cm" fo:margin-bottom="0.4cm"/></style:style>'
        )
        cols = []
        for w in widths:
            cn = self.uid()
            self.auto.append(
                f'<style:style style:name="{cn}" style:family="table-column">'
                f'<style:table-column-properties style:column-width="{w}cm"/></style:style>'
            )
            cols.append(f'<table:table-column table:style-name="{cn}"/>')

        hc = self._cell_style(DEEP)
        even = self._cell_style("#FFFFFF")
        odd = self._cell_style(SOFT)

        def cell(style, text, para="Td", white=False):
            return (f'<table:table-cell table:style-name="{style}" office:value-type="string">'
                    f'<text:p text:style-name="{para}">{self.spans(text, white)}</text:p></table:table-cell>')

        out = [f'<table:table table:name="T{tname}" table:style-name="{tname}">', *cols]
        if any(h for h in head):
            out.append("<table:table-header-rows><table:table-row>")
            out += [cell(hc, h, "Th", white=True) for h in head]
            out.append("</table:table-row></table:table-header-rows>")
        for i, r in enumerate(rows):
            bg = even if i % 2 == 0 else odd
            out.append("<table:table-row>")
            out += [cell(bg, c, "TdK" if j == 0 and len(r) > 1 else "Td") for j, c in enumerate(r)]
            out.append("</table:table-row>")
        out.append("</table:table>")
        self.body.append("".join(out))

    def kv(self, pairs: list[list[str]]):
        self.table(["", ""], [[k, v] for k, v in pairs], [4.6, 11.4])

    def callout(self, kind: str, title: str, lines: list[str]):
        bg, accent, fg = KINDS[kind]
        tname = self.uid()
        self.auto.append(
            f'<style:style style:name="{tname}" style:family="table">'
            f'<style:table-properties style:width="16cm" table:align="left" '
            f'fo:margin-top="0.25cm" fo:margin-bottom="0.4cm"/></style:style>'
        )
        cn = self.uid()
        self.auto.append(
            f'<style:style style:name="{cn}" style:family="table-column">'
            f'<style:table-column-properties style:column-width="16cm"/></style:style>'
        )
        cell = self.uid()
        self.auto.append(
            f'<style:style style:name="{cell}" style:family="table-cell">'
            f'<style:table-cell-properties fo:background-color="{bg}" fo:padding="0.32cm" '
            f'fo:border="none" fo:border-left="3pt solid {accent}"/></style:style>'
        )
        tstyle = self.uid()
        self.auto.append(
            f'<style:style style:name="{tstyle}" style:family="paragraph" style:parent-style-name="CoTitle">'
            f'<style:text-properties fo:color="{fg}"/></style:style>'
        )
        inner = [f'<text:p text:style-name="{tstyle}">{self.spans(title)}</text:p>']
        inner += [f'<text:p text:style-name="CoBody">{self.spans(l)}</text:p>' for l in lines]
        self.body.append(
            f'<table:table table:name="C{tname}" table:style-name="{tname}">'
            f'<table:table-column table:style-name="{cn}"/><table:table-row>'
            f'<table:table-cell table:style-name="{cell}" office:value-type="string">{"".join(inner)}'
            f"</table:table-cell></table:table-row></table:table>"
        )

    def qa(self, pairs):
        for q, a in pairs:
            self.para("QaQ", q)
            self.para("QaA", a)

    def cover(self, doc: dict, has_img: bool):
        tname, cn, cell = self.uid(), self.uid(), self.uid()
        self.auto.append(
            f'<style:style style:name="{tname}" style:family="table">'
            f'<style:table-properties style:width="16.8cm" table:align="left" fo:margin-bottom="0.6cm"/></style:style>'
        )
        self.auto.append(
            f'<style:style style:name="{cn}" style:family="table-column">'
            f'<style:table-column-properties style:column-width="16.8cm"/></style:style>'
        )
        self.auto.append(
            f'<style:style style:name="{cell}" style:family="table-cell">'
            f'<style:table-cell-properties fo:background-color="{INK}" fo:padding-top="1.1cm" '
            f'fo:padding-bottom="1.1cm" fo:padding-left="0.9cm" fo:padding-right="0.9cm" fo:border="none"/></style:style>'
        )
        img = ""
        if has_img:
            img = (
                '<text:p text:style-name="CvImg">'
                '<draw:frame draw:name="maskot" text:anchor-type="as-char" svg:width="3.1cm" svg:height="3.1cm" '
                'draw:z-index="0"><draw:image xlink:href="Pictures/maskot.png" xlink:type="simple" '
                'xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>'
            )
        inner = (
            f'<text:p text:style-name="CvLabel">FIGURUNICA · PAZARLAMA KİTİ</text:p>'
            f'<text:p text:style-name="CvNum">{escape(doc["num"])}</text:p>'
            f'<text:p text:style-name="CvTitle">{escape(doc["title"])}</text:p>'
            f'<text:p text:style-name="CvSub">{self.spans(doc["subtitle"], white=True)}</text:p>'
            f'{img}'
            f'<text:p text:style-name="CvAud">{escape(doc["audience"])}</text:p>'
        )
        self.body.append(
            f'<table:table table:name="Cover" table:style-name="{tname}">'
            f'<table:table-column table:style-name="{cn}"/><table:table-row>'
            f'<table:table-cell table:style-name="{cell}" office:value-type="string">{inner}'
            f"</table:table-cell></table:table-row></table:table>"
        )
        self.kv([
            ["Doküman", f'{doc["num"]} — {doc["title"]}'],
            ["Sürüm", f'{BRAND["version"]} · {BRAND["date"]}'],
            ["Kaynak", "Canlı ürün kodundan doğrulanmış bilgiler (9 alan, 311 bulgu)"],
            ["Kullanım", "İç kullanım — pazarlama ve satış ekibi"],
        ])
        self.callout("warn", "Bu doküman müşteriye/partnere olduğu gibi verilmez.", [
            "İçinde “asla söylemeyin” bölümü ve netleştirilmemiş operasyonel sorular vardır. Dışarıya çıkacak "
            "materyali bu dokümandan **üretin**, dokümanı **paylaşmayın**.",
        ])


def build_odt(doc: dict, path: str):
    b = OdtBody()
    has_img = os.path.exists(MASCOT)
    b.cover(doc, has_img)

    # İçindekiler
    h1s = [x["x"] for x in doc["blocks"] if x["t"] == "h1"]
    b.body.append('<text:p text:style-name="H1PB">İçindekiler</text:p>')
    for i, h in enumerate(h1s, 1):
        b.para("TocItem", f"{i}.  {h}")

    pb = False
    for blk in doc["blocks"]:
        t = blk["t"]
        if t == "pb":
            pb = True
            continue
        if t == "h1":
            b.heading("H1PB" if pb else "H1", 1, blk["x"])
            pb = False
            continue
        if pb:
            b.body.append('<text:p text:style-name="H1PB"/>')
            pb = False
        if t == "h2":
            b.heading("H2", 2, blk["x"])
        elif t == "lead":
            b.para("Lead", blk["x"])
        elif t == "p":
            b.para("Body", blk["x"])
        elif t == "note":
            b.para("Note", blk["x"])
        elif t == "ul":
            b.lst(blk["x"])
        elif t == "ol":
            b.lst(blk["x"], ordered=True)
        elif t == "table":
            b.table(blk["head"], blk["rows"], blk["w"])
        elif t == "kv":
            b.kv(blk["x"])
        elif t == "callout":
            b.callout(blk["kind"], blk["title"], blk["x"])
        elif t == "quote":
            b.para("Quote", blk["x"])
        elif t == "qa":
            b.qa(blk["x"])
        else:
            raise ValueError(f"bilinmeyen blok: {t}")

    content = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<office:document-content {NS} office:version="1.3">'
        f"{FONT_DECLS}"
        f'<office:automatic-styles>{"".join(b.auto)}</office:automatic-styles>'
        f'<office:body><office:text>{"".join(b.body)}</office:text></office:body>'
        "</office:document-content>"
    )

    title = f'Figurunica — {doc["title"]}'
    meta = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<office:document-meta {NS} office:version="1.3"><office:meta>'
        f"<dc:title>{escape(title)}</dc:title>"
        f'<dc:subject>{escape(doc["audience"])}</dc:subject>'
        f"<dc:language>tr-TR</dc:language>"
        f'<meta:keyword>Figurunica</meta:keyword><meta:keyword>pazarlama</meta:keyword>'
        "</office:meta></office:document-meta>"
    )
    manifest_extra = (
        '<manifest:file-entry manifest:full-path="Pictures/maskot.png" manifest:media-type="image/png"/>'
        if has_img else ""
    )
    manifest = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" '
        'manifest:version="1.3">'
        '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" '
        'manifest:media-type="application/vnd.oasis.opendocument.text"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
        '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'
        f"{manifest_extra}"
        "</manifest:manifest>"
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.text",
                   compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/manifest.xml", manifest)
        z.writestr("content.xml", content)
        z.writestr("styles.xml", styles_xml())
        z.writestr("meta.xml", meta)
        if has_img:
            z.write(MASCOT, "Pictures/maskot.png")


# ════════════════════════════════════════════════════════════════════════ HTML

CSS = f"""
@page {{ size: A4; margin: 17mm 16mm 16mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "Inter","Liberation Sans",Arial,sans-serif; font-size: 10.5pt; line-height: 1.5;
       color: {INK}; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
h1 {{ font-size: 16.5pt; color: {DEEP}; margin: 22px 0 10px; padding-bottom: 5px;
      border-bottom: 2px solid {GLOW}; break-after: avoid; }}
h2 {{ font-size: 12pt; color: {TEAL}; margin: 16px 0 6px; break-after: avoid; }}
p {{ margin: 0 0 9px; }}
.lead {{ font-size: 11.5pt; color: {SECOND}; line-height: 1.6; margin-bottom: 14px; }}
.note {{ font-size: 9.5pt; font-style: italic; color: {MUTED}; margin: 4px 0 12px; }}
strong {{ color: {DEEP}; }}
ul, ol {{ margin: 4px 0 12px; padding-left: 22px; }}
ol {{ padding-left: 26px; }}
li {{ margin-bottom: 6px; line-height: 1.45; }}
li::marker {{ color: {CYAN}; font-weight: 700; }}
table {{ border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 9.5pt;
         break-inside: auto; }}
tr {{ break-inside: avoid; }}
th {{ background: {DEEP}; color: #fff; text-align: left; padding: 7px 8px; font-weight: 700; }}
td {{ padding: 7px 8px; border-bottom: 1px solid {LINE}; vertical-align: top; line-height: 1.4;
      white-space: pre-line; }}
tbody tr:nth-child(even) td {{ background: {SOFT}; }}
td:first-child:not(:only-child) {{ font-weight: 700; color: {DEEP}; }}
table.kv th {{ display: none; }}
table.kv td:first-child {{ width: 28%; }}
.quote {{ background: {SOFT}; border-left: 3px solid {CYAN}; padding: 14px 16px; margin: 10px 0 16px;
          font-size: 11.5pt; font-style: italic; color: {DEEP}; line-height: 1.6; break-inside: avoid; }}
.qa {{ break-inside: avoid; margin-bottom: 12px; }}
.qa .q {{ font-weight: 700; color: {DEEP}; margin-bottom: 3px; }}
.qa .a {{ margin: 0 0 0 12px; }}
.co {{ padding: 14px 16px; margin: 10px 0 16px; border-left: 4px solid; break-inside: avoid; }}
.co .t {{ font-weight: 700; margin-bottom: 6px; font-size: 10.5pt; }}
.co p {{ font-size: 10pt; margin-bottom: 5px; }}
.co p:last-child {{ margin-bottom: 0; }}
.pb {{ break-before: page; }}

/* kapak */
.cover {{ break-after: page; }}
.panel {{ background: {INK}; color: #fff; padding: 34px 32px; border-radius: 3px;
          background-image: radial-gradient(circle at 88% 12%, rgba(0,212,255,.20), transparent 55%); }}
.panel .label {{ font-size: 9pt; font-weight: 700; color: {GLOW}; letter-spacing: .18em; margin-bottom: 14px; }}
.panel .num {{ font-size: 44pt; font-weight: 800; color: {GLOW}; line-height: 1; margin-bottom: 4px; }}
.panel .title {{ font-size: 30pt; font-weight: 800; color: #fff; line-height: 1.1; margin-bottom: 10px; }}
.panel .sub {{ font-size: 11.5pt; color: #CDF6FD; line-height: 1.5; max-width: 92%; margin-bottom: 18px; }}
.panel .aud {{ font-size: 10pt; font-weight: 700; color: {GLOW}; }}
.panel img {{ display: block; width: 118px; height: 118px; margin: 18px auto 14px; }}
.toc {{ break-before: page; }}
.toc ol {{ padding-left: 28px; }}
.toc li {{ margin-bottom: 7px; font-size: 10.5pt; }}
"""


def h_inline(text: str) -> str:
    out = []
    for chunk, bold in split_bold(text):
        e = escape(chunk).replace("\n", "<br>")
        out.append(f"<strong>{e}</strong>" if bold else e)
    return "".join(out)


def build_html(doc: dict, path: str):
    img = ""
    if os.path.exists(MASCOT):
        b64 = base64.b64encode(open(MASCOT, "rb").read()).decode()
        img = f'<img src="data:image/png;base64,{b64}" alt="">'

    h = [f'<meta charset="utf-8"><title>Figurunica — {escape(doc["title"])}</title><style>{CSS}</style>']
    h.append(
        f'<div class="cover"><div class="panel">'
        f'<div class="label">FIGURUNICA · PAZARLAMA KİTİ</div>'
        f'<div class="num">{escape(doc["num"])}</div>'
        f'<div class="title">{escape(doc["title"])}</div>'
        f'<div class="sub">{h_inline(doc["subtitle"])}</div>'
        f"{img}"
        f'<div class="aud">{escape(doc["audience"])}</div></div>'
        f'<table class="kv"><tbody>'
        f'<tr><td>Doküman</td><td>{escape(doc["num"])} — {escape(doc["title"])}</td></tr>'
        f'<tr><td>Sürüm</td><td>{escape(BRAND["version"])} · {escape(BRAND["date"])}</td></tr>'
        f"<tr><td>Kaynak</td><td>Canlı ürün kodundan doğrulanmış bilgiler (9 alan, 311 bulgu)</td></tr>"
        f"<tr><td>Kullanım</td><td>İç kullanım — pazarlama ve satış ekibi</td></tr>"
        f"</tbody></table>"
        f'<div class="co" style="background:{KINDS["warn"][0]};border-color:{KINDS["warn"][1]}">'
        f'<div class="t" style="color:{KINDS["warn"][2]}">Bu doküman müşteriye/partnere olduğu gibi verilmez.</div>'
        f"<p>İçinde “asla söylemeyin” bölümü ve netleştirilmemiş operasyonel sorular vardır. Dışarıya çıkacak "
        f"materyali bu dokümandan <strong>üretin</strong>, dokümanı <strong>paylaşmayın</strong>.</p></div>"
        f"</div>"
    )

    h1s = [x["x"] for x in doc["blocks"] if x["t"] == "h1"]
    h.append('<div class="toc"><h1>İçindekiler</h1><ol>')
    h += [f"<li>{escape(x)}</li>" for x in h1s]
    h.append("</ol></div>")

    pb = False
    for blk in doc["blocks"]:
        t = blk["t"]
        cls = ' class="pb"' if pb else ""
        if t == "pb":
            pb = True
            continue
        pb = False
        if t == "h1":
            h.append(f"<h1{cls}>{h_inline(blk['x'])}</h1>")
        elif t == "h2":
            h.append(f"<h2{cls}>{h_inline(blk['x'])}</h2>")
        elif t == "lead":
            h.append(f'<p class="lead">{h_inline(blk["x"])}</p>')
        elif t == "p":
            h.append(f"<p>{h_inline(blk['x'])}</p>")
        elif t == "note":
            h.append(f'<p class="note">{h_inline(blk["x"])}</p>')
        elif t in ("ul", "ol"):
            items = "".join(f"<li>{h_inline(i)}</li>" for i in blk["x"])
            h.append(f"<{t}>{items}</{t}>")
        elif t == "table":
            th = "".join(f"<th>{h_inline(c)}</th>" for c in blk["head"])
            rows = "".join(
                "<tr>" + "".join(f"<td>{h_inline(c)}</td>" for c in r) + "</tr>" for r in blk["rows"]
            )
            head = f"<thead><tr>{th}</tr></thead>" if any(blk["head"]) else ""
            h.append(f"<table>{head}<tbody>{rows}</tbody></table>")
        elif t == "kv":
            rows = "".join(f"<tr><td>{h_inline(k)}</td><td>{h_inline(v)}</td></tr>" for k, v in blk["x"])
            h.append(f'<table class="kv"><tbody>{rows}</tbody></table>')
        elif t == "callout":
            bg, ac, fg = KINDS[blk["kind"]]
            body = "".join(f"<p>{h_inline(l)}</p>" for l in blk["x"])
            h.append(f'<div class="co" style="background:{bg};border-color:{ac}">'
                     f'<div class="t" style="color:{fg}">{h_inline(blk["title"])}</div>{body}</div>')
        elif t == "quote":
            h.append(f'<div class="quote">{h_inline(blk["x"])}</div>')
        elif t == "qa":
            for q, a in blk["x"]:
                h.append(f'<div class="qa"><div class="q">{h_inline(q)}</div>'
                         f'<div class="a">{h_inline(a)}</div></div>')

    open(path, "w", encoding="utf-8").write("\n".join(h))


def main():
    if os.path.isdir(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    for doc in DOCS:
        odt = os.path.join(OUT_DIR, doc["slug"] + ".odt")
        html = os.path.join(BUILD_DIR, doc["slug"] + ".html")
        build_odt(doc, odt)
        build_html(doc, html)
        print(f"  ✓ {doc['slug']}.odt  ({os.path.getsize(odt) // 1024} KB)")
    print(f"\nODT → {OUT_DIR}\nHTML → {BUILD_DIR}  (PDF için: node scripts/marketing-docs/render_pdf.mjs)")


if __name__ == "__main__":
    main()
