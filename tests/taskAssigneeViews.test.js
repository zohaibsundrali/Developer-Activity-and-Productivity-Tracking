import {expect,it} from 'vitest';
import {memberAssignmentKey,taskAssigneeMember,taskAssignmentKey,matchesAssigneeFilter} from '@/utils/taskAssignment';
const members=[{userId:'same',userType:'developer',name:'Employee'},{userId:'same',userType:'admin',name:'Owner'}];
it('displays the correct profile when owner and employee UUIDs collide',()=>{
 expect(taskAssigneeMember({assignee_admin_id:'same'},members)?.name).toBe('Owner');
 expect(taskAssigneeMember({developer_id:'same'},members)?.name).toBe('Employee');
 expect(new Set(members.map(memberAssignmentKey)).size).toBe(2);
});
it('does not count owner work as unassigned or include it in an employee filter',()=>{
 const task={assignee_admin_id:'same'};
 expect(matchesAssigneeFilter(task,'unassigned')).toBe(false);
 expect(matchesAssigneeFilter(task,'developer:same')).toBe(false);
 expect(matchesAssigneeFilter(task,'admin:same')).toBe(true);
 expect(matchesAssigneeFilter({},'unassigned')).toBe(true);
});
it('preserves legacy saved developer filters without granting them owner meaning',()=>{
 expect(matchesAssigneeFilter({developer_id:'same'},'same')).toBe(true);
 expect(matchesAssigneeFilter({assignee_admin_id:'same'},'same')).toBe(false);
});
it('keeps workload groups distinct and refuses ambiguous assignments',()=>{
 expect(taskAssignmentKey({assignee_admin_id:'same'})).toBe('admin:same');
 expect(taskAssignmentKey({developer_id:'same'})).toBe('developer:same');
 const ambiguous={developer_id:'same',assignee_admin_id:'same'};
 expect(taskAssigneeMember(ambiguous,members)).toBeNull();
 expect(matchesAssigneeFilter(ambiguous,'unassigned')).toBe(false);
});
