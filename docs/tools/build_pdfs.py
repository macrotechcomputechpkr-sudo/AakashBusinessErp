#!/usr/bin/env python3
"""Build docs/pdf/*.pdf from docs/DEVELOPER_GUIDE.md and docs/USER_MANUAL.md.

A small Markdown reader (headings, paragraphs, nested lists, tables,
block quotes, code blocks, **bold** and `code`) rendered with reportlab.
Run from anywhere:  python3 docs/tools/build_pdfs.py
"""
import os
import re
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, Preformatted, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(DOCS, 'pdf')
BOOKS = [
    ('DEVELOPER_GUIDE.md', 'Aakash_ERP_Developer_Guide.pdf', 'Developer Guide', 'Architecture, posting logic and module reference'),
    ('USER_MANUAL.md', 'Aakash_ERP_User_Manual.pdf', 'User Manual', 'Every menu, how to use it, and its effect on accounts and stock'),
]
INK, ACCENT, SOFT, RULE = colors.HexColor('#1f2937'), colors.HexColor('#0f5e7a'), colors.HexColor('#eef5f8'), colors.HexColor('#b8cdd6')

# characters the built-in fonts do not have
PLAIN = {'→': '->', '←': '<-', '—': '-', '–': '-', '≤': '<=', '≥': '>=', '×': 'x', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"'}

ss = getSampleStyleSheet()
BODY = ParagraphStyle('body', parent=ss['BodyText'], fontName='Helvetica', fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=4)
CELL = ParagraphStyle('cell', parent=BODY, fontSize=8.3, leading=10.8, spaceAfter=0)
HEAD_CELL = ParagraphStyle('hcell', parent=CELL, fontName='Helvetica-Bold', textColor=colors.white)
H1 = ParagraphStyle('h1', parent=BODY, fontName='Helvetica-Bold', fontSize=18, leading=22, textColor=ACCENT, spaceBefore=4, spaceAfter=8)
H2 = ParagraphStyle('h2', parent=BODY, fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=ACCENT, spaceBefore=12, spaceAfter=6)
H3 = ParagraphStyle('h3', parent=BODY, fontName='Helvetica-Bold', fontSize=11.5, leading=15, textColor=INK, spaceBefore=9, spaceAfter=4)
H4 = ParagraphStyle('h4', parent=BODY, fontName='Helvetica-Bold', fontSize=10, leading=13, spaceBefore=6, spaceAfter=3)
NOTE = ParagraphStyle('note', parent=BODY, fontSize=9, leading=12.5, leftIndent=8, rightIndent=4, spaceAfter=0)
CODE = ParagraphStyle('code', parent=BODY, fontName='Courier', fontSize=8, leading=10.5, leftIndent=6, backColor=SOFT, borderPadding=5, spaceBefore=4, spaceAfter=8)
TITLE = ParagraphStyle('title', parent=H1, fontSize=30, leading=36, alignment=TA_CENTER, spaceAfter=10)
SUB = ParagraphStyle('sub', parent=BODY, fontSize=12, leading=16, alignment=TA_CENTER, textColor=colors.HexColor('#4b5563'))


def plain(text):
    for k, v in PLAIN.items():
        text = text.replace(k, v)
    return text


def inline(text):
    """Markdown inline -> reportlab paragraph markup."""
    parts = re.split(r'(`[^`]+`)', plain(text))
    out = []
    for p in parts:
        if p.startswith('`') and p.endswith('`') and len(p) > 1:
            out.append('<font face="Courier" color="#7a2e0e">%s</font>' % escape(p[1:-1]))
        else:
            s = escape(p)
            s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
            s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', s)
            out.append(s)
    return ''.join(out)


def table(rows, width):
    head, body = rows[0], rows[1:]
    n = len(head)
    # share width by the longest text in each column (bounded)
    lens = [max(len(r[i]) if i < len(r) else 0 for r in rows) for i in range(n)]
    lens = [min(max(l, 6), 70) for l in lens]
    total = float(sum(lens))
    widths = [width * l / total for l in lens]
    data = [[Paragraph(inline(c), HEAD_CELL) for c in head]]
    for r in body:
        r = (r + [''] * n)[:n]
        data.append([Paragraph(inline(c), CELL) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, SOFT]),
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


def note(lines, width):
    """A block quote: 'Accounts / Stock effect' boxes and other notes."""
    paras, chunk = [], []

    def flush():
        if chunk:
            paras.append(Paragraph(inline(' '.join(chunk)), NOTE))
            del chunk[:]
    for l in lines + ['']:
        l = l.strip()
        if l.startswith('- '):
            flush()
            paras.append(Paragraph(inline(l[2:]), ParagraphStyle('nli', parent=NOTE, leftIndent=20, bulletIndent=10), bulletText='•'))
        elif l:
            chunk.append(l)
        else:
            flush()
    t = Table([[paras]], colWidths=[width])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f3f8ee')),
        ('LINEBEFORE', (0, 0), (0, -1), 3, colors.HexColor('#4f8a2b')),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


def parse(md, width):
    story, toc = [], []
    lines = md.split('\n')
    i = 0
    first_h1 = True
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                block.append(plain(lines[i]))
                i += 1
            story.append(Preformatted('\n'.join(block), CODE))
            i += 1
            continue
        m = re.match(r'^(#{1,4})\s+(.*)', s)
        if m:
            level, text = len(m.group(1)), m.group(2)
            if level == 1:
                if first_h1:          # the document title is on the cover page
                    first_h1 = False
                    i += 1
                    continue
                story.append(Paragraph(inline(text), H1))
            elif level == 2:
                toc.append(text)
                story.append(PageBreak() if len(toc) > 1 else Spacer(1, 1))
                story.append(Paragraph(inline(text), H1))
            else:
                story.append(Paragraph(inline(text), H2 if level == 3 else H3))
            i += 1
            continue
        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.match(r'^:?-{2,}:?$', c) for c in cells if c):
                    rows.append(cells)
                i += 1
            story.append(table(rows, width))
            story.append(Spacer(1, 6))
            continue
        if s.startswith('>'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                block.append(lines[i].strip()[1:].lstrip())
                i += 1
            story.append(KeepTogether([note(block, width)]))
            story.append(Spacer(1, 6))
            continue
        lm = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)', line)
        if lm:
            while i < len(lines):
                lm = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)', lines[i])
                if not lm:
                    # a wrapped continuation line belongs to the previous item
                    if lines[i].strip() and lines[i].startswith('  ') and story:
                        i += 1
                        continue
                    break
                depth = len(lm.group(1)) // 2
                bullet = lm.group(2) if lm.group(2)[0].isdigit() else ('•' if depth == 0 else '-')
                st = ParagraphStyle('li%d' % depth, parent=BODY, leftIndent=14 + depth * 14, bulletIndent=4 + depth * 14, spaceAfter=2)
                story.append(Paragraph(inline(lm.group(3)), st, bulletText=bullet))
                i += 1
            story.append(Spacer(1, 4))
            continue
        para = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||>|```|\s*([-*]|\d+\.)\s)', lines[i].strip()):
            para.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(' '.join(para)), BODY))
    return story, toc


def build(src, dst, title, subtitle):
    with open(os.path.join(DOCS, src), encoding='utf-8') as f:
        md = f.read()
    doc = SimpleDocTemplate(dst, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=16 * mm,
                            title='Aakash Business ERP - ' + title, author='Aakash Business ERP')
    width = doc.width
    body, toc = parse(md, width)
    cover = [Spacer(1, 70 * mm), Paragraph('Aakash Business ERP', SUB), Spacer(1, 6), Paragraph(title, TITLE),
             Paragraph(subtitle, SUB), Spacer(1, 12), Paragraph('Edition: %s' % date.today().strftime('%d %B %Y'), SUB), PageBreak(),
             Paragraph('Contents', H1)]
    cover += [Paragraph(inline(t), ParagraphStyle('toc', parent=BODY, fontSize=10.5, leading=16)) for t in toc]
    cover.append(PageBreak())

    def footer(canvas, d):
        if d.page == 1:
            return
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(colors.HexColor('#6b7280'))
        canvas.drawString(d.leftMargin, 9 * mm, 'Aakash Business ERP - ' + title)
        canvas.drawRightString(d.leftMargin + d.width, 9 * mm, 'Page %d' % d.page)
        canvas.setStrokeColor(RULE)
        canvas.line(d.leftMargin, 12 * mm, d.leftMargin + d.width, 12 * mm)
        canvas.restoreState()

    doc.build(cover + body, onFirstPage=footer, onLaterPages=footer)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for src, name, title, subtitle in BOOKS:
        dst = os.path.join(OUT, name)
        build(src, dst, title, subtitle)
        print('built', os.path.relpath(dst, os.path.dirname(DOCS)))
