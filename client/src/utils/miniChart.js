// =============================================
// utils/miniChart.js
// A small hand-coded SVG chart renderer - no npm chart library is
// installed in this project and none can be added (network installs
// are disabled here), so bar/pie/line charts are drawn as plain SVG.
// Shared by the Document Designer's canvas preview (sample data) and
// the real print output (actual resolved document data).
// =============================================

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

// rows: [{ label, value }], already aggregated by the caller.
export function renderMiniChartSvg(chartType, rows, widthPx, heightPx) {
    if (!rows || rows.length === 0) {
        return `<svg width="${widthPx}" height="${heightPx}" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" font-size="10" fill="#999" text-anchor="middle">No data</text></svg>`;
    }
    if (chartType === 'pie') return renderPie(rows, widthPx, heightPx);
    if (chartType === 'line') return renderLine(rows, widthPx, heightPx);
    return renderBar(rows, widthPx, heightPx);
}

function renderBar(rows, w, h) {
    const padding = { top: 8, right: 8, bottom: 22, left: 8 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const maxVal = Math.max(...rows.map(r => Number(r.value) || 0), 1);
    const barGap = 4;
    const barWidth = Math.max(4, (chartW - barGap * (rows.length - 1)) / rows.length);
    let bars = '';
    rows.forEach((r, i) => {
        const barH = (Number(r.value) / maxVal) * chartH;
        const x = padding.left + i * (barWidth + barGap);
        const y = padding.top + (chartH - barH);
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${COLORS[i % COLORS.length]}" />`;
        bars += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${h - 6}" font-size="6" fill="#666" text-anchor="middle">${truncateLabel(r.label, 8)}</text>`;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function renderPie(rows, w, h) {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
    const total = rows.reduce((s, row) => s + (Number(row.value) || 0), 0) || 1;
    let angle = -Math.PI / 2;
    let slices = '';
    rows.forEach((row, i) => {
        const sliceAngle = (Number(row.value) / total) * 2 * Math.PI;
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
        angle += sliceAngle;
        const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        slices += `<path d="M ${cx},${cy} L ${x1.toFixed(1)},${y1.toFixed(1)} A ${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${COLORS[i % COLORS.length]}" stroke="#fff" stroke-width="1" />`;
    });
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${slices}</svg>`;
}

function renderLine(rows, w, h) {
    const padding = { top: 8, right: 8, bottom: 22, left: 8 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const maxVal = Math.max(...rows.map(r => Number(r.value) || 0), 1);
    const stepX = rows.length > 1 ? chartW / (rows.length - 1) : 0;
    const points = rows.map((r, i) => {
        const x = padding.left + i * stepX;
        const y = padding.top + (chartH - (Number(r.value) / maxVal) * chartH);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const labels = rows.map((r, i) => {
        const x = padding.left + i * stepX;
        return `<text x="${x.toFixed(1)}" y="${h - 6}" font-size="6" fill="#666" text-anchor="middle">${truncateLabel(r.label, 8)}</text>`;
    }).join('');
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><polyline points="${points}" fill="none" stroke="${COLORS[0]}" stroke-width="1.5" />${labels}</svg>`;
}

function truncateLabel(label, maxLen) {
    const s = String(label || '');
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// Aggregates detail rows into [{label, value}] for a chart block,
// summing the y-field for every distinct value of the x-field.
export function aggregateForChart(detailRows, xField, yField) {
    const totals = {};
    (detailRows || []).forEach(row => {
        const label = row[xField] ?? '(blank)';
        totals[label] = (totals[label] || 0) + (Number(row[yField]) || 0);
    });
    return Object.entries(totals).map(([label, value]) => ({ label, value }));
}
