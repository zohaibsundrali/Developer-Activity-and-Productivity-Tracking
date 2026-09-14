export const githubIssueDescription = issue => `${issue.body}\n\nGitHub issue: ${issue.url}`;
export function githubSyncFields(snapshot, issue) {
  if (!snapshot?.baseline || !snapshot.task || typeof snapshot.baseline.title !== 'string' || typeof snapshot.baseline.body !== 'string' || typeof snapshot.baseline.url !== 'string'
      || typeof issue?.title !== 'string' || typeof issue.body !== 'string' || typeof issue.url !== 'string') throw new Error('Invalid synchronization evidence.');
  return ['title','description'].map(field => {
    const baseline = field === 'title' ? snapshot.baseline.title : githubIssueDescription(snapshot.baseline);
    const incoming = field === 'title' ? issue.title : githubIssueDescription(issue), local = snapshot.task[field];
    if (local !== null && typeof local !== 'string') throw new Error('Invalid local task evidence.');
    const conflict = local !== baseline && incoming !== baseline && local !== incoming;
    return { field, baseline, local, incoming, conflict, suggested: conflict ? '' : 'auto', action: conflict ? 'choose' : local === baseline && local !== incoming ? 'update' : 'keep' };
  });
}
