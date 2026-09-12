/**
 * Serialize one spreadsheet-safe CSV cell. Keep trusted primitive numbers as
 * numbers; treat strings (including numeric-looking strings) as untrusted text.
 * A leading apostrophe makes formula-like text literal in spreadsheet imports.
 * RFC 4180 quoting happens afterwards so delimiters cannot create new cells.
 */
export function csvCell(value) {
  let text;
  const numeric = typeof value === 'number' || typeof value === 'bigint';
  if (value == null) text = '';
  else if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  else text = String(value);

  // Some importers ignore initial whitespace/control characters before '='.
  // Full-width formula prefixes are also treated conservatively as text.
  const formulaLike = /^[\s\u0000-\u001f\u007f]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text);
  const protectedText = !numeric && (formulaLike || /^[\t\r\n]/.test(text));
  if (protectedText) text = `'${text}`;
  return protectedText || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values) {
  return values.map(csvCell).join(',');
}
