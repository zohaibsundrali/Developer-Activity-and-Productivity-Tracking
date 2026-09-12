const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isInvoiceProfileType = value => value === 'admin' || value === 'developer';
export const invoiceSelectionKey = row => `${row.project_id}|${row.user_type}|${row.user_id}|${row.week_start}`;
export const canonicalInvoiceId = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

function realDate(value, monday = false) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && (!monday || date.getUTCDay() === 1);
}

export function validateInvoiceRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['projectId', 'clientId', 'title', 'dueAt', 'selections'].includes(key))) {
    throw new Error('Invoice request contains unsupported fields.');
  }
  const projectId = canonicalInvoiceId(body.projectId);
  if (!projectId) throw new Error('Choose a valid project.');
  const clientId = body.clientId == null || body.clientId === '' ? null : canonicalInvoiceId(body.clientId);
  if (body.clientId != null && body.clientId !== '' && !clientId) throw new Error('Choose a valid client.');
  if (body.title != null && (typeof body.title !== 'string' || body.title.length > 200)) throw new Error('Invoice title must be at most 200 characters.');
  const title = body.title?.trim() || null;
  const dueAt = body.dueAt == null || body.dueAt === '' ? null : body.dueAt;
  if (dueAt !== null && !realDate(dueAt)) throw new Error('Due date must be a real date, as YYYY-MM-DD.');
  if (!Array.isArray(body.selections) || body.selections.length < 1 || body.selections.length > 200) {
    throw new Error('Choose between 1 and 200 weeks to bill.');
  }
  const seen = new Set();
  const selections = body.selections.map(selection => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)
      || Object.keys(selection).some(key => !['userId', 'userType', 'weekStart'].includes(key))) {
      throw new Error('A selected week contains unsupported fields.');
    }
    const userId = canonicalInvoiceId(selection.userId);
    if (!userId || !isInvoiceProfileType(selection.userType) || !realDate(selection.weekStart, true)) {
      throw new Error('Every selection needs a valid person, profile type and Monday date.');
    }
    const key = `${selection.userType}:${userId}:${selection.weekStart}`;
    if (seen.has(key)) throw new Error('The same person and week cannot be selected twice.');
    seen.add(key);
    return { userId, userType: selection.userType, weekStart: selection.weekStart };
  });
  return { projectId, clientId, title, dueAt, selections };
}

/** Never combine currencies or present partially costed work as a complete margin. */
export function invoicePnlTotals(projects) {
  let invoiced = 0, cost = 0, anyCost = false, revenueComplete = true, costComplete = true;
  for (const project of projects || []) {
    if (project.invoiced == null || !Number.isFinite(Number(project.invoiced))) revenueComplete = false;
    else invoiced += Number(project.invoiced);
    if (project.cost != null && Number.isFinite(Number(project.cost))) { cost += Number(project.cost); anyCost = true; }
    if (project.total_hours == null || !Number.isFinite(Number(project.total_hours))) costComplete = false;
    if (Number(project.total_hours) > 0 && (project.cost == null
      || !Number.isFinite(Number(project.cost)) || project.costed_hours == null
      || !Number.isFinite(Number(project.costed_hours)) || Number(project.costed_hours) < Number(project.total_hours))) costComplete = false;
  }
  return { invoiced: revenueComplete ? invoiced : null, cost: anyCost ? cost : null,
    costComplete, margin: revenueComplete && costComplete && anyCost ? invoiced - cost : null };
}

export function invoiceCurrencyBreakdown(totals) {
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) return '';
  return Object.entries(totals).map(([currency, value]) => {
    const amount = value == null ? NaN : Number(value);
    return `${currency || 'Unknown currency'} ${Number.isFinite(amount)
      ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'unavailable'}`;
  }).join(' · ');
}
