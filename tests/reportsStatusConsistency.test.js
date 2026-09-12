import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/supabaseClient', () => ({ supabase: {} }));
import { projectPerformance, teamProductivity, deadlineDelays, dailyTrend, summaryKpis, statusDistribution } from '@/utils/reportsData';
const employee = { userId: 'dev', userType: 'developer', name: 'Developer' };
function bundleFor(statuses) {
  return {
    projects: [{ id: 'project', name: 'Project' }], employees: [employee], timeLogs: [], sessions: [],
    range: { from: '2026-09-08', to: '2026-09-09' },
    tasks: statuses.map((status, i) => ({ id: `task-${i}`, task_title: `Task ${i}`, status, project_id: 'project', developer_id: 'dev',
      due_date: '2026-09-07', actual_completion_date: '2026-09-08', updated_at: '2026-09-08', is_on_time: false })),
  };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:00:00Z')); });
afterEach(() => vi.useRealTimers());
describe('report task states agree with the canonical board', () => {
  it.each(['completed', 'done', 'approved'])('counts %s as completed in every report', status => {
    const bundle = bundleFor([status]);
    expect(projectPerformance(bundle)[0]).toMatchObject({ done: 1, pending: 0, progress: 100, overdue: 0, onTimeRate: 0 });
    expect(teamProductivity(bundle)[0]).toMatchObject({ done: 1, pending: 0, completionRate: 100, onTimeRate: 0 });
    expect(summaryKpis(bundle)).toMatchObject({ done: 1, completionRate: 100, overdue: 0 });
    expect(deadlineDelays(bundle)[0]).toMatchObject({ state: 'Completed late', daysLate: 1 });
    expect(dailyTrend(bundle).completed.reduce((sum, n) => sum + n, 0)).toBe(1);
  });
  it.each(['reviewed', 'in_review', 'awaiting_approval'])('keeps %s pending review instead of counting it as completed', status => {
    const bundle = bundleFor([status]);
    expect(statusDistribution(bundle.tasks).awaiting_approval).toBe(1);
    expect(projectPerformance(bundle)[0]).toMatchObject({ done: 0, progress: 0, overdue: 1, onTimeRate: null });
    expect(teamProductivity(bundle)[0]).toMatchObject({ done: 0, completionRate: 0, onTimeRate: null });
    expect(summaryKpis(bundle)).toMatchObject({ done: 0, overdue: 1 });
    expect(deadlineDelays(bundle)[0]).toMatchObject({ state: 'Overdue', daysLate: 5 });
    expect(dailyTrend(bundle).completed.every(value => value === 0)).toBe(true);
  });
  it.each(['doing', 'in_progress'])('preserves the in-progress classification of %s', status => {
    const bundle = bundleFor([status]);
    expect(projectPerformance(bundle)[0]).toMatchObject({ done: 0, inProgress: 1, pending: 0 });
    expect(statusDistribution(bundle.tasks).in_progress).toBe(1);
  });
  it('agrees across the KPI, project and team for a mixed legacy/current task set', () => {
    const bundle = bundleFor(['done', 'approved', 'completed', 'reviewed', 'in_review', 'doing', 'pending', 'rejected']);
    expect(summaryKpis(bundle).done).toBe(3);
    expect(projectPerformance(bundle)[0]).toMatchObject({ done: 3, inProgress: 1, pending: 4 });
    expect(teamProductivity(bundle)[0]).toMatchObject({ done: 3, pending: 5 });
    expect(dailyTrend(bundle).completed.reduce((sum, n) => sum + n, 0)).toBe(3);
  });
});
