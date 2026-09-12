import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell, csvRow } from '@/utils/csvSerialization';
import { exportCsv } from '@/utils/reportExport';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('spreadsheet-safe CSV cells', () => {
  it.each(['=1+1', '+SUM(1)', '-1+2', '@SUM(1)', '  =1', '\t=1', '\r=1', '\n=1', '\u0000=1', '\uFEFF=1', '＝1', '＋1', '－1', '＠SUM(1)'])('treats formula-like text %j as literal without executing it', value => {
    const encoded = csvCell(value);
    const decoded = encoded.startsWith('"') ? encoded.slice(1, -1).replace(/""/g, '"') : encoded;
    expect(decoded).toBe(`'${value}`);
  });
  it.each(['\thello', '\rhello', '\nhello'])('neutralizes leading control character text %j', value => {
    expect(csvCell(value)).toContain(`'${value}`);
  });
  it('distinguishes typed negative numbers from untrusted numeric-looking text', () => {
    expect(csvCell(-12.5)).toBe('-12.5'); expect(csvCell(-12n)).toBe('-12');
    expect(csvCell('-12.5')).toBe('"\'-12.5"'); expect(csvCell(0)).toBe('0');
  });
  it('preserves Unicode, dates, booleans, blanks and ordinary punctuation', () => {
    expect(csvRow(['Zohaib علی', new Date('2026-09-12T18:00:00Z'), true, null, undefined, 'task-12'])).toBe('Zohaib علی,2026-09-12,true,,,task-12');
    expect(csvCell(new Date('invalid'))).toBe('');
  });
  it('quotes commas, embedded double quotes and multiline text after formula protection', () => {
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('first\nsecond')).toBe('"first\nsecond"');
    expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
  });
  it('keeps a delimiter-and-formula payload within a single quoted cell', () => {
    expect(csvRow(['plain",=1+1', 'safe'])).toBe('"plain"",=1+1",safe');
  });
  it('does not serialize or download when the export context has become stale', () => {
    const get = vi.fn(() => { throw new Error('Should not read rows'); });
    const row = {}; Object.defineProperty(row, 'name', { get });
    exportCsv({ columns: [{ key: 'name' }], rows: [row], shouldContinue: () => false });
    expect(get).not.toHaveBeenCalled();
  });
  it('checks export context again after serialization before creating a download URL', () => {
    vi.stubGlobal('window', {});
    const create = vi.spyOn(URL, 'createObjectURL');
    const current = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    exportCsv({ columns: [{ key: 'name' }], rows: [{ name: 'Employee' }], shouldContinue: current });
    expect(current).toHaveBeenCalledTimes(2); expect(create).not.toHaveBeenCalled();
  });
  it('protects report headers and values while retaining numeric cells and UTF-8 BOM', async () => {
    vi.useFakeTimers();
    let captured;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob; return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const link = { click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn(), removeChild: vi.fn() } });
    exportCsv({ columns: [{ key: 'name', label: '=Header' }, { key: 'amount', label: 'Amount' }, { key: 'day', label: 'Day' }], rows: [{ name: '=1+1', amount: -3.5, day: new Date('2026-09-12T10:00:00Z') }], filename: 'safe' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const bytes = new Uint8Array(await captured.arrayBuffer());
    expect([...bytes.slice(0,3)]).toEqual([239,187,191]);
    expect(await captured.text()).toBe('"\'=Header",Amount,Day\r\n"\'=1+1",-3.5,2026-09-12');
    expect(link.click).toHaveBeenCalledOnce(); vi.runAllTimers();
  });
});
