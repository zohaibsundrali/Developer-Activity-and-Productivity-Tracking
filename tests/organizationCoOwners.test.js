import { describe, expect, it } from 'vitest';
import { ROLES, isRole, rankOf, userTypeForRole, canGrantRole, invitationRolesFor } from '@/utils/roles';
import { authorizeRoleChange } from '@/app/api/admin/members/role/authorize';
import { roleCan } from '@/utils/permissionEngine';
import { billingAuthority } from '@/utils/accountBilling';

describe('organization co-owners', () => {
 it('removes organization admin while retaining the owner profile storage type', () => {
  expect(ROLES).not.toContain('admin'); expect(isRole('admin')).toBe(false);
  expect(rankOf('admin')).toBeNull(); expect(userTypeForRole('owner')).toBe('admin');
  expect(roleCan('admin', 'member.manage')).toBe(false);
 });
 it('only an owner can offer or grant another owner', () => {
  for (const role of [...ROLES, 'admin', 'unknown', null]) {
   expect(canGrantRole(role, 'owner'), String(role)).toBe(role === 'owner');
   expect(invitationRolesFor(role).includes('owner'), String(role)).toBe(role === 'owner');
   expect(invitationRolesFor(role)).not.toContain('admin');
  }
 });
 it('allows a co-owner to promote another member and forbids deprecated admin assignments', () => {
  const actor={role:'owner',orgId:'org-a',userType:'admin',appUserId:'owner-2'};
  const membership={id:'member',organization_id:'org-a',user_id:'worker',user_type:'developer',role:'developer'};
  expect(authorizeRoleChange({actor,membership,newRole:'owner'})).toEqual({ok:true});
  expect(authorizeRoleChange({actor,membership,newRole:'admin'})).toMatchObject({ok:false,status:400});
  expect(authorizeRoleChange({actor,membership:{...membership,organization_id:'org-b'},newRole:'owner'})).toMatchObject({ok:false,status:404});
 });
 it('gives every owner organization administration, including inviting and managing roles', () => {
  for (const key of ['organization.settings','member.invite','member.manage','billing.purchase','project.create','project.delete','monitoring.view']) {
   expect(roleCan('owner',key),key).toBe(true);
  }
 });
 it('permits a co-owner to manage their organization-only billing account', async () => {
  const svc={rpc:async()=>({data:{accountId:'org',ownerAuthId:'first-owner',organizationIds:['org']}})};
  expect((await billingAuthority(svc,{orgId:'org',userId:'second-owner',role:'owner'},{purchase:true})).denied).toBe(false);
  expect((await billingAuthority(svc,{orgId:'org',userId:'staff',role:'finance'},{purchase:true})).denied).toBe(true);
 });
 it('does not extend co-owner authority into somebody else’s shared billing account', async () => {
  const svc={rpc:async()=>({data:{accountId:'another-org',ownerAuthId:'payer',organizationIds:['another-org','org']}})};
  expect((await billingAuthority(svc,{orgId:'org',userId:'second-owner',role:'owner'},{purchase:true})).denied).toBe(true);
 });
});
