export function proposalProjectHistory(proposal) {
  if(proposal?.status!=='accepted')return null;
  if(proposal.deleted_project_id&&proposal.project_deleted_at){
    const date=new Date(proposal.project_deleted_at);
    const when=Number.isFinite(date.getTime())?` on ${date.toISOString().slice(0,10)}`:'';
    const name=typeof proposal.deleted_project_name==='string'&&proposal.deleted_project_name.trim()?` "${proposal.deleted_project_name.trim()}"`:'';
    return `Accepted. Project${name} was deleted${when}. The accepted proposal remains in your history.`;
  }
  return 'Accepted. The project has been created.';
}
