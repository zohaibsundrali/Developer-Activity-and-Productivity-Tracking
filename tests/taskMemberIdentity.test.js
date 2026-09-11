import { expect, it } from 'vitest';
import { indexTaskMembers } from '@/utils/taskMemberIdentity';
it('keeps the developer assignee distinct from an admin with the same UUID',()=>{
 const members=[{userId:'same',userType:'developer',name:'Developer'},{userId:'same',userType:'admin',name:'Admin'}];
 for(const order of [members,[...members].reverse()]) {
  const index=indexTaskMembers(order);
  expect(index.byIdentity.get('developer:same').name).toBe('Developer');
  expect(index.byIdentity.get('admin:same').name).toBe('Admin');
  expect(index.byId.has('same')).toBe(false);
 }
});
it('retains unambiguous legacy mention lookup without guessing colliding recipients',()=>{
 const member={userId:'only',userType:'developer',name:'Unique'};
 const index=indexTaskMembers([null,{},member]);expect(index.byId.get('only')).toBe(member);
});
it('does not restore an ambiguous ID after a duplicate member row',()=>{
 const index=indexTaskMembers([{userId:'same',userType:'admin'},{userId:'same',userType:'developer'},{userId:'same',userType:'developer'}]);
 expect(index.byId.has('same')).toBe(false);expect(index.byIdentity.size).toBe(2);
});
