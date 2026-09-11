import { expect, it } from 'vitest';
import { myActivityPanels, loadMyTypedTeam } from '@/utils/monitoringUiAccess';
import { resolvePermission } from '@/utils/permissionEngine';
it('keeps each own panel independent of the other grants',()=>{
 const can=key=>resolvePermission({role:'employee',overrides:{'productivity.view_own':false,'monitoring.view_own':true,'team.view_own':false}},key);
 expect(myActivityPanels(can)).toEqual({productivity:false,activity:true,team:false});
});
it('binds own team lookup and names to profile type on colliding UUIDs',async()=>{
 const calls=[];let n=0;
 const results=[{data:[{project_id:'own'}]},{data:[{project_id:'own',user_id:'same',user_type:'admin'},{project_id:'own',user_id:'same',user_type:'developer'}]}, {data:[{user_id:'same',user_type:'admin',email:'admin@test'},{user_id:'same',user_type:'developer',email:'dev@test'}]}];
 const client={from:table=>{const i=n++;const q={select:()=>q,eq:(key,value)=>{calls.push([table,key,value]);return q;},in:()=>q,then:resolve=>Promise.resolve(results[i]).then(resolve)};return q;}};
 const team=await loadMyTypedTeam(client,{organizationId:'org',userId:'same',userType:'developer'});
 expect(calls).toContainEqual(['project_members','user_type','developer']);
 expect(team.map(({email,isMe})=>({email,isMe}))).toEqual([{email:'admin@test',isMe:false},{email:'dev@test',isMe:true}]);
});
it('does not disguise a denied team query as an empty team',async()=>{
 const q={select:()=>q,eq:()=>q,then:resolve=>resolve({error:new Error('denied')})};
 await expect(loadMyTypedTeam({from:()=>q},{organizationId:'org',userId:'person',userType:'developer'})).rejects.toThrow('denied');
});
it('never looks up own staff projects for an untyped or client profile',async()=>{
 await expect(loadMyTypedTeam(null,{organizationId:'org',userId:'person',userType:'client'})).rejects.toThrow('identity');
});
