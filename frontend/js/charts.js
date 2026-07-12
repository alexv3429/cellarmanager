/**
 * Minimal dependency-free SVG chart helpers. Not a charting library - just
 * enough to render the breakdowns the statistics page needs, without
 * pulling in Chart.js/D3/etc (which would need a CDN and stop working
 * offline unless separately cached).
 */
const PALETTE = ["#7a1f2b", "#b08d57", "#3a3630", "#6b8f71", "#a35d3f", "#4a6d8c", "#8a5a8f", "#c2a14d"];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

/** entries: [{label, value}], sorted by caller if a particular order is wanted. */
export function barChartSvg(entries, { width = 320, barHeight = 22, gap = 8, formatValue = (v) => v } = {}) {
  if (!entries.length) return `<svg width="${width}" height="40"></svg>`;
  const max = Math.max(...entries.map((e) => e.value), 1);
  const labelWidth = 110;
  const chartWidth = width - labelWidth - 50;
  const height = entries.length * (barHeight + gap);
  const bars = entries
    .map((entry, i) => {
      const y = i * (barHeight + gap);
      const w = Math.max(2, (entry.value / max) * chartWidth);
      return `
      <text x="${labelWidth - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="12" fill="#3a3630">${escapeXml(entry.label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="3" fill="${colorFor(i)}"></rect>
      <text x="${labelWidth + w + 6}" y="${y + barHeight / 2 + 4}" font-size="12" fill="#3a3630">${escapeXml(formatValue(entry.value))}</text>`;
    })
    .join("");
  return `<svg width="${width}" height="${height}" role="img" aria-label="bar chart">${bars}</svg>`;
}

/** entries: [{label, value}]. Renders a donut (ring) chart with a legend. */
export function donutChartSvg(entries, { size = 160, strokeWidth = 26 } = {}) {
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  if (total <= 0) {
    return `<svg width="${size}" height="${size}"><circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#e8e0d0" stroke-width="${strokeWidth}"/></svg>`;
  }
  let offset = 0;
  const segments = entries
    .map((entry, i) => {
      const fraction = entry.value / total;
      const dash = fraction * circumference;
      const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${colorFor(i)}"
        stroke-width="${strokeWidth}" stroke-dasharray="${dash} ${circumference - dash}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${center} ${center})"><title>${escapeXml(entry.label)}: ${entry.value}</title></circle>`;
      offset += dash;
      return circle;
    })
    .join("");
  return `<svg width="${size}" height="${size}" role="img" aria-label="donut chart">${segments}
    <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" font-size="16" fill="#3a3630">${total}</text>
  </svg>`;
}

/** Builds a small HTML legend to go alongside donutChartSvg for the same entries. */
export function legendHtml(entries) {
  const total = entries.reduce((sum, e) => sum + e.value, 0) || 1;
  return `<ul class="legend">${entries
    .map(
      (entry, i) => `<li><span class="swatch" style="background:${colorFor(i)}"></span>${escapeXml(entry.label)}
        <span class="legend-pct">${Math.round((entry.value / total) * 100)}%</span></li>`
    )
    .join("")}</ul>`;
}
