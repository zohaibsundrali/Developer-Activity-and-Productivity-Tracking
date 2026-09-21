import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCalendarDate } from '@/utils/calendarDate';
const mocks=vi.hoisted(()=>({from:vi.fn(),auth:{orgId:'qa-org',appUserId:'qa-owner',role:'owner',userType:'admin'}}));
vi.mock('@/utils/serverAuth',()=>({getAuthedOrg:async()=>mocks.auth,serviceClient:()=>({from:mocks.from})}));
vi.mock('@/utils/serverPermissions',()=>({requirePermission:()=>null,authCan:()=>true}));
vi.mock('@/utils/entitlements',()=>({requireUnlocked:async()=>null}));
import {POST as asset} from '@/app/api/assets/route';
import {POST as contract} from '@/app/api/contracts/route';
import {POST as proposal} from '@/app/api/proposals/route';
import {POST as performance} from '@/app/api/performance/route';
beforeEach(()=>{mocks.from.mockReset();mocks.auth.userType='admin';});
describe('calendar inputs cannot reach Postgres as invalid dates',()=>{
 it.each(['0000-01-01','2026-02-30','2026-02-29','2026-13-01','2026-00-10','2026-01-00','2026-1-01',true,42,{},[]])('rejects %j',date=>expect(isCalendarDate(date)).toBe(false));
 it.each(['2024-02-29','2026-09-21','2000-02-29'])('accepts %s',date=>expect(isCalendarDate(date)).toBe(true));
 it.each([
  ['asset purchase',asset,'assets',{assetTag:'qa',name:'qa',purchaseDate:'2026-02-30'}],
  ['licence renewal',asset,'assets?action=licence',{name:'qa',seatsTotal:1,renewalDate:'2026-02-30'}],
  ['contract start',contract,'contracts',{reference:'qa',title:'qa',startDate:'2026-02-30'}],
  ['contract end',contract,'contracts',{reference:'qa',title:'qa',endDate:'invalid'}],
  ['milestone due',contract,'contracts?action=milestone',{contractId:'00000000-0000-4000-8000-000000000001',title:'qa',dueDate:'2026-02-30'}],
  ['review period',performance,'performance?action=cycle',{name:'qa',periodStart:'2026-02-30',periodEnd:'2026-03-31'}],
  ['goal due',performance,'performance?action=goal',{userId:'00000000-0000-4000-8000-000000000001',title:'qa',dueDate:'invalid'}],
 ])('%s returns a validation error without querying or writing rows',async(_,handler,path,body)=>{
  const response=await handler(new Request(`http://localhost/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  expect(response.status).toBe(400);expect((await response.json()).success).toBe(false);expect(mocks.from).not.toHaveBeenCalled();
 });
});

it('invalid client proposal deadline returns 400 before any database lookup',async()=>{
 mocks.auth.userType='client';
 const response=await proposal(new Request('http://localhost/api/proposals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'QA',description:'QA',desiredDeadline:'2026-02-30'})}));
 expect(response.status).toBe(400);expect(mocks.from).not.toHaveBeenCalled();
});
