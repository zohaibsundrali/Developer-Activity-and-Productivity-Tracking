import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KeyboardCoverageNotice from '../src/components/shared/KeyboardCoverageNotice';

const render = (props) => renderToStaticMarkup(createElement(KeyboardCoverageNotice, props));

describe('keyboard report coverage notice', () => {
  it('does not warn on complete or legacy responses', () => {
    for (const truncated of [undefined, null, false, 'false']) {
      expect(render({ truncated, loadedCount: 1000 })).toBe('');
    }
  });

  it('clearly identifies partial metrics and loaded rows, including an empty subset', () => {
    for (const loadedCount of [0, 50, 10000]) {
      const html = render({ truncated: true, loadedCount });
      expect(html).toContain('role="status"');
      expect(html).toContain(`${loadedCount.toLocaleString()} records loaded`);
      expect(html).toContain('do not cover the full period');
      expect(html).not.toContain('sessions');
      expect(html).not.toContain('Choose a shorter date range');
    }
  });

  it('offers a shorter range only for views that have range controls', () => {
    expect(render({ truncated: true, loadedCount: 2000, canNarrowRange: true }))
      .toContain('Choose a shorter date range');
  });

  it('does not display invalid coverage counts', () => {
    expect(render({ truncated: true, loadedCount: -1 })).toContain('0 records loaded');
    expect(render({ truncated: true, loadedCount: NaN })).toContain('0 records loaded');
  });
});
