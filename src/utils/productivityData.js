import { normalizeStatus } from '@/utils/pmData';

const SOURCE_COLUMNS = 'id, project_id, developer_id, task_title, status, is_on_time, start_date, end_date, submitted_at, actual_completion_date, productivity_points';
const PAGE_SIZE = 1000;
const changed = () => new Error('Productivity data changed while loading. Please retry.');

/** Complete, deterministically ordered reads. Exact counts detect membership
 * changes and repeated IDs detect overlapping pages; this is not a transaction
 * snapshot of same-count edits to existing rows. */
async function readAll(client, table, organizationId, columns, filters = {}) {
  const rows = [], seen = new Set();
  let expected = null;
  do {
    let query = client.from(table).select(columns, { count: 'exact' }).eq('organization_id', organizationId);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error, count } = await query.order('id', { ascending: true }).range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || (expected !== null && expected !== count)) throw changed();
    expected = count;
    if (data.length > PAGE_SIZE || (!data.length && rows.length !== count)) throw changed();
    for (const row of data) {
      if (typeof row?.id !== 'string' || !row.id || seen.has(row.id)) throw changed();
      seen.add(row.id); rows.push(row);
    }
    if (rows.length > expected) throw changed();
  } while (rows.length < expected);
  return rows;
}

async function readOne(client, table, organizationId, id, columns) {
  const { data, error } = await client.from(table).select(columns).eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || data.id !== id) {
    const missing = new Error('Productivity subject not found'); missing.code = 'P0002'; throw missing;
  }
  return data;
}

function states(tasks) {
  const rows = (tasks || []).map(task => ({ ...task, status: normalizeStatus(task.status) }));
  const completed = rows.filter(task => task.status === 'completed');
  return { rows, completed,
    onTime: completed.filter(task => task.is_on_time === true),
    late: completed.filter(task => task.is_on_time === false),
    pending: rows.filter(task => task.status === 'pending'),
    inProgress: rows.filter(task => task.status === 'in_progress'),
    awaiting: rows.filter(task => task.status === 'awaiting_approval'),
    rejected: rows.filter(task => task.status === 'rejected') };
}

export function projectProductivity(tasks, { projectId, projectName } = {}) {
  const s = states(tasks), total = s.rows.length, weight = total ? 100 / total : 0;
  const actual = (s.onTime.length - s.late.length) * weight;
  const overall = Math.max(0, Math.min(100, actual + (s.pending.length + s.inProgress.length + s.awaiting.length) * weight * 0.5));
  return {
    projectId, projectName, totalTasks: total, taskWeight: total ? weight.toFixed(2) : 0,
    tasksBreakdown: s.rows.map(task => {
      let contribution = 0, contributionLabel = 'Pending';
      if (task.status === 'completed') {
        if (task.is_on_time === true) { contribution = weight; contributionLabel = `+${weight.toFixed(1)}%`; }
        else if (task.is_on_time === false) { contribution = -weight; contributionLabel = `-${weight.toFixed(1)}%`; }
        else contributionLabel = 'Not assessed';
      } else if (task.status === 'rejected') contributionLabel = '0% (Rejected)';
      return { id: task.id, title: task.task_title, status: task.status, startDate: task.start_date, endDate: task.end_date,
        submittedAt: task.submitted_at, actualCompletionDate: task.actual_completion_date, isOnTime: task.is_on_time,
        productivityPoints: task.productivity_points, weight: weight.toFixed(2), contribution, contributionLabel };
    }),
    productivityPercentage: total ? (s.completed.length ? s.onTime.length / s.completed.length * 100 : 0).toFixed(2) : 0,
    overallProductivityPercentage: total ? overall.toFixed(2) : 0,
    productivityPoints: s.onTime.length - s.late.length,
    completionProgress: total ? (s.completed.length / total * 100).toFixed(2) : 0,
    summary: { completed: s.completed.length, onTime: s.onTime.length, late: s.late.length, pending: s.pending.length,
      inProgress: s.inProgress.length, awaiting: s.awaiting.length, rejected: s.rejected.length },
    formula: { description: 'Productivity = (On-time tasks × weight) - (Late tasks × weight)',
      calculation: `(${s.onTime.length} × ${weight.toFixed(1)}%) - (${s.late.length} × ${weight.toFixed(1)}%) = ${actual.toFixed(1)}%`,
      example: `With ${total} tasks, each task = ${weight.toFixed(1)}% weight` },
  };
}

export function developerProductivity(tasks, profile, { developerId, userType = 'developer' } = {}) {
  const s = states(tasks), groups = new Map();
  for (const task of s.rows) {
    if (!groups.has(task.project_id)) groups.set(task.project_id, []);
    groups.get(task.project_id).push(task);
  }
  return { developerId, userType, developerName: profile?.name || profile?.full_name, developerEmail: profile?.email,
    totalProjects: groups.size, totalTasks: s.rows.length, totalCompleted: s.completed.length, totalOnTime: s.onTime.length,
    totalLate: s.late.length, totalPending: s.pending.length + s.inProgress.length + s.awaiting.length,
    productivityPercentage: s.completed.length ? (s.onTime.length / s.completed.length * 100).toFixed(2) : 0,
    productivityPoints: s.onTime.length - s.late.length,
    projectsBreakdown: [...groups].map(([projectId, group]) => {
      const x = states(group);
      return { projectId, projectName: group[0]?.projects?.name, totalTasks: group.length, completed: x.completed.length,
        onTime: x.onTime.length, late: x.late.length, pending: x.pending.length + x.inProgress.length + x.awaiting.length,
        productivityPercentage: x.completed.length ? (x.onTime.length / x.completed.length * 100).toFixed(2) : 0 };
    }),
  };
}

export function overallProductivity(tasks, developers, projectCount) {
  const grouped = new Map();
  for (const task of tasks || []) {
    if (!grouped.has(task.developer_id)) grouped.set(task.developer_id, []);
    grouped.get(task.developer_id).push(task);
  }
  const developersBreakdown = (developers || []).map(dev => {
    const rows = grouped.get(dev.id) || [], s = states(rows);
    return { developerId: dev.id, developerName: dev.name, developerEmail: dev.email,
      totalProjects: new Set(rows.map(task => task.project_id)).size, totalTasks: rows.length,
      completedTasks: s.completed.length, onTimeTasks: s.onTime.length, lateTasks: s.late.length,
      productivityPercentage: (s.completed.length ? s.onTime.length / s.completed.length * 100 : 0).toFixed(2),
      productivityPoints: s.onTime.length - s.late.length };
  }).sort((a,b) => Number(b.productivityPercentage) - Number(a.productivityPercentage) || String(a.developerId).localeCompare(String(b.developerId)));
  return { totalDevelopers: developersBreakdown.length, totalProjects: projectCount,
    totalTasks: developersBreakdown.reduce((sum, row) => sum + row.totalTasks, 0),
    totalCompleted: developersBreakdown.reduce((sum, row) => sum + row.completedTasks, 0),
    totalOnTime: developersBreakdown.reduce((sum, row) => sum + row.onTimeTasks, 0),
    averageProductivity: developersBreakdown.length ? (developersBreakdown.reduce((sum, row) => sum + Number(row.productivityPercentage), 0) / developersBreakdown.length).toFixed(2) : 0,
    highestProductivity: developersBreakdown[0] || null, lowestProductivity: developersBreakdown.at(-1) || null, developersBreakdown };
}

function requireScope(orgId, userType = 'developer') {
  if (!orgId || !['admin','developer'].includes(userType)) throw new Error('Invalid productivity identity');
}

export async function calculateProjectProductivity(client, orgId, projectId, developerId = null, userType = 'developer') {
  requireScope(orgId, userType);
  const project = await readOne(client, 'projects', orgId, projectId, 'id, name');
  if (developerId && userType === 'developer') await readOne(client, 'developers', orgId, developerId, 'id');
  const tasks = developerId && userType === 'admin' ? [] : await readAll(client, 'developer_tasks', orgId, SOURCE_COLUMNS,
    { project_id: projectId, ...(developerId ? { developer_id: developerId } : {}) });
  return projectProductivity(tasks, { projectId, projectName: project.name });
}

export async function calculateDeveloperProductivity(client, orgId, developerId, userType = 'developer') {
  requireScope(orgId, userType);
  const profile = await readOne(client, userType === 'admin' ? 'admin_users' : 'developers', orgId, developerId,
    userType === 'admin' ? 'id, full_name, email' : 'id, name, email');
  if (userType === 'admin') return developerProductivity([], profile, { developerId, userType });
  const [tasks, projects] = await Promise.all([
    readAll(client, 'developer_tasks', orgId, SOURCE_COLUMNS, { developer_id: developerId }),
    readAll(client, 'projects', orgId, 'id, name'),
  ]);
  const projectById = new Map(projects.map(project => [project.id, project]));
  return developerProductivity(tasks.map(task => ({ ...task, projects: projectById.get(task.project_id) })), profile, { developerId, userType });
}

export async function calculateOverallProductivity(client, orgId) {
  requireScope(orgId);
  const [developers, tasks, projects] = await Promise.all([
    readAll(client, 'developers', orgId, 'id, name, email'),
    readAll(client, 'developer_tasks', orgId, SOURCE_COLUMNS),
    readAll(client, 'projects', orgId, 'id'),
  ]);
  return overallProductivity(tasks, developers, projects.length);
}
