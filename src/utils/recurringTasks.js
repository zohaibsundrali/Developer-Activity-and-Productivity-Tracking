/** Shared editor/worker validation; never silently coerce an empty field to one. */
export function recurrenceConfiguration(freq, every = 1) {
  if (!['daily', 'weekly', 'monthly'].includes(freq)) throw new Error('Choose daily, weekly, or monthly recurrence.');
  const interval = Number(every);
  if (every === null || !Number.isInteger(interval) || interval < 1 || interval > 3650 || !/^[0-9]{1,4}$/.test(String(every))) {
    throw new Error('Enter a whole number from 1 to 3650.');
  }
  return { freq, interval };
}

/** UTC dates match cron and SQL; monthly overflow preserves Date.setMonth semantics. */
export function recurringOccurrence(task) {
  const rec = task?.recurrence;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('Invalid recurrence configuration');
  const { interval } = recurrenceConfiguration(rec.freq, Object.hasOwn(rec, 'interval') ? rec.interval : 1);
  const anchor = rec.last_spawned || task.due_date || task.end_date;
  if (typeof anchor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error('Invalid recurrence anchor date');
  const date = new Date(`${anchor}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) throw new Error('Invalid recurrence anchor date');
  if (rec.freq === 'daily') date.setUTCDate(date.getUTCDate() + interval);
  else if (rec.freq === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * interval);
  else date.setUTCMonth(date.getUTCMonth() + interval);
  const next = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error('Recurrence date is outside the supported range');
  return { anchor, next };
}

/** One RPC owns the child, notifications, cursor and activity transaction. */
export async function spawnRecurringTasks(svc, tasks, today, allowed) {
  const summary = { spawned: 0, errors: [] };
  for (const task of tasks || []) {
    try {
      if (!(await allowed(task.organization_id))) continue;
      const { anchor, next } = recurringOccurrence(task);
      if (next > today) continue;
      const { data, error } = await svc.rpc('spawn_recurring_task', {
        p_template: task.id, p_expected_recurrence: task.recurrence,
        p_expected_anchor: anchor, p_expected_next: next,
      });
      if (error) throw new Error(error.message || 'Recurring task could not be created');
      if (data?.spawned === true) summary.spawned += 1;
      else if (data?.spawned !== false) throw new Error('Recurring task result was not confirmed');
    } catch (error) {
      summary.errors.push({ job: 'recurring', taskId: task.id, message: error?.message || 'Recurring task unavailable' });
    }
  }
  return summary;
}
