// =============================================
// grid/gridAnalysis.js
// The number crunching behind ReportGrid's analysis features, kept free of
// React so it can be tested on its own (scratch tests r41):
//   * toNum          - "1,23,456.50", "2,000 Cr", "13%" -> number (Cr = minus)
//   * bucketOf       - a date value by month / year (BS or AD, "2081-04-15")
//   * aggregate      - Sum / Average / Count / Min / Max / Distinct of values
//   * buildChartData - rows -> categories x series for the 📊 Chart panel and
//                      its pivot table (Top N + "Other", split by a column,
//                      row / column / grand totals that stay right for
//                      Average, Min and Max too)
//   * calcColumns    - the added columns: running balance, % of total, formula
//   * compareRows    - multi-level sort
//   * buildPivot     - the pivot view: row fields (a tree with sub-totals) x
//                      column fields (their values become columns) x values
//                      (Sum / Average / Count … of number fields)
// =============================================

export const AGG_LABELS = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count', distinct: 'Distinct', first: 'First', last: 'Last' };
const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
export const BLANK_LABEL = '(Blanks)';
export const OTHER_LABEL = 'Other';

/** a number from a report cell, or null. Numbers with "Cr" at the end are credits (minus). */
export function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v === null || v === undefined) return null;
    const raw = String(v).trim();
    if (!raw) return null;
    let s = raw.replace(/,/g, '').replace(/^(Rs\.?|NPR|₹)\s*/i, '').replace(/%$/, '').trim();
    let sign = 1;
    const drcr = s.match(/^(.*?)\s*(Dr|Cr)\.?$/i);
    if (drcr) { s = drcr[1].trim(); if (/cr/i.test(drcr[2])) sign = -1; }
    if (/^\(.*\)$/.test(s)) { s = s.slice(1, -1); sign = -sign; }        // (1,000) = minus
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s) * sign;
}
export const isDateLike = v => DATE_RE.test(String(v ?? '').trim());

/** the chart category of a value: as it is, or its month / year when it is a date */
export function bucketOf(v, bucket) {
    const s = String(v ?? '').trim();
    if (!s) return BLANK_LABEL;
    if (bucket === 'month' || bucket === 'year') {
        const m = s.match(DATE_RE);
        if (!m) return s;
        return bucket === 'year' ? m[1] : `${m[1]}-${m[2].padStart(2, '0')}`;
    }
    return s;
}

// ---- accumulators: merged exactly, so totals of averages / min / max are right ----
export const newAcc = () => ({ sum: 0, n: 0, cnt: 0, min: Infinity, max: -Infinity, set: new Set() });
export function addTo(a, raw) {
    a.cnt += 1;
    a.set.add(String(raw ?? ''));
    const v = toNum(raw);
    if (v !== null) { a.sum += v; a.n += 1; if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
}
export function mergeAcc(into, b) {
    into.sum += b.sum; into.n += b.n; into.cnt += b.cnt;
    if (b.min < into.min) into.min = b.min;
    if (b.max > into.max) into.max = b.max;
    b.set.forEach(x => into.set.add(x));
    return into;
}
export function accResult(a, agg) {
    if (!a) return 0;
    switch (agg) {
        case 'avg': return a.n ? a.sum / a.n : 0;
        case 'count': return a.cnt;
        case 'distinct': return a.set.size;
        case 'min': return a.n ? a.min : 0;
        case 'max': return a.n ? a.max : 0;
        default: return a.sum;
    }
}

/** footer / group aggregate of a list of cell values (null = no aggregate) */
export function aggregate(values, type) {
    if (!type || type === 'none') return null;
    if (type === 'first') return values.length ? values[0] : '—';
    if (type === 'last') return values.length ? values[values.length - 1] : '—';
    const a = newAcc();
    values.forEach(v => addTo(a, v));
    if ((type === 'avg' || type === 'min' || type === 'max') && !a.n) return '—';
    return accResult(a, type);
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareValues(a, b) {
    const na = toNum(a), nb = toNum(b);
    if (na !== null && nb !== null) return na - nb;
    const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === '';
    if (ea !== eb) return ea ? 1 : -1;                    // blanks last
    return natural.compare(String(a ?? ''), String(b ?? ''));
}
/** multi-level sort: [{ key, dir }] */
export function compareRows(sorts) {
    return (x, y) => {
        for (const s of sorts) {
            const c = compareValues(x[s.key], y[s.key]);
            if (c) return s.dir === 'desc' ? -c : c;
        }
        return 0;
    };
}

/**
 * rows -> chart / pivot data.
 * cfg: { x, bucket: 'none'|'month'|'year', values: [keys], split: key|'', agg, top: number (0 = all),
 *        order: 'value'|'label'|'as_is', seriesTop: number }
 * Returns { categories, series: [{ name, values }], rowTotals, colTotals, grand, measureNames }.
 */
export function buildChartData(rows, cfg, labelOf = k => k) {
    const { x, bucket = 'none', split = '', agg = 'sum', top = 12, order = 'value', seriesTop = 7 } = cfg || {};
    const countish = agg === 'count' || agg === 'distinct';
    const measures = (cfg?.values || []).filter(Boolean);
    const empty = { categories: [], series: [], rowTotals: [], colTotals: [], grand: 0, measureNames: [] };
    if (!x || (!measures.length && !countish)) return empty;
    const ms = measures.length ? measures : ['__row'];
    const valueOf = (row, m) => (m === '__row' ? 1 : row[m]);

    // category -> seriesName -> acc ; keeps first-seen order
    const cats = new Map();
    const serNames = [];
    const serSeen = new Set();
    const serOf = (row, m) => {
        if (split) return bucketOf(row[split], 'none');
        return m === '__row' ? 'Rows' : labelOf(m);
    };
    rows.forEach(row => {
        const c = bucketOf(row[x], bucket);
        if (!cats.has(c)) cats.set(c, new Map());
        const byS = cats.get(c);
        (split ? [ms[0]] : ms).forEach(m => {
            const s = serOf(row, m);
            if (!serSeen.has(s)) { serSeen.add(s); serNames.push(s); }
            if (!byS.has(s)) byS.set(s, newAcc());
            addTo(byS.get(s), valueOf(row, m));
        });
    });

    // series: split values -> the biggest `seriesTop`, the rest in "Other"
    let seriesList = serNames;
    if (split && serNames.length > seriesTop + 1) {
        const tot = new Map(serNames.map(s => [s, 0]));
        cats.forEach(byS => byS.forEach((a, s) => tot.set(s, tot.get(s) + Math.abs(accResult(a, agg)))));
        const keep = [...serNames].sort((a, b) => tot.get(b) - tot.get(a)).slice(0, seriesTop);
        const keepSet = new Set(keep);
        seriesList = [...serNames.filter(s => keepSet.has(s)), OTHER_LABEL];
        cats.forEach(byS => {
            const other = newAcc();
            let any = false;
            Array.from(byS.keys()).forEach(s => { if (!keepSet.has(s)) { mergeAcc(other, byS.get(s)); byS.delete(s); any = true; } });
            if (any) byS.set(OTHER_LABEL, other);
        });
    }

    const rowAcc = byS => { const a = newAcc(); byS.forEach(v => mergeAcc(a, v)); return a; };
    let entries = Array.from(cats.entries());
    const rank = e => Math.abs(accResult(rowAcc(e[1]), agg));
    // categories: the biggest `top`, the rest folded into "Other"
    if (top > 0 && entries.length > top) {
        const sortedByValue = [...entries].sort((a, b) => rank(b) - rank(a));
        const keep = new Set(sortedByValue.slice(0, top - 1).map(e => e[0]));
        const other = new Map();
        entries.forEach(([c, byS]) => {
            if (keep.has(c)) return;
            byS.forEach((a, s) => { if (!other.has(s)) other.set(s, newAcc()); mergeAcc(other.get(s), a); });
        });
        entries = entries.filter(e => keep.has(e[0]));
        if (order === 'value') entries.sort((a, b) => rank(b) - rank(a));
        else if (order === 'label') entries.sort((a, b) => compareValues(a[0], b[0]));
        entries.push([OTHER_LABEL, other]);
    } else if (order === 'value') entries.sort((a, b) => rank(b) - rank(a));
    else if (order === 'label') entries.sort((a, b) => compareValues(a[0], b[0]));

    const categories = entries.map(e => e[0]);
    const series = seriesList.map(s => ({ name: s, values: entries.map(([, byS]) => accResult(byS.get(s), agg)) }));
    const rowTotals = entries.map(([, byS]) => accResult(rowAcc(byS), agg));
    const colTotals = seriesList.map(s => { const a = newAcc(); entries.forEach(([, byS]) => { if (byS.has(s)) mergeAcc(a, byS.get(s)); }); return accResult(a, agg); });
    const all = newAcc();
    entries.forEach(([, byS]) => mergeAcc(all, rowAcc(byS)));
    return { categories, series, rowTotals, colTotals, grand: accResult(all, agg), measureNames: seriesList };
}

/** added (display-only) columns: running balance, % of total, formula, blank text */
export function calcColumns(rows, customColumns) {
    if (!customColumns.length) return rows;
    const totals = {};
    customColumns.forEach(c => {
        if ((c.calc || c.type) === 'percent_of_total') totals[c.key] = rows.reduce((s, r) => s + (toNum(r[c.sourceKey]) || 0), 0);
    });
    const running = {};
    return rows.map(row => {
        const extra = {};
        customColumns.forEach(c => {
            const kind = c.calc || c.type;
            if (kind === 'running_balance') {
                running[c.key] = (running[c.key] || 0) + (toNum(row[c.sourceKey]) || 0);
                extra[c.key] = Math.round(running[c.key] * 100) / 100;
            } else if (kind === 'percent_of_total') {
                const t = totals[c.key];
                extra[c.key] = t ? Math.round(((toNum(row[c.sourceKey]) || 0) / t) * 10000) / 100 : 0;
            } else if (kind === 'formula') {
                const a = toNum(row[c.sourceKey]) || 0;
                const b = c.otherKey === '__const' ? Number(c.constant) || 0 : toNum(row[c.otherKey]) || 0;
                const v = c.op === '-' ? a - b : c.op === '*' ? a * b : c.op === '/' ? (b ? a / b : 0) : a + b;
                extra[c.key] = Math.round(v * 100) / 100;
            } else extra[c.key] = row[c.key] ?? '';
        });
        return { ...row, ...extra };
    });
}

/** Indian / Nepali grouping, 2 decimals */
export const fmtNum = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** how an aggregate is shown: money-style for sums / averages of number columns, whole numbers for counts */
export function fmtAgg(result, agg, isNumberCol) {
    if (result === null || result === undefined) return '';
    if (agg === 'count' || agg === 'distinct') return Number(result).toLocaleString('en-IN');
    if (typeof result === 'number' && isNumberCol) return fmtNum(result);
    return String(result);
}

/**
 * Pivot: rows grouped by rowKeys (a tree), columns = the value combinations
 * of colKeys, cells = each measure ({ key, agg }; none = Count of rows).
 * orderOf(key) -> { by: 'label' | '__count' | columnKey, dir } orders each row level.
 * Returns { measures, tuples: [{ id, labels }], tree: [node], grand: { cells, total } }
 * node = { key, val, level, path, count, cells: Map(tupleId -> [acc]), total: [acc], children }.
 */
export function buildPivot(rows, rowKeys, colKeys, measures, orderOf = () => null) {
    const ms = measures && measures.length ? measures : [{ key: '__row', agg: 'count' }];
    const SEP = '\u0001';
    const tupleOf = r => colKeys.map(k => bucketOf(r[k], 'none'));
    const seen = new Map();
    rows.forEach(r => { const t = tupleOf(r); const id = t.join(SEP); if (!seen.has(id)) seen.set(id, t); });
    const tuples = Array.from(seen.entries()).map(([id, labels]) => ({ id, labels })).sort((a, b) => {
        for (let i = 0; i < a.labels.length; i++) { const c = compareValues(a.labels[i], b.labels[i]); if (c) return c; }
        return 0;
    });
    const valueOf = (r, m) => (m.key === '__row' ? 1 : r[m.key]);
    const accsFor = list => {
        const cells = new Map();
        const total = ms.map(newAcc);
        list.forEach(r => {
            const id = tupleOf(r).join(SEP);
            if (!cells.has(id)) cells.set(id, ms.map(newAcc));
            const arr = cells.get(id);
            ms.forEach((m, i) => { const v = valueOf(r, m); addTo(arr[i], v); addTo(total[i], v); });
        });
        return { cells, total };
    };
    const build = (list, level, path) => {
        if (level >= rowKeys.length) return [];
        const key = rowKeys[level];
        const map = new Map();
        list.forEach(r => { const v = bucketOf(r[key], 'none'); if (!map.has(v)) map.set(v, []); map.get(v).push(r); });
        const o = orderOf(key) || { by: 'label', dir: 'asc' };
        const measure = v => (o.by === '__count' ? map.get(v).length : map.get(v).reduce((s, r) => s + (toNum(r[o.by]) || 0), 0));
        const vals = Array.from(map.keys()).sort((a, b) => { const c = o.by === 'label' ? compareValues(a, b) : measure(a) - measure(b); return o.dir === 'desc' ? -c : c; });
        return vals.map(val => {
            const sub = map.get(val);
            const p = `${path}/${key}:${val}`;
            return { key, val, level, path: p, count: sub.length, ...accsFor(sub), children: build(sub, level + 1, p) };
        });
    };
    return { measures: ms, tuples, tree: build(rows, 0, 'pv'), grand: accsFor(rows) };
}

/** the pivot as plain rows for CSV / print: [{ level, label, values: [..tuple x measure.., ..totals..] }] (collapsed groups' children left out) */
export function pivotLines(pv, collapsed = new Set()) {
    const out = [];
    const vals = node => [...pv.tuples.flatMap(t => pv.measures.map((m, i) => { const a = node.cells.get(t.id); return a ? accResult(a[i], m.agg) : null; })), ...pv.measures.map((m, i) => accResult(node.total[i], m.agg))];
    const walk = nodes => nodes.forEach(n => { out.push({ level: n.level, label: n.val, count: n.count, values: vals(n), group: n.children.length > 0 }); if (!collapsed.has(n.path)) walk(n.children); });
    walk(pv.tree);
    return { lines: out, grand: vals(pv.grand) };
}
