/**
 * Report export helpers — CSV (native, no dependency) and PDF (jsPDF).
 *
 * Both take the same shape so a report component can wire one toolbar:
 *   columns: [{ key, label, align? }]
 *   rows:    [{ [key]: value }]
 *
 * jsPDF is imported dynamically so it never lands in the initial bundle and
 * never runs during SSR.
 */

// ---- shared ---------------------------------------------------------------
function cellText(row, col) {
  const v = row?.[col.key];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v);
}

function stamp() {
  // Local YYYY-MM-DD_HH-mm for filenames.
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function safeName(name) {
  return String(name || "report").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function triggerDownload(blob, filename) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- CSV ------------------------------------------------------------------
// RFC-4180 style escaping: wrap in quotes when the value contains a quote,
// comma, or newline; double any embedded quotes.
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv({ columns, rows, filename = "report" }) {
  const cols = columns || [];
  const header = cols.map((c) => csvEscape(c.label ?? c.key)).join(",");
  const body = (rows || []).map((r) => cols.map((c) => csvEscape(cellText(r, c))).join(","));
  const csv = [header, ...body].join("\r\n");
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${safeName(filename)}_${stamp()}.csv`);
}

// ---- PDF ------------------------------------------------------------------
/**
 * exportPdf({ title, subtitle, columns, rows, filename, meta })
 * `meta` is an optional array of "Label: value" strings printed under the title
 * (e.g. the active filters / date range), so an exported report is self-describing.
 */
export async function exportPdf({ title, subtitle, columns, rows, filename = "report", meta = [] }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default || autoTableMod.autoTable;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const marginX = 40;
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(23, 26, 33);
  doc.text(String(title || "Report"), marginX, y);
  y += 18;

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110, 118, 132);
    doc.text(String(subtitle), marginX, y);
    y += 14;
  }

  const metaLines = [...(meta || []), `Generated: ${new Date().toLocaleString()}`];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(130, 138, 152);
  metaLines.forEach((line) => {
    doc.text(String(line), marginX, y);
    y += 12;
  });

  const cols = columns || [];
  autoTable(doc, {
    startY: y + 6,
    margin: { left: marginX, right: marginX },
    head: [cols.map((c) => c.label ?? c.key)],
    body: (rows || []).map((r) => cols.map((c) => cellText(r, c))),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: [40, 44, 52] },
    headStyles: { fillColor: [12, 143, 110], textColor: 255, fontStyle: "bold" }, // brand teal
    alternateRowStyles: { fillColor: [246, 248, 250] },
    theme: "grid",
    didDrawPage: () => {
      const pageSize = doc.internal.pageSize;
      const h = pageSize.getHeight ? pageSize.getHeight() : pageSize.height;
      const w = pageSize.getWidth ? pageSize.getWidth() : pageSize.width;
      doc.setFontSize(8);
      doc.setTextColor(150, 156, 168);
      const page = doc.internal.getCurrentPageInfo
        ? doc.internal.getCurrentPageInfo().pageNumber
        : doc.internal.getNumberOfPages();
      doc.text(`Page ${page}`, w - marginX, h - 18, { align: "right" });
    },
  });

  if (!rows || !rows.length) {
    doc.setFontSize(10);
    doc.setTextColor(130, 138, 152);
    doc.text("No data for the selected filters.", marginX, y + 24);
  }

  doc.save(`${safeName(filename)}_${stamp()}.pdf`);
}
