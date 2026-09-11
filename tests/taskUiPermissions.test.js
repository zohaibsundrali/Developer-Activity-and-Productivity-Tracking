import { describe,it,expect } from 'vitest';
import { taskUiPermissions } from '../src/utils/taskUiPermissions';
import { resolvePermission } from '../src/utils/permissionEngine';
const context={organizationId:'org',userId:'person',userType:'developer'};
const task={id:'task',organization_id:'org',developer_id:'person',task_type:'task'};
function access(role,overrides={},extra={}) {
 return taskUiPermissions({task,context,allowed:key=>resolvePermission({role,overrides},key),...extra});
}
describe('task UI effective actions',()=>{
 it('applies individual task.manage denial despite supervisory role',()=>{
  const a=access('manager',{'task.manage':false,'task.update_own':false});
  expect(a.manage).toBe(false);expect(a.move).toBe(false);expect(a.editField('priority')).toBe(false);
 });
 it('supports individually granted management on the permitted task',()=>{
  const a=access('employee',{'task.manage':true});
  for(const field of ['priority','developer_id','story_points','due_date','estimated_hours','actual_hours','sprint_id','epic_id']) expect(a.editField(field)).toBe(true);
 });
 it('does not grant managerial edits from own-update permission',()=>{
  const a=access('developer');expect(a.move).toBe(true);
  expect(a.editField('task_title')).toBe(false);expect(a.editField('priority')).toBe(false);
 });
 it('uses the verified own-plan exception only for plan fields',()=>{
  const a=access('developer',{}, {ownPlanEditable:true});
  for(const field of ['task_title','task_description','start_date','end_date']) expect(a.editField(field)).toBe(true);
  expect(a.editField('due_date')).toBe(false);expect(a.manage).toBe(false);
  expect(access('developer',{'task.update_own':false},{ownPlanEditable:true}).editField('task_title')).toBe(false);
 });
 it('never treats an admin profile with a colliding UUID as the own developer',()=>{
  const a=access('employee',{}, {context:{...context,userType:'admin'},ownPlanEditable:true});
  expect(a.move).toBe(false);expect(a.editField('task_title')).toBe(false);
 });
 it('permits bug triage without permitting assignment or normal task edits',()=>{
  const a=access('qa',{}, {task:{...task,developer_id:'other',task_type:'bug'}});
  expect(a.move).toBe(true);expect(a.createBug).toBe(true);expect(a.editField('developer_id')).toBe(false);
  expect(access('qa',{}, {task:{...task,developer_id:'other'}}).move).toBe(false);
 });
 it('honors separate visibility capability without requiring task.manage',()=>{
  const a=access('employee',{'task.set_client_visibility':true});
  expect(a.editField('client_visible')).toBe(true);expect(a.editField('priority')).toBe(false);
  expect(access('admin',{'task.set_client_visibility':false}).editField('client_visible')).toBe(false);
 });
 it('fails closed for another organization, clients and unknown fields',()=>{
  const foreign=access('owner',{}, {task:{...task,organization_id:'other'}});
  expect(foreign.manage).toBe(false);expect(foreign.move).toBe(false);
  expect(access('owner',{}, {context:{...context,userType:'client'}}).manage).toBe(false);
  expect(access('owner').editField('productivity_points')).toBe(false);
 });
});
