const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { api, session, svc, row } = require('./live-context.cjs');
if (process.env.E2E_ALLOW_WRITES !== '1') throw Error('E2E_ALLOW_WRITES=1 required');
const name = `qa-owner-work-${Date.now()}`, results = [], files = [], titles = [];
let project, task, step = 'setup';
const artifact = 'test-results/owner-my-work-live.json';
fs.mkdirSync('test-results', { recursive: true });
const save = () => fs.writeFileSync(artifact, JSON.stringify({ name, results }, null, 2), { mode: 0o600 });
const pass = label => { results.push({ name: label, status: 'PASS' }); console.log('PASS', label); save(); };
const ok = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; };
const patch = member => ({ developer_id: member?.type === 'developer' ? member.id : null, assignee_admin_id: member?.type === 'admin' ? member.id : null });
async function personal(member) {
  return ok(await member.client.from('developer_tasks').select('*').eq('organization_id', member.org)
    .eq(member.type === 'admin' ? 'assignee_admin_id' : 'developer_id', member.id).eq('project_id', project.id));
}
async function call(role, path, body, status = 200) {
  const result = await api(role, 'POST', path, body);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}
(async () => {
  const owner = await session('owner'), dev = await session('developer'), employee = await session('employee');
  const manager = await session('manager'), other = await session('org_b_owner'), client = await session('client');
  const today = new Date().toISOString().slice(0, 10), deadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  project = ok(await owner.client.from('projects').insert({ organization_id: owner.org, name, status: 'active',
    created_by: owner.id, created_by_type: owner.type, added_by: owner.id, added_by_type: owner.type,
    manager_id: manager.id, manager_type: manager.type, deadline }).select().single());
  titles.push(name);
  task = ok(await owner.client.from('developer_tasks').insert({ organization_id: owner.org, project_id: project.id,
    task_title: name, status: 'pending', start_date: today, end_date: deadline, ...patch(owner) }).select().single());
  async function assign(member, actor = owner) {
    ok(await actor.client.from('developer_tasks').update(patch(member)).eq('id', task.id).select().single());
    const persisted = await row('developer_tasks', task.id);
    assert.equal(persisted.developer_id, patch(member).developer_id);
    assert.equal(persisted.assignee_admin_id, patch(member).assignee_admin_id);
  }
  async function submit(role, member, suffix) {
    const path = `submissions/${member.id}/${project.id}/${task.id}/${crypto.randomUUID()}.txt`;
    ok(await member.client.storage.from('task-submissions').upload(path, Buffer.from(`${name} ${suffix}`), { contentType: 'text/plain' }));
    files.push(path);
    const request = { taskId: task.id, projectId: project.id, fileName: 'proof.txt', storagePath: path, submissionNotes: name };
    const response = await call(role, '/api/task-submission', request);
    assert.equal(response.submission.assignee_admin_id, patch(member).assignee_admin_id);
    assert.equal(response.submission.developer_id, patch(member).developer_id);
    assert.equal((await row('developer_tasks', task.id)).status, 'awaiting_approval');
    return response.submission;
  }
  step = 'Owner self-assignment and reload persistence';
  assert.equal((await personal(owner)).length, 1); assert.equal((await personal(dev)).length, 0);
  assert.equal((await row('developer_tasks', task.id)).assignee_admin_id, owner.id); pass(step);
  step = 'Owner proof submission and own approval/rejection denied';
  const first = await submit('owner', owner, 'first');
  const reviewNotices = ok(await manager.client.from('notifications').select('recipient_keys').eq('submission_id', first.id).eq('type', 'review_required'));
  assert(reviewNotices.some(n => n.recipient_keys.includes(`${manager.type}:${manager.id}`)), 'Independent reviewer receives review request');
  await call('owner', '/api/admin-review', { taskId: task.id, submissionId: first.id, action: 'approve' }, 403);
  await call('owner', '/api/admin-review', { taskId: task.id, submissionId: first.id, action: 'reject', rejectionReason: 'Self review must fail' }, 403);
  pass(step);
  step = 'Delegation supersedes pending proof and separates management from My Work';
  await assign(dev);
  assert.equal((await row('task_submissions', first.id)).review_status, 'superseded');
  assert.equal((await row('developer_tasks', task.id)).status, 'pending');
  assert.equal((await personal(owner)).length, 0); assert.equal((await personal(dev)).length, 1);
  assert.equal(ok(await owner.client.from('developer_tasks').select('id').eq('id', task.id)).length, 1);
  await call('manager', '/api/admin-review', { taskId: task.id, submissionId: first.id, action: 'approve' }, 409);
  const notice = ok(await dev.client.from('notifications').select('id,type').eq('task_id', task.id).eq('category', 'assignment'));
  assert(notice.some(n => n.type === 'task_reassigned')); pass(step);
  step = 'Non-manager assignment and cross-organization assignment denied';
  assert((await dev.client.from('developer_tasks').update(patch(employee)).eq('id', task.id)).error);
  assert((await owner.client.from('developer_tasks').update(patch(other)).eq('id', task.id)).error);
  assert.equal(ok(await other.client.from('developer_tasks').select('id').eq('id', task.id)).length, 0);
  assert.equal(ok(await client.client.from('developer_tasks').select('id').eq('id', task.id)).length, 0);
  await call('org_b_owner', '/api/task-submission', { taskId: task.id, projectId: project.id, fileName: 'proof.txt', storagePath: files[0] }, 404);
  pass(step);
  step = 'Developer submission, reassignment to Employee, and former-assignee privacy';
  const delegated = await submit('developer', dev, 'developer');
  await assign(employee);
  assert.equal((await row('task_submissions', delegated.id)).review_status, 'superseded');
  assert.equal((await personal(dev)).length, 0); assert.equal((await personal(employee)).length, 1);
  assert.equal(ok(await dev.client.from('developer_tasks').select('id').eq('id', task.id)).length, 0);
  const removal = ok(await dev.client.from('notifications').select('type,task_id,project_id').eq('metadata->>taskTitle', name));
  assert(removal.some(n => n.type === 'task_reassigned_away' && !n.task_id && !n.project_id));
  const hidden = await api('developer', 'GET', `/api/task-submission?taskId=${task.id}`);
  assert.equal(hidden.status, 200); assert.equal(hidden.body.submissions.length, 0); pass(step);
  step = 'Employee submission and unassignment reset personal work and pending proof';
  const employeeProof = await submit('employee', employee, 'employee');
  await assign(null);
  assert.equal((await personal(employee)).length, 0); assert.equal((await personal(owner)).length, 0);
  assert.equal((await row('task_submissions', employeeProof.id)).review_status, 'superseded');
  await call('owner', '/api/task-submission', { taskId: task.id, projectId: project.id, fileName: 'proof.txt', storagePath: files[0] }, 409); pass(step);
  step = 'Owner assignment notification, resubmission, and independent authorized review';
  await assign(owner, manager);
  const ownerNotices = ok(await owner.client.from('notifications').select('id,type,recipient_keys').eq('task_id', task.id).eq('category', 'assignment'));
  assert(ownerNotices.some(n => n.type === 'task_assigned' && n.recipient_keys.includes(`admin:${owner.id}`)));
  const final = await submit('owner', owner, 'final');
  await call('developer', '/api/admin-review', { taskId: task.id, submissionId: final.id, action: 'approve' }, 403);
  await call('manager', '/api/admin-review', { taskId: task.id, submissionId: final.id, action: 'approve' });
  assert.equal((await row('developer_tasks', task.id)).status, 'completed');
  const reviewed = ok(await owner.client.from('notifications').select('id').eq('task_id', task.id).eq('type', 'task_approved'));
  assert(reviewed.length); pass(step);
  step = 'Every staff role gets only its own assignments in personal My Work';
  for (const role of ['owner', 'admin', 'manager', 'team_lead', 'hr', 'finance', 'qa', 'developer', 'designer', 'devops', 'employee']) {
    const member = await session(role), title = `${name}-${role}`; titles.push(title);
    const created = ok(await owner.client.from('developer_tasks').insert({ organization_id: owner.org, project_id: project.id,
      task_title: title, status: 'pending', start_date: today, end_date: deadline, ...patch(member) }).select().single());
    assert((await personal(member)).some(t => t.id === created.id), `${role} sees own assignment`);
    if (member.id !== owner.id || member.type !== owner.type) assert(!(await personal(owner)).some(t => t.id === created.id));
    assert(!ok(await other.client.from('developer_tasks').select('id').eq('id', created.id)).length);
  }
  pass(step);
})().catch(error => { results.push({ name: step, status: 'FAIL', error: error.message }); console.error('FAIL', step, error.message); })
.finally(async () => {
  if (project) {
    // Exact run-scoped cleanup, including assignment-away notifications without live links.
    for (const title of titles) ok(await svc.from('notifications').delete().eq('organization_id', project.organization_id).eq('metadata->>taskTitle', title));
    for (const table of ['notifications', 'activity_logs', 'pm_activity', 'admin_reviews']) {
      const result = await svc.from(table).delete().eq('organization_id', project.organization_id).eq('project_id', project.id);
      if (result.error) results.push({ name: `cleanup ${table}`, status: 'FAIL', error: result.error.message });
    }
    if (files.length) { const result = await svc.storage.from('task-submissions').remove(files); if (result.error) results.push({ name: 'cleanup proof', status: 'FAIL', error: result.error.message }); }
    const result = await svc.from('projects').delete().eq('organization_id', project.organization_id).eq('id', project.id);
    if (result.error) results.push({ name: 'cleanup project', status: 'FAIL', error: result.error.message });
  }
  save(); if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
});
