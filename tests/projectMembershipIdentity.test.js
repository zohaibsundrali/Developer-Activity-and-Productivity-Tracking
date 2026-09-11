import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null,types:[],writes:[],project:null,rows:{},lookupError:false,zero:false }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth,serviceClient: () => ({ from(table) {
 const filters={};let mode='read';let payload;const result=()=>{
  if(table==='projects')return {data:state.project};
  if(table==='memberships')return {data:state.types.filter(t=>!filters.user_type||t===filters.user_type).map(user_type=>({user_id:'target',user_type,status:'active'}))};
  if(mode==='write')return {data:state.zero?null:payload};
  if(mode==='delete'){state.writes.push({mode,filters});return {data:state.zero?[]:[{id:state.rows[filters.user_type].id,user_id:'target',user_type:filters.user_type}]};}
  if(state.lookupError)return {error:{message:'private'}};
  return {data:filters.user_type?state.rows[filters.user_type]:[]};
 };
 const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},in:()=>q,limit:()=>q,order:()=>q,
 maybeSingle:async()=>result(),single:async()=>result(),then:r=>Promise.resolve(result()).then(r),
 upsert:(row,options)=>{mode='write';payload=row;state.writes.push({mode,row,options});return q;},delete:()=>{mode='delete';return q;}};return q;
} }) }));
vi.mock('@/utils/projectAccess', async original => ({...await original(),withProjectRoles:async auth=>auth}));
vi.mock('@/utils/entitlements',()=>({requireUnlocked:async()=>null}));
import {POST,DELETE} from '../src/app/api/projects/[id]/members/route';
const call=(method,body)=>({POST,DELETE}[method])(new Request('http://localhost/api/projects/project/members',{method,body:JSON.stringify({userId:'target',...body})}),{params:{id:'project'}});
beforeEach(()=>{state.auth={orgId:'org',appUserId:'owner',userType:'admin',role:'owner',projectRoles:{},overrides:{}};state.types=['admin','developer'];state.writes=[];state.project={id:'project',manager_id:'target',manager_type:'admin'};state.rows={admin:{id:'admin-row',project_role:'manager'},developer:{id:'dev-row',project_role:'developer'}};state.lookupError=false;state.zero=false;});
it('refuses untyped collisions for add and delete',async()=>{expect((await call('POST',{projectRole:'developer'})).status).toBe(400);expect((await call('DELETE',{})).status).toBe(400);expect(state.writes).toEqual([]);});
it('removes only the nonmanager typed collision',async()=>{expect((await call('DELETE',{userType:'developer'})).status).toBe(200);expect(state.writes[0].filters).toEqual({id:'dev-row',project_id:'project',organization_id:'org',user_id:'target',user_type:'developer'});});
it('protects actual typed manager even if its role row is stale',async()=>{state.rows.admin.project_role='developer';expect((await call('DELETE',{userType:'admin'})).status).toBe(409);expect((await call('POST',{userType:'admin',projectRole:'developer'})).status).toBe(409);expect(state.writes).toEqual([]);});
it('uses typed conflict key and cannot overwrite colliding manager membership',async()=>{expect((await call('POST',{userType:'developer',projectRole:'qa'})).status).toBe(200);expect(state.writes[0]).toMatchObject({row:{user_type:'developer',project_role:'qa'},options:{onConflict:'project_id,user_id,user_type'}});});
it('keeps unique legacy target compatibility',async()=>{state.types=['developer'];state.project.manager_id=null;expect((await call('POST',{projectRole:'developer'})).status).toBe(200);});
it('fails closed when manager-role lookup errors',async()=>{state.lookupError=true;expect((await call('DELETE',{userType:'developer'})).status).toBe(503);expect(state.writes).toEqual([]);});
it('does not create an alternative manager through membership POST',async()=>{expect((await call('POST',{userType:'developer',projectRole:'manager'})).status).toBe(409);expect(state.writes).toEqual([]);});
it('requires affected delete and upsert confirmations',async()=>{state.zero=true;expect((await call('DELETE',{userType:'developer'})).status).toBe(500);expect((await call('POST',{userType:'developer',projectRole:'qa'})).status).toBe(500);});

it.each(['admin','developer'])('refuses ambiguous legacy manager attribution even for explicit %s targets',async userType=>{
 state.project.manager_type=null;
 expect((await call('POST',{userType,projectRole:'manager'})).status).toBe(409);
 expect((await call('DELETE',{userType})).status).toBe(409);
 expect(state.writes).toEqual([]);
});
it('supports a uniquely identified legacy manager without permitting its removal',async()=>{
 state.project.manager_type=null;state.types=['admin'];
 expect((await call('POST',{userType:'admin',projectRole:'manager'})).status).toBe(200);
 state.writes=[];expect((await call('DELETE',{userType:'admin'})).status).toBe(409);expect(state.writes).toEqual([]);
});
