import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { exportCsv } from '@/utils/reportExport';
let link, body, create, revoke;
beforeEach(() => {
  vi.useFakeTimers();
  link = { click: vi.fn(), remove: vi.fn() };
  body = { appendChild: vi.fn() };
  create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {body, createElement: vi.fn(() => link)});
});
afterEach(() => {vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
const run = () => exportCsv({columns:[{key:'name'}],rows:[{name:'A'}],filename:'activity'});
describe('report download resource lifecycle', () => {
  it('starts download, removes temporary anchor and releases URL after delay', () => {
    run(); expect(link.click).toHaveBeenCalledOnce(); expect(link.remove).toHaveBeenCalledOnce();
    expect(link.href).toBe('blob:report'); expect(link.download).toMatch(/^activity_.*\.csv$/);
    expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:report');
  });
  it.each(['append','click','remove'])('still revokes URL when %s fails', phase => {
    const target=phase==='append'?body.appendChild:phase==='click'?link.click:link.remove;
    target.mockImplementation(() => {throw new Error('DOM failure');});
    expect(run).toThrow('DOM failure'); vi.advanceTimersByTime(1000);expect(revoke).toHaveBeenCalledWith('blob:report');
  });
  it('does not create a download for a cancelled export', () => {
    exportCsv({columns:[],rows:[],shouldContinue:()=>false});expect(create).not.toHaveBeenCalled();
  });
  it('cancels before downloading when scope changes during serialization', () => {
    const current=vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    exportCsv({columns:[{key:'name'}],rows:[{name:'A'}],shouldContinue:current});expect(create).not.toHaveBeenCalled();
  });
});
