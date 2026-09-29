#!/usr/bin/env python3
"""Build the in-system help: catalog, menu PDFs and manuals.

Sources (edit these, then run  python3 docs/tools/build_help.py):
  docs/tools/help_fields.py        caption -> what it does / its effect
  docs/tools/help_pages_entry.py   entry screens: purpose, steps, effects
  docs/tools/help_pages_other.py   masters, setup, reports, industry modules
  docs/USER_MANUAL.md, DEVELOPER_GUIDE.md, IRD_ARCHITECTURE.md,
  IRD_USER_MANUAL.md, AUDIT_ROUND16.md

Output:
  client/public/help/helpCatalog.json read (once, on demand) by the Help
                                     panel and the caption tooltips of every form
  client/public/help/menus/<slug>.pdf one PDF per menu screen
  client/public/help/*.pdf           manuals (complete, per business nature,
                                     IRD architecture, IRD user manual,
                                     developer guide, audit)
  client/public/help/index.json      list of the PDFs (Help Center)
  docs/pdf/                          copies of the manuals (kept in the code)
The field list of each screen is read from its page source (erp-label
captions), so a new field on a form shows up in its help automatically.
"""
import json
import os
import re
import shutil
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_pdfs  # noqa: E402  (styles and the markdown renderer)
from help_fields import FIELDS, ALIASES  # noqa: E402
from help_pages_entry import PAGES as ENTRY_PAGES, ALL  # noqa: E402
from help_pages_other import PAGES as OTHER_PAGES  # noqa: E402

from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
CLIENT = os.path.join(ROOT, 'client', 'src')
PUBLIC = os.path.join(ROOT, 'client', 'public', 'help')
DOCS = os.path.join(ROOT, 'docs')

NATURES = [('trading', 'Trading'), ('distribution', 'Distribution'), ('retail', 'Retail'), ('manufacturing', 'Manufacturing'),
           ('service', 'Service'), ('automobile', 'Automobile Dealer & Workshop'), ('construction', 'Construction / Contractor'),
           ('poultry', 'Poultry & Hatchery')]
MODULE_ORDER = ['Sales', 'Purchase', 'Accounts', 'Inventory', 'Production', 'Masters', 'Setup', 'Accounts Report', 'Sales/Purchase',
                'Analysis', 'Office', 'Tools', 'Poultry', 'Construction', 'Automobile']

# line grid captions of the sales / purchase entries (the grid is a shared component)
GRID = ['Item Code', 'Item Name', 'Qty', 'Free Qty', 'UOM', 'Alt Qty', 'Rate', 'Rate Basis', 'Gross', 'Add / Less', 'Net Amount', 'Batch',
        'Serial No', 'Exp Date', 'Warehouse', 'Ref No (source doc)']
GRID_PAGES = {'/sales-quotation', '/sales-order', '/sales-delivery', '/sales-bill', '/sales-return', '/sales-nonsaleable-return',
              '/purchase-quotation', '/purchase-order', '/purchase-grn', '/purchase-bill', '/purchase-return', '/purchase-nonsaleable-return'}
EXTRA_FIELDS = {
    '/sales-bill': ['Quotation No.', 'Order No.', 'Challan No.', 'Base', 'TDS %', 'TDS Amount', 'TDS Ledger', 'TDS Sub-Ledger'],
    '/sales-order': ['Quotation No.'], '/sales-delivery': ['Quotation No.', 'Order No.'], '/sales-return': ['Bill No.'], '/sales-nonsaleable-return': ['Bill No.'],
    '/purchase-quotation': ['Order No.'], '/purchase-order': ['Quotation No.'], '/purchase-grn': ['Quotation No.', 'Order No.'],
    '/purchase-bill': ['Quotation No.', 'Order No.', 'GRN No.', 'Party Bill No', 'Party Bill Date', 'TDS %', 'TDS Amount', 'TDS Ledger'],
    '/purchase-return': ['Bill No.'], '/purchase-nonsaleable-return': ['Bill No.'],
}


def slug(path):
    return re.sub(r'[^a-z0-9]+', '-', path.lower()).strip('-') or 'home'


def norm(label):
    t = re.sub(r'\s+', ' ', label.replace('&amp;', '&')).strip().rstrip('*').strip()
    return ALIASES.get(t, t)


def field_text(label):
    return FIELDS.get(norm(label))


def route_files():
    """path -> page source file, from App.js"""
    app = open(os.path.join(CLIENT, 'App.js'), encoding='utf-8').read()
    imports = {m.group(1): m.group(2) for m in re.finditer(r"import (\w+) from '\./pages/([^']+)'", app)}
    out = {}
    for m in re.finditer(r'<Route path="([^"]+)" element=\{<PrivateRoute><(\w+)', app):
        comp = imports.get(m.group(2))
        if not comp:
            continue
        for ext in ('.jsx', '.tsx', '.js', '.ts'):
            f = os.path.join(CLIENT, 'pages', comp + ext)
            if os.path.exists(f):
                out[m.group(1)] = f
                break
    return out


def labels_of(path_file):
    if not path_file:
        return []
    s = open(path_file, encoding='utf-8').read()
    labs = []
    for m in re.finditer(r'className="erp-label"[^>]*>([^<{]+)', s):
        t = norm(m.group(1))
        if t and len(t) < 60 and t not in labs:
            labs.append(t)
    return labs


def catalog():
    files = route_files()
    pages = {}
    for p in ENTRY_PAGES + OTHER_PAGES:
        if p['path'] in pages:          # the entry screen description wins over a duplicate report entry
            continue
        labs = labels_of(files.get(p['path']))
        labs += [x for x in EXTRA_FIELDS.get(p['path'], []) if x not in labs]
        if p['path'] in GRID_PAGES:
            labs += [x for x in GRID if x not in labs]
        fields = [[l, field_text(l)] for l in labs if field_text(l)]
        pages[p['path']] = dict(p, fields=fields, slug=slug(p['path']), pdf='/help/menus/%s.pdf' % slug(p['path']),
                                nature=p.get('nature') or ALL)
    return pages


# ---------------------------------------------------------------- markdown
def page_md(p, level=2):
    h = '#' * level
    out = ['%s %s' % (h, p['title']), '', '**Menu:** %s  ·  **Type:** %s' % (p['module'], p['kind']), '', p['purpose'], '']
    if p.get('steps'):
        out += ['%s# How to use' % h, ''] + ['%d. %s' % (i + 1, s) for i, s in enumerate(p['steps'])] + ['']
    eff = [('Accounts', p.get('accounts')), ('Stock', p.get('stock')), ('VAT', p.get('vat')), ('Other modules', p.get('other'))]
    eff = [(k, v) for k, v in eff if v]
    if eff:
        out += ['%s# Effect' % h, '', '| Where | What happens |', '|---|---|'] + ['| %s | %s |' % (k, v.replace('|', '/')) for k, v in eff] + ['']
    if p.get('fields'):
        out += ['%s# Fields on this screen' % h, '', '| Field | What it does / where its effect goes |', '|---|---|']
        out += ['| %s | %s |' % (l.replace('|', '/'), t.replace('|', '/')) for l, t in p['fields']] + ['']
    if p.get('views'):
        out += ['%s# Views' % h, ''] + ['- **%s**: %s' % (k, v) for k, v in p['views'].items()] + ['']
    if p.get('tips'):
        out += ['%s# Tips' % h, ''] + ['- %s' % t for t in p['tips']] + ['']
    return '\n'.join(out)


def build_md(md, dst, title, subtitle, cover=True):
    """render markdown with the styles of build_pdfs; a short one-screen PDF has no cover"""
    doc = SimpleDocTemplate(dst, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title='Aakash Business ERP - ' + title, author='Aakash Business ERP')
    body, toc = build_pdfs.parse(md, doc.width)
    head = []
    if cover:
        head = [Spacer(1, 60 * mm), Paragraph('Aakash Business ERP', build_pdfs.SUB), Spacer(1, 6), Paragraph(build_pdfs.inline(title), build_pdfs.TITLE),
                Paragraph(build_pdfs.inline(subtitle), build_pdfs.SUB), Spacer(1, 12), Paragraph('Edition: %s' % date.today().strftime('%d %B %Y'), build_pdfs.SUB)]
        from reportlab.platypus import PageBreak
        head += [PageBreak(), Paragraph('Contents', build_pdfs.H1)]
        head += [Paragraph(build_pdfs.inline(t), build_pdfs.BODY) for t in toc] + [PageBreak()]
    else:
        head = [Paragraph('Aakash Business ERP - screen help', build_pdfs.SUB), Paragraph(build_pdfs.inline(title), build_pdfs.H1)]

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.drawString(d.leftMargin, 8 * mm, 'Aakash Business ERP - ' + build_pdfs.plain(title))
        canvas.drawRightString(d.leftMargin + d.width, 8 * mm, 'Page %d' % d.page)
        canvas.restoreState()
    doc.build(head + body, onFirstPage=footer, onLaterPages=footer)


def by_module(pages):
    groups = {}
    for p in pages:
        groups.setdefault(p['module'], []).append(p)
    return sorted(groups.items(), key=lambda kv: MODULE_ORDER.index(kv[0]) if kv[0] in MODULE_ORDER else 99)


def nature_manual(key, label, pages):
    mine = [p for p in pages.values() if key in p['nature']]
    intro = open(os.path.join(DOCS, 'USER_MANUAL.md'), encoding='utf-8').read().split('\n## ')[0]
    md = [intro, '', '## About this manual', '',
          'This manual is for a company whose Business Nature (Setup > System Control) is **%s**. It lists every screen that company uses, '
          'how to use it and what it does to the accounts, stock and VAT. Industry screens of other business natures are left out.' % label, '']
    for mod, ps in by_module(mine):
        md += ['## %s' % mod, '']
        for p in sorted(ps, key=lambda x: x['title']):
            md += [page_md(p, 3), '']
    return '\n'.join(md), len(mine)


def main():
    pages = catalog()
    os.makedirs(PUBLIC, exist_ok=True)
    fields = {k: v for k, v in FIELDS.items()}
    with open(os.path.join(PUBLIC, 'helpCatalog.json'), 'w', encoding='utf-8') as f:
        json.dump({'pages': pages, 'fields': fields, 'aliases': ALIASES}, f, ensure_ascii=False, indent=0)

    menus_dir = os.path.join(PUBLIC, 'menus')
    os.makedirs(menus_dir, exist_ok=True)
    for p in pages.values():
        build_md(page_md(p, 2).split('\n', 1)[1], os.path.join(menus_dir, p['slug'] + '.pdf'), p['title'], p['purpose'], cover=False)

    manuals = []

    def add(name, title, sub, md=None, src=None, audience='all', group='Manuals'):
        dst = os.path.join(PUBLIC, name)
        text = md if md is not None else open(os.path.join(DOCS, src), encoding='utf-8').read()
        build_md(text, dst, title, sub)
        shutil.copyfile(dst, os.path.join(DOCS, 'pdf', name))
        manuals.append(dict(file='/help/' + name, title=title, subtitle=sub, audience=audience, group=group))

    # complete manual: the user manual + every screen
    full = open(os.path.join(DOCS, 'USER_MANUAL.md'), encoding='utf-8').read() + '\n\n## Screen reference\n\n'
    for mod, ps in by_module(pages.values()):
        full += '### %s\n\n' % mod
        for p in sorted(ps, key=lambda x: x['title']):
            full += page_md(p, 4) + '\n\n'
    add('Aakash_ERP_User_Manual.pdf', 'User Manual (complete)', 'Every menu and every screen - how to use it and its effect on accounts, stock and VAT', md=full)
    for key, label in NATURES:
        md, n = nature_manual(key, label, pages)
        add('User_Manual_%s.pdf' % key.capitalize(), 'User Manual - %s' % label, '%d screens used by a %s company' % (n, label.lower()), md=md, group='Manuals by business nature')
    add('IRD_System_Architecture.pdf', 'IRD Billing - System Architecture', 'Components, data flow, database controls and CBMS integration', src='IRD_ARCHITECTURE.md', group='IRD billing')
    add('IRD_User_Manual.pdf', 'IRD Billing - User Manual', 'Setup, daily work, CBMS sync and month end', src='IRD_USER_MANUAL.md', group='IRD billing')
    add('Aakash_ERP_Developer_Guide.pdf', 'Developer Guide', 'Architecture, posting logic and module reference', src='DEVELOPER_GUIDE.md', audience='admin', group='Developer')
    add('Audit_Round16.pdf', 'Logic Audit - Round 16', 'What was checked, compared with other ERPs and fixed', src='AUDIT_ROUND16.md', audience='admin', group='Developer')

    index = dict(built=date.today().isoformat(), manuals=manuals,
                 menus=[dict(path=p['path'], title=p['title'], module=p['module'], pdf=p['pdf'], nature=p['nature']) for p in pages.values()])
    with open(os.path.join(PUBLIC, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=0)
    print('catalog: %d screens, %d field captions' % (len(pages), len(fields)))
    print('menu PDFs: %d, manuals: %d' % (len(pages), len(manuals)))
    return pages


if __name__ == '__main__':
    main()
