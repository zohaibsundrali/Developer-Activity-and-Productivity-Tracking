const cols=items=>items.map(([key,label])=>({key,label}));
export const REPORT_COLUMNS={
  overview:cols([['date','Date'],['completed','Completed tasks'],['loggedHours','Logged h'],['trackedHours','Tracked h']]),
  projects:cols([['project','Project'],['status','Status'],['progress','Progress %'],['total','Total'],['done','Done'],['overdue','Overdue'],['onTimeRate','On-time %'],['loggedHours','Logged h'],['deadline','Deadline'],['daysLate','Days late']]),
  team:cols([['name','Name'],['role','Role'],['total','Total'],['done','Done'],['completionRate','Completion %'],['onTimeRate','On-time %'],['points','Points'],['loggedHours','Logged h'],['trackedHours','Tracked h'],['avgProductivity','Avg score']]),
  time:cols([['date','Date'],['developer','Developer'],['project','Project'],['task','Task'],['hours','Hours'],['source','Source']]),
  delays:cols([['task','Task'],['project','Project'],['assignee','Assignee'],['due','Due'],['state','State'],['daysLate','Days late']]),
};
