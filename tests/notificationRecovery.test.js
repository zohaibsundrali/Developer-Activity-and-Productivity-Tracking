import { expect, it, vi } from 'vitest';
import { fetchNotificationRecovery, notificationReconnect, rollbackNotificationRead } from '@/utils/notificationRecovery';
it('reconnect reconciles the currently loaded inbox after a missed event',()=>{
 const rows=[{id:'old'}];const reconcile=()=>rows.unshift({id:'missed'});
 notificationReconnect('CHANNEL_ERROR',{isCurrent:()=>true,reconcile});expect(rows).toHaveLength(1);
 notificationReconnect('SUBSCRIBED',{isCurrent:()=>true,reconcile});expect(rows.map(row=>row.id)).toEqual(['missed','old']);
});
it('a reconnect for an old identity never refreshes the new profile inbox',()=>{
 const reconcile=vi.fn();notificationReconnect('SUBSCRIBED',{isCurrent:()=>false,reconcile});expect(reconcile).not.toHaveBeenCalled();
});
it('rolls back a rejected mark-all independently of whether recovery fetch succeeds',()=>{
 const snapshot=[{id:'unread',read:false,read_at:null},{id:'read',read:true,read_at:'existing'}];
 const optimistic=[{id:'unread',read:true,read_at:'optimistic'},{id:'read',read:true,read_at:'existing'}];
 expect(rollbackNotificationRead(optimistic,snapshot,'optimistic')).toEqual(snapshot);
});
it('retains later realtime state and incoming notifications when a bulk request fails',()=>{
 const snapshot=[{id:'old',read:false,read_at:null}];
 const newer=[{id:'old',read:true,read_at:'server-newer'},{id:'new',read:false,read_at:null}];
 expect(rollbackNotificationRead(newer,snapshot,'optimistic')).toEqual(newer);
});

it('refetches the loaded pages at normal size and rejects a partial recovery',async()=>{
 const fetcher=vi.fn(async({page,pageSize})=>({rows:[{id:`page-${page}`}],hasMore:true,error:null}));
 const result=await fetchNotificationRecovery(fetcher,{pageSize:15,category:'review'},2);
 expect(result.rows.map(row=>row.id)).toEqual(['page-0','page-1','page-2']);
 expect(fetcher.mock.calls.map(([args])=>args)).toEqual([0,1,2].map(page=>({pageSize:15,category:'review',page})));
 fetcher.mockImplementation(async({page})=>page===1?{error:new Error('offline')}:{rows:[{id:'first'}],hasMore:true});
 const failed=await fetchNotificationRecovery(fetcher,{pageSize:15},2);expect(failed.error.message).toBe('offline');expect(failed.rows).toEqual([]);
});
