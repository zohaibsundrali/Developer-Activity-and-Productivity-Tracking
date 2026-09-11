export function planningStoryPoints(value) {
  if (value == null || String(value).trim() === '') return null;
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0 || points > 2147483647) throw new Error('Story points must be a non-negative whole number, or blank.');
  return points;
}

export function sprintDateOrder(start, end) {
  return !start || !end || start <= end;
}

/** A failed refresh must not turn a committed create into a retryable save. */
export async function performPlanningEdit({ mutate, reload, onError, title }) {
  try {
    const result = await mutate();
    if (result?.error) throw result.error;
  } catch (error) {
    onError(title, error?.message || String(error));
    return false;
  }
  try { if (reload) await reload(); }
  catch (error) { onError('Saved, but could not refresh', 'Your change was saved. Reload the project to see it.'); }
  return true;
}
