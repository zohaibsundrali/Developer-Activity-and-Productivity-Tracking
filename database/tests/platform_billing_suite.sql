-- Run after platform access/billing migrations in a disposable database.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();o uuid:=gen_random_uuid();request uuid:=gen_random_uuid();payload jsonb;result jsonb; outsider uuid:=gen_random_uuid();outsid uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at)values(u,'billing-owner@example.test',now()),(outsider,'outsider@example.test',now());
 insert into auth.sessions(id,user_id)values(sid,u),(outsid,outsider);
 insert into app_private.platform_owners(auth_user_id)values(u);
 insert into organizations(id,name)values(o,'Billing suite test');
 insert into organization_subscriptions(organization_id,status,plan_code,trial_end)values(o,'trialing','free',now()+interval '7 days');
 payload:=jsonb_build_object('organizationId',o,'requestId',request,'action','extend_trial','reason','Testing trial extension','trialEnd',now()+interval '14 days');
 begin perform platform_billing_begin(outsider,outsid,request,o,payload);raise exception 'Outsider authorized';exception when insufficient_privilege then null;end;
 perform platform_billing_begin(u,sid,request,o,payload);
 begin perform platform_billing_begin(u,sid,request,o,payload);raise exception 'Duplicate concurrent request allowed';exception when others then if sqlerrm='Duplicate concurrent request allowed' then raise;end if;end;
 begin perform platform_billing_begin(u,sid,request,o,payload||'{"reason":"Changed operation reason"}');raise exception 'Payload conflict allowed';exception when others then if sqlerrm='Payload conflict allowed' then raise;end if;end;
 perform platform_billing_finish(u,sid,request,'{"retryable":true}',false);
 begin perform platform_billing_begin(u,sid,gen_random_uuid(),o,payload);raise exception 'Ambiguous prior request bypassed';exception when others then if sqlerrm='Ambiguous prior request bypassed' then raise;end if;end;
 update app_private.platform_billing_requests set updated_at=now()-interval '3 minutes' where id=request;
 perform platform_billing_begin(u,sid,request,o,payload);
 perform platform_billing_finish(u,sid,request,'{"local":true}',true);
 result:=platform_billing_begin(u,sid,request,o,payload);
 if result->>'status'<>'completed' then raise exception 'Replay lost completion';end if;
 perform platform_billing_finish(u,sid,request,'{"retryable":true}',false);
 if (select status from app_private.platform_billing_requests where id=request)<>'completed' then raise exception 'Late failure overwrote success';end if;
 if (select trial_end from organization_subscriptions where organization_id=o)<now()+interval '13 days' then raise exception 'Local trial not extended';end if;

 insert into billing_plans(code,is_active,amount_cents,currency,billing_interval)values('suite_annual',true,12000,'gbp','year');
 update organization_subscriptions set status='active',plan_code='suite_annual' where organization_id=o;
 insert into billing_invoices(organization_id,currency,status,amount_paid_cents,amount_due_cents)values(o,'gbp','paid',10000,10000),(o,'gbp','open',300,1000),(o,'jpy','paid',100,100);
 insert into app_private.platform_billing_requests(id,actor_id,organization_id,payload,status,result)values(gen_random_uuid(),u,o,'{"action":"refund"}','completed',jsonb_build_object('id','re_suite','currency','gbp','amount',500,'status','succeeded','created',extract(epoch from now())));
 insert into billing_events(stripe_event_id,event_type,payload)values('evt_suite','refund.updated',jsonb_build_object('data',jsonb_build_object('object',jsonb_build_object('id','re_suite','currency','gbp','amount',500,'status','succeeded','created',extract(epoch from now())))));
 result:=platform_revenue(u,sid,current_date-30,current_date);
 if not exists(select 1 from jsonb_array_elements(result->'currencies') x where x->>'currency'='gbp' and (x->>'mrr_cents')::numeric=1000 and (x->>'arr_cents')::numeric=12000 and (x->>'refunded_cents')::numeric=500 and (x->>'net_collected_cents')::numeric=9500 and (x->>'outstanding_cents')::numeric=700) then raise exception 'Currency, annual normalization, outstanding or refund deduplication failed: %',result;end if;
 if result->'currencies' is null or result->'notes' is null then raise exception 'Revenue output incomplete';end if;
 result:=platform_health(u,sid);
 if result->'summary' is null then raise exception 'Health output incomplete';end if;
 perform platform_acknowledge_alert(u,sid,'trial:test',true);
 if not exists(select 1 from app_private.platform_alert_acknowledgements where actor_id=u and alert_id='trial:test') then raise exception 'Alert acknowledgement missing';end if;
 if has_function_privilege('authenticated','public.platform_billing_finish(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') then raise exception 'Public mutation grant leaked';end if;
end $$;
rollback;
