import { describe,it,expect,vi } from 'vitest';
import { createNotificationInboxEvents } from '../src/utils/notificationInboxEvents';
function setup(fetchRow=vi.fn(async()=>({data:{id:'n',read:false}}))) {
 const onRow=vi.fn(),onCount=vi.fn(),onError=vi.fn();
 return { onRow,onCount,onError,fetchRow,events:createNotificationInboxEvents({organizationId:'org',userId:'same',userType:'developer',isCurrent:()=>true,fetchRow,onRow,onError,onCount}) };
}
const content={table:'notifications',eventType:'INSERT',new:{id:'n',organization_id:'org',recipient_keys:['developer:same'],read:true}};
const state={table:'notification_recipients',eventType:'UPDATE',new:{notification_id:'n',organization_id:'org',user_id:'same',user_type:'developer',read:true}};
describe('per-recipient inbox realtime',()=>{
 it('uses committed recipient state instead of shared notification state',async()=>{
  const s=setup();await s.events.handle(content);
  expect(s.onRow).toHaveBeenCalledWith({id:'n',read:false},{isInsert:true});
 });
 it('ignores other recipient profiles with the same UUID and other organizations',async()=>{
  const s=setup();
  await s.events.handle({...state,new:{...state.new,user_type:'admin'}});
  await s.events.handle({...state,new:{...state.new,organization_id:'other'}});
  expect(s.fetchRow).not.toHaveBeenCalled();
 });
 it('keeps insertion intent when a newer state event overtakes the insert fetch',async()=>{
  const pending=[];const s=setup(vi.fn(()=>new Promise(resolve=>pending.push(resolve))));
  const first=s.events.handle(content),second=s.events.handle(state);
  pending[1]({data:{id:'n',read:true}});await second;
  pending[0]({data:{id:'n',read:false}});await first;
  expect(s.onRow).toHaveBeenCalledTimes(1);
  expect(s.onRow).toHaveBeenCalledWith({id:'n',read:true},{isInsert:true});
 });
 it('fetches dismissal state so the hook can remove only this recipient row',async()=>{
  const s=setup(vi.fn(async()=>({data:{id:'n',dismissed_at:'now'}})));
  await s.events.handle(state);
  expect(s.onRow).toHaveBeenCalledWith({id:'n',dismissed_at:'now'},{isInsert:false});
 });
 it('drops an in-flight response after subscription cleanup',async()=>{
  let resolve;const s=setup(()=>new Promise(done=>{resolve=done;}));
  const pending=s.events.handle(state);s.events.close();resolve({data:{id:'n'}});await pending;
  expect(s.onRow).not.toHaveBeenCalled();expect(s.onCount).not.toHaveBeenCalled();
 });
 it('reports failed refreshes without applying unverified event payloads',async()=>{
  const failure=new Error('offline');const s=setup(async()=>{throw failure;});
  await s.events.handle(state);
  expect(s.onError).toHaveBeenCalledWith(failure);expect(s.onRow).not.toHaveBeenCalled();
 });
});
