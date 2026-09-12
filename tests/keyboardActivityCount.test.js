import { describe, it, expect } from 'vitest';
import { keyboardActivityCount } from '../src/utils/keyboardActivityCount';
describe('recorded keyboard activity count', () => {
  it('sums the actual API total_keys field', () => {
    expect(keyboardActivityCount({ data: [{ total_keys: 125 }, { total_keys: 75 }] })).toBe(200);
  });
  it('accepts decimal integer strings from database numeric serialization', () => {
    expect(keyboardActivityCount({ data: [{ total_keys: '430481' }, { total_keys: 0 }] })).toBe(430481);
  });
  it('keeps confirmed empty and zero reports distinct from unavailable data', () => {
    expect(keyboardActivityCount({ data: [] })).toBe(0);
    expect(keyboardActivityCount({ data: [{ total_keys: 0 }] })).toBe(0);
    for (const report of [null, {}, { data: null }, { data: {} }]) expect(keyboardActivityCount(report)).toBeNull();
  });
  it.each([undefined, null, '', ' ', 'abc', 'Infinity', Infinity, NaN, -1, '-1', true, 1.5])('rejects malformed count %s instead of silently showing zero', total_keys => {
    expect(keyboardActivityCount({ data: [{ total_keys }] })).toBeNull();
  });
  it('does not substitute unrelated legacy properties for a missing canonical count', () => {
    expect(keyboardActivityCount({ data: [{ keystrokes: 100, key_count: 50 }] })).toBeNull();
    expect(keyboardActivityCount({ data: [{ total_keys: 20, keystrokes: 100 }] })).toBe(20);
  });
  it('reports the loaded subset count without inventing a full-range total', () => {
    expect(keyboardActivityCount({ truncated: true, availableCount: 100, data: [{ total_keys: 10 }] })).toBe(10);
  });
  it('rejects unsafe aggregate overflow', () => {
    expect(keyboardActivityCount({ data: [{ total_keys: Number.MAX_SAFE_INTEGER }, { total_keys: 1 }] })).toBeNull();
  });
});
