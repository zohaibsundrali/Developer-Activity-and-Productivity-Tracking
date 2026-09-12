import { describe, it, expect } from 'vitest';
import { validateReportAggregate, currentReportState } from '../src/utils/reportViewState';
const range = { from: '2026-09-01', to: '2026-09-12' };
const overview = { orgId: 'org', range, view: 'overview',
 kpis: { projects: 6000, tasks: 40000, done: 20000, completionRate: 50, loggedHours: 50000, trackedHours: 60000, overdue: 200 },
 statusCounts: { pending: 10000, in_progress: 5000, awaiting_approval: 5000, completed: 20000, rejected: 0 },
 totals: { projects: 6000, team: 1000, time: 60000, delays: 1000, timedHours: 50000 },
 trend: { days: ['2026-09-01'], completed: [20], loggedHours: [100], trackedHours: [120] }, projectTop: [], teamTop: [] };
describe('scalable report view contracts', () => {
 it('accepts whole-source aggregate totals exceeding former raw row caps', () => {
   expect(validateReportAggregate(overview, 'org', range, 'overview')).toBe(overview);
 });
 it('rejects false zero fallback from missing aggregate totals or series', () => {
   expect(() => validateReportAggregate({ ...overview, totals: {} }, 'org', range, 'overview')).toThrow('incomplete');
   expect(() => validateReportAggregate({ ...overview, trend: { ...overview.trend, completed: [] } }, 'org', range, 'overview')).toThrow('incomplete');
 });
 it('requires the explicit rejected bucket rather than folding it into pending', () => {
   const missing = { ...overview, statusCounts: { ...overview.statusCounts, rejected: undefined } };
   expect(() => validateReportAggregate(missing, 'org', range, 'overview')).toThrow('incomplete');
   const rejected = { ...overview, statusCounts: { ...overview.statusCounts, rejected: 3 } };
   expect(validateReportAggregate(rejected, 'org', range, 'overview').statusCounts.rejected).toBe(3);
 });
 it('preserves finite legacy negative hours without accepting negative counts', () => {
   const legacy = { ...overview, kpis: { ...overview.kpis, loggedHours: -1 }, totals: { ...overview.totals, timedHours: -1 }, trend: { ...overview.trend, loggedHours: [-1] } };
   expect(validateReportAggregate(legacy, 'org', range, 'overview')).toBe(legacy);
   expect(() => validateReportAggregate({ ...legacy, statusCounts: { ...overview.statusCounts, rejected: -1 } }, 'org', range, 'overview')).toThrow('incomplete');
 });
 it('checks organization, range and requested tab', () => {
   for (const patch of [{ orgId: 'other' }, { view: 'team' }, { range: { ...range, to: '2026-09-11' } }]) expect(() => validateReportAggregate({ ...overview, ...patch }, 'org', range, 'overview')).toThrow('did not match');
 });
 it.each(['projects', 'team', 'time', 'delays'])('validates a later server page in %s using full total, not page count', view => {
   const rows = Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, projectId: `${i}`, userType: 'developer', userId: `${i}` }));
   const page = { orgId: 'org', range, view, rows, total: 20000, nextOffset: 100 };
   expect(validateReportAggregate(page, 'org', range, view, 50)).toBe(page);
   expect(() => validateReportAggregate({ ...page, total: 50 }, 'org', range, view, 50)).toThrow('incomplete');
   expect(() => validateReportAggregate({ ...page, nextOffset: null }, 'org', range, view, 50)).toThrow('incomplete');
 });
 it('keeps colliding admin and developer profile keys distinct', () => {
   const page = { orgId: 'org', range, view: 'team', rows: [{ userType: 'admin', userId: 'same' }, { userType: 'developer', userId: 'same' }], total: 2, nextOffset: null };
   expect(validateReportAggregate(page, 'org', range, 'team')).toBe(page);
   expect(() => validateReportAggregate({ ...page, rows: [page.rows[0], page.rows[0]] }, 'org', range, 'team')).toThrow('invalid rows');
 });
 it('immediately hides old page rows during tab/page/range transitions', () => {
   const previous = { scope: 'org:range:time:1', bundle: { rows: [{ id: 'old' }] }, error: '' };
   for (const scope of ['org:range:time:2', 'org:range:team:1', 'other:range:time:1']) expect(currentReportState(previous, scope, true).bundle).toBeNull();
 });
});
