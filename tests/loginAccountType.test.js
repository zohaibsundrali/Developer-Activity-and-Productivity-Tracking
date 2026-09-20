import { describe, it, expect } from 'vitest';
import { loginAccountType } from '@/utils/loginAccountType';
describe('automatic login account type',()=>{
 it.each(['admin','developer','client'])('selects verified %s identity despite editable metadata',type=>{
  expect(loginAccountType({id:'verified-user',app_metadata:{user_type:type},user_metadata:{user_type:'admin'}})).toBe(type);
 });
 it.each([null,{id:'u',user_metadata:{user_type:'admin'}},{id:'u',app_metadata:{user_type:'owner'}},{app_metadata:{user_type:'admin'}}])('refuses missing or unsupported verified identity',user=>{
  expect(()=>loginAccountType(user)).toThrow('administrator');
 });
});
