begin;
create table app_private.platform_billing_requests(
 id uuid primary key,actor_id uuid not null,organization_id uuid not null,payload jsonb not null,
 status text not null check(status in ('pending','completed','failed')),result jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- Match effective-account recovery ordering without sorting its full history.
create index platform_billing_requests_account_history on app_private.platform_billing_requests
 (organization_id,(case when status='pending' then 0 else 1 end),created_at desc);
-- The account mutex checks only unresolved receipts; completed history stays out.
create index platform_billing_requests_pending_account on app_private.platform_billing_requests
 (organization_id,id) where status='pending';
create table app_private.platform_alert_acknowledgements(actor_id uuid not null,alert_id text not null,acknowledged_at timestamptz not null default now(),primary key(actor_id,alert_id));
alter table app_private.platform_billing_requests enable row level security;
alter table app_private.platform_alert_acknowledgements enable row level security;
revoke all on app_private.platform_billing_requests,app_private.platform_alert_acknowledgements from public,anon,authenticated,service_role;
create function public.platform_billing_context(p_auth uuid,p_session uuid,p_org uuid,p_invoice uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare account uuid:=p_org;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'billing.read');
 if not exists(select 1 from public.organizations where id=p_org) then raise exception 'Organization not found';end if;
 if to_regprocedure('app_private.billing_account(uuid)') is not null then execute 'select app_private.billing_account($1)' into account using p_org;end if;
 return jsonb_build_object('billingOrganizationId',account,'subscription',(select to_jsonb(s) from public.organization_subscriptions s where organization_id=account),
 'requests',coalesce((select jsonb_agg(x) from(select id,status,payload,created_at,updated_at,result,actor_id=p_auth as can_retry,(actor_id=p_auth or exists(select 1 from app_private.platform_owners where auth_user_id=p_auth)) as can_reconcile from app_private.platform_billing_requests where organization_id=account order by case when status='pending' then 0 else 1 end,created_at desc limit 20)x),'[]'),
 'plans',coalesce((select jsonb_agg(to_jsonb(p) order by sort_order) from public.billing_plans p where is_active),'[]'),
 'invoice',(select to_jsonb(i) from public.billing_invoices i where id=p_invoice and organization_id=account));
end $$;
create function public.platform_billing_begin(p_auth uuid,p_session uuid,p_request uuid,p_org uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare r app_private.platform_billing_requests%rowtype;account uuid:=p_org;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'billing.manage');
 if p_request is null or p_payload is null or p_payload->>'action' is null or p_payload->>'reason' is null or p_payload->>'action' not in ('change_plan','extend_trial','cancel_subscription','refund') or length(trim(p_payload->>'reason')) not between 8 and 500 then raise exception 'Invalid action';end if;
 if not exists(select 1 from public.organizations where id=p_org) then raise exception 'Organization not found';end if;
 if to_regprocedure('app_private.billing_account(uuid)') is not null then execute 'select app_private.billing_account($1)' into account using p_org;end if;
 perform pg_advisory_xact_lock(hashtextextended(account::text,0));
 select * into r from app_private.platform_billing_requests where id=p_request for update;
 if found then
  if r.actor_id<>p_auth or r.organization_id<>account or r.payload<>p_payload then raise exception 'Request conflict';end if;
  if r.status='completed' then return jsonb_build_object('status',r.status,'result',r.result);end if;
  if r.created_at<now()-interval '23 hours' then raise exception 'Request expired; inspect provider before a new request';end if;
  if r.status='pending' and r.updated_at>now()-interval '2 minutes' then raise exception 'Request in progress';end if;
 else
  insert into app_private.platform_billing_requests(id,actor_id,organization_id,payload,status) values(p_request,p_auth,account,p_payload,'failed');
 end if;
 if exists(select 1 from app_private.platform_billing_requests where organization_id=account and id<>p_request and status='pending') then raise exception 'Another billing operation needs reconciliation';end if;
 update app_private.platform_billing_requests set status='pending',updated_at=now() where id=p_request;
 insert into app_private.platform_audit(actor_id,organization_id,action,reason) values(p_auth,account,'billing.'||(p_payload->>'action')||'.requested',p_payload->>'reason');
 return jsonb_build_object('status','pending');
end $$;
create function public.platform_billing_finish(p_auth uuid,p_session uuid,p_request uuid,p_result jsonb,p_success boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare r app_private.platform_billing_requests%rowtype;trial timestamptz;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'billing.manage');
 select * into r from app_private.platform_billing_requests where id=p_request and (actor_id=p_auth or exists(select 1 from app_private.platform_owners where auth_user_id=p_auth)) for update;
 if not found then raise exception 'Request missing';end if;
 if r.status='completed' then return true;end if;
 if p_success and p_result->>'local'='true' then
  if r.payload->>'action'<>'extend_trial' then raise exception 'Invalid local operation';end if;
  trial:=(r.payload->>'trialEnd')::timestamptz;
  update public.organization_subscriptions set trial_end=trial,updated_at=now()
  where organization_id=r.organization_id and stripe_subscription_id is null and status='trialing' and trial>coalesce(trial_end,now()) and trial>now() and trial<=now()+interval '366 days';
  if not found then raise exception 'Only existing trials can be extended';end if;
 end if;
 update app_private.platform_billing_requests set status=case when p_success then 'completed' when p_result->>'retryable'='true' then 'pending' else 'failed' end,result=p_result,updated_at=now() where id=p_request;
 insert into app_private.platform_audit(actor_id,organization_id,action,reason) values(p_auth,r.organization_id,'billing.'||(r.payload->>'action')||case when p_success then '.completed' else '.failed' end,r.payload->>'reason');
 return true;
end $$;

create function public.platform_revenue(p_auth uuid,p_session uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare revenue_result jsonb;starting bigint;lost bigint;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'analytics.read');
 if p_from>p_to then raise exception 'Invalid dates';end if;
 select count(*) into starting from public.organization_subscriptions where created_at<p_from and (ended_at is null or ended_at>=p_from) and stripe_subscription_id is not null;
 select count(*) into lost from public.organization_subscriptions where ended_at>=p_from and ended_at<p_to+1 and created_at<p_from and stripe_subscription_id is not null;
 with recurring as (
 select coalesce(p.currency,'unknown') currency,case when count(*) filter(where p.amount_cents is null or p.billing_interval is null or p.billing_interval not in ('month','year'))>0 then null else sum(case p.billing_interval when 'month' then p.amount_cents when 'year' then p.amount_cents/12.0 else null end) end mrr
 from (select distinct on(coalesce(stripe_subscription_id,id::text)) * from public.organization_subscriptions order by coalesce(stripe_subscription_id,id::text),updated_at desc) s
 left join public.billing_plans p on p.code=s.plan_code where s.status='active' group by p.currency
 ), paid as (
 select currency,sum(coalesce(amount_paid_cents,0)) paid from public.billing_invoices where status='paid' and coalesce(issued_at,created_at)>=p_from and coalesce(issued_at,created_at)<p_to+1 group by currency
 ), outstanding as (
 select currency,sum(greatest(coalesce(amount_due_cents,0)-coalesce(amount_paid_cents,0),0)) due from public.billing_invoices where status='open' group by currency
 ), refunds_raw as (
 select result->>'id' id,result->>'currency' currency,(result->>'amount')::numeric amount,to_timestamp((result->>'created')::numeric) refunded_at,updated_at
 from app_private.platform_billing_requests where status='completed' and payload->>'action'='refund' and result->>'status'='succeeded'
 union all
 select payload#>>'{data,object,id}',payload#>>'{data,object,currency}',(payload#>>'{data,object,amount}')::numeric,to_timestamp((payload#>>'{data,object,created}')::numeric),created_at
 from public.billing_events where event_type in ('refund.created','refund.updated') and payload#>>'{data,object,status}'='succeeded'
 ), refunds as (select currency,sum(amount) refunded from (select distinct on(id) * from refunds_raw order by id,updated_at desc) x where refunded_at>=p_from and refunded_at<p_to+1 group by currency),
 currencies as (select currency from recurring union select currency from paid union select currency from outstanding union select currency from refunds)
 select coalesce(jsonb_agg(jsonb_build_object('currency',c.currency,'mrr_cents',round(case when r.currency is null then 0 else r.mrr end,2),'arr_cents',round((case when r.currency is null then 0 else r.mrr end)*12,2),'paid_cents',coalesce(p.paid,0),'refunded_cents',coalesce(f.refunded,0),'net_collected_cents',coalesce(p.paid,0)-coalesce(f.refunded,0),'outstanding_cents',coalesce(o.due,0)) order by c.currency),'[]') into revenue_result
 from currencies c left join recurring r using(currency) left join paid p using(currency) left join outstanding o using(currency) left join refunds f using(currency);
 return jsonb_build_object('currencies',revenue_result,'from',p_from,'to',p_to,'churn',jsonb_build_object('canceled',lost,'starting_subscriptions',starting,'rate',case when starting>0 then round(lost::numeric/starting*100,2) else null end),
 'notes',jsonb_build_array('MRR/ARR are current catalog-based estimates for active subscriptions; exclude trials, discounts, taxes, quantity and usage. They are not historical revenue. Missing catalog values are unavailable, not zero.','Collections use mirrored invoice dates. Outstanding is current open invoices. Currencies are never combined.','Refunds include successful console refunds and refund.created/refund.updated webhook records; enable these events in Stripe. Older external refunds may be missing.','Churn uses retained subscription rows and ended_at; deleted organizations and replaced subscriptions can leave incomplete history.'));
end $$;

create function public.platform_health(p_auth uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb;objects bigint;bytes numeric;missing bigint;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'health.read');
 select count(*),sum(case when metadata->>'size' ~ '^\d+$' then (metadata->>'size')::numeric else null end),count(*) filter(where metadata->>'size' is null or metadata->>'size' !~ '^\d+$') into objects,bytes,missing from storage.objects;
 with alerts as (
 select 'payment:'||s.id||':'||coalesce(s.last_payment_at,s.updated_at)::text id,'payment_failed' kind,s.organization_id,'Subscription payment requires attention' message,s.updated_at created_at from public.organization_subscriptions s where status in ('past_due','unpaid') or last_payment_status='failed'
 union all select 'trial:'||s.id||':'||s.trial_end::text,'trial_expiry',s.organization_id,'Trial expires within seven days',s.trial_end from public.organization_subscriptions s where status='trialing' and trial_end between now() and now()+interval '7 days'
 union all select 'cleanup:'||j.id||':'||j.attempts::text,'cleanup_failed',j.organization_id,'Organization cleanup needs attention',j.created_at from app_private.organization_deletions j where j.last_error is not null and j.status<>'completed'
 ) select jsonb_build_object('summary',jsonb_build_object('failed_webhooks',(select count(*) from public.billing_events where processing_error is not null),'pending_cleanup',(select count(*) from app_private.organization_deletions where status<>'completed'),
 'stale_devices',(select count(*) from public.tracker_devices d left join public.tracker_device_presence p on p.device_id=d.id where d.revoked_at is null and d.expires_at>now() and coalesce(p.received_at,d.created_at)<now()-interval '24 hours'),
 'storage_bytes',case when missing=0 then coalesce(bytes,0) else null end,'storage_objects',objects),
 'webhooks',coalesce((select jsonb_agg(x) from(select stripe_event_id,event_type,organization_id,processing_error,created_at from public.billing_events where processing_error is not null order by created_at desc limit 100)x),'[]'),
 'devices',coalesce((select jsonb_agg(x) from(select d.id,d.organization_id,d.name,d.platform,p.received_at last_seen_at from public.tracker_devices d left join public.tracker_device_presence p on p.device_id=d.id where d.revoked_at is null and d.expires_at>now() and coalesce(p.received_at,d.created_at)<now()-interval '24 hours' order by p.received_at nulls first limit 100)x),'[]'),
 'jobs',coalesce((select jsonb_agg(x) from(select id,organization_id,organization_name,status,stage,attempts,last_error from app_private.organization_deletions where status<>'completed' order by created_at desc limit 100)x),'[]'),
 'alerts',coalesce((select jsonb_agg(x) from(select a.*,k.acknowledged_at from alerts a left join app_private.platform_alert_acknowledgements k on k.alert_id=a.id and k.actor_id=p_auth order by a.created_at desc limit 100)x),'[]'),
 'notes',jsonb_build_array('Lists show up to 100 latest records. Counts cover all records.','Stale devices have no heartbeat for 24 hours; offline machines may be intentional. This is not proof of a sync failure.','Storage bytes are object metadata totals; unknown sizes return unavailable. Alerts are evaluated when this page refreshes.')) into result;
 return result;
end $$;
create function public.platform_acknowledge_alert(p_auth uuid,p_session uuid,p_id text,p_ack boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
 perform app_private.require_platform_permission(p_auth,p_session,'alerts.manage');
 if length(p_id)>200 or p_id !~ '^(payment|trial|cleanup):' then raise exception 'Invalid alert';end if;
 if p_ack then insert into app_private.platform_alert_acknowledgements(actor_id,alert_id)values(p_auth,p_id)on conflict(actor_id,alert_id)do update set acknowledged_at=now();
 else delete from app_private.platform_alert_acknowledgements where actor_id=p_auth and alert_id=p_id;end if;
 return true;
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('platform_billing_context','platform_billing_begin','platform_billing_finish','platform_revenue','platform_health','platform_acknowledge_alert')loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
commit;
