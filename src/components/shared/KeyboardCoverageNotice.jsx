import { createElement } from 'react';

export default function KeyboardCoverageNotice({ truncated, loadedCount, canNarrowRange = false }) {
  if (truncated !== true) return null;
  const count = Number.isSafeInteger(loadedCount) && loadedCount >= 0 ? loadedCount : 0;
  return createElement('div', {
    role: 'status',
    className: 'rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground',
  }, `Partial keyboard data: ${count.toLocaleString()} records loaded. Keyboard metrics and charts use only these records and do not cover the full period.${canNarrowRange ? ' Choose a shorter date range to load a complete report.' : ''}`);
}
