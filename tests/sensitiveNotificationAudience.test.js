import { beforeEach,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({overrides:{},fail:false,seen:[]}));
vi.mock('@/utils/permissionOverrides',()=>({loadOverrides:async(svc,auth)=>{state.seen.push(auth);if(state.fail)throw new Error('unavailable');return state.overrides;}}));
import {sensitiveNotificationAudience,canReceiveBillingNotice,canReceiveSignalNotice} from '../src/utils/sensitiveNotificationAudience';
const member={organization_id:'org',user_id:'actor',user_type:'developer',email:'lead@test.dev',role:'manager',status:'active'};
const person={kind:'activity_drop',subject:{type:'person',id:'report@test.dev'}};
beforeEach(()=>{state.overrides={};state.fail=false;state.seen=[];});
it('loads overrides for the exact typed recipient before cron delivery',async()=>{const {audience}=await sensitiveNotificationAudience({},[member]);expect(state.seen[0]).toMatchObject({orgId:'org',appUserId:'actor',userType:'developer'});expect(canReceiveSignalNotice(audience[0].auth,person,{'report@test.dev':'lead@test.dev'})).toBe(true);});
it('withholds denied and unrelated person signals',async()=>{state.overrides={'signal.view':false};const {audience}=await sensitiveNotificationAudience({},[member]);expect(canReceiveSignalNotice(audience[0].auth,person,{'report@test.dev':'actor'})).toBe(false);audience[0].auth.overrides={};expect(canReceiveSignalNotice(audience[0].auth,person,{})).toBe(false);});
it('retains explicit grant outside the default role list with scoped reports',async()=>{state.overrides={'signal.view':true};const {audience}=await sensitiveNotificationAudience({},[{...member,role:'developer'}]);expect(canReceiveSignalNotice(audience[0].auth,person,{'report@test.dev':'actor'})).toBe(true);});
it('requires billing permission for both reminders and plan pressure',async()=>{state.overrides={'billing.view':false};const {audience}=await sensitiveNotificationAudience({},[{...member,role:'admin'}]);expect(canReceiveBillingNotice(audience[0].auth)).toBe(false);expect(canReceiveSignalNotice(audience[0].auth,{kind:'plan_pressure',subject:{type:'plan'}},{})).toBe(false);});
it('fails closed on unavailable overrides and excludes client identities',async()=>{state.fail=true;expect(await sensitiveNotificationAudience({},[member,{...member,user_type:'client'}])).toEqual({audience:[],failed:1});});

it('rejects inactive or unexpectedly foreign rows before reading permissions',async()=>{expect(await sensitiveNotificationAudience({},[{...member,status:'suspended'},{...member,organization_id:'foreign'}],'org')).toEqual({audience:[],failed:0});expect(state.seen).toEqual([]);});

it('respects explicit billing grant for a signal viewer outside billing default roles',async()=>{state.overrides={'billing.view':true};const {audience}=await sensitiveNotificationAudience({},[{...member,role:'hr'}]);expect(canReceiveSignalNotice(audience[0].auth,{kind:'plan_pressure',subject:{type:'plan'}},{})).toBe(true);});
