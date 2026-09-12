begin;
-- Public object downloads bypass all Storage RLS. Refuse deployment until the
-- existing invoice bucket is private; never claim policy protection otherwise.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  if exists(select 1 from storage.buckets where id='invoices' and public) then
   raise exception 'INVOICE_BUCKET_PUBLIC: set the invoices bucket Public OFF in Supabase Storage before running this migration';
  end if;
 end if;
end $$;
drop trigger if exists trg_invoice_line_not_billed on public.invoice_lines;
drop trigger if exists trg_invoice_lines_sync on public.invoice_lines;
alter table public.invoice_lines add column user_type text check(user_type in ('admin','developer'));
update public.invoice_lines l set user_type=x.user_type from (
 select organization_id,user_id,min(user_type) user_type from public.memberships where user_type in ('admin','developer')
 group by organization_id,user_id having count(distinct user_type)=1
) x where l.source='timesheet' and l.organization_id=x.organization_id and l.user_id=x.user_id and
 ((x.user_type='admin' and exists(select 1 from public.admin_users p where p.id=x.user_id and p.organization_id=x.organization_id))
 or (x.user_type='developer' and exists(select 1 from public.developers p where p.id=x.user_id and p.organization_id=x.organization_id)));
create function public.auth_invoice_permission(p_key text) returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.auth_org() is not null and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
 and p_key in ('invoice.view','invoice.manage','pnl.view')
 and coalesce(public.auth_override(p_key),public.auth_role() in ('owner','admin','finance'),false);
$$;
revoke all on function public.auth_invoice_permission(text) from public,anon;
grant execute on function public.auth_invoice_permission(text) to authenticated;
create function public.bill_rate_for(p_project uuid,p_user uuid,p_type text) returns numeric language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce((select pm.bill_rate from public.project_members pm join public.projects p on p.id=pm.project_id and p.organization_id=pm.organization_id
  where pm.project_id=p_project and pm.user_id=p_user and pm.user_type=p_type and pm.bill_rate is not null limit 1),
  (select p.default_bill_rate from public.projects p where p.id=p_project));
$$;
-- Legacy two-argument callers cannot choose a profile type by UUID alone.
create or replace function public.bill_rate_for(p_project uuid,p_user uuid) returns numeric language sql stable security invoker set search_path=pg_catalog,public as $$
 select case when count(distinct m.user_type)=1 then public.bill_rate_for(p_project,p_user,min(m.user_type)) else null end
 from public.memberships m join public.projects p on p.organization_id=m.organization_id and p.id=p_project where m.user_id=p_user and m.user_type in ('admin','developer');
$$;
revoke all on function public.bill_rate_for(uuid,uuid) from public,anon;
revoke execute on function public.bill_rate_for(uuid,uuid) from authenticated;
grant execute on function public.bill_rate_for(uuid,uuid) to service_role;
revoke all on function public.bill_rate_for(uuid,uuid,text) from public,anon;
revoke execute on function public.bill_rate_for(uuid,uuid,text) from authenticated;
grant execute on function public.bill_rate_for(uuid,uuid,text) to service_role;

-- Acquire the organization lock before UPDATE/DELETE takes row locks.
create function public.lock_invoice_statement() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); begin if org is not null then perform app_private.lock_quota(org); end if; return null; end $$;
create trigger aa_invoice_statement_lock before insert or update or delete on public.invoices for each statement execute function public.lock_invoice_statement();
create trigger aa_invoice_statement_lock before insert or update or delete on public.invoice_lines for each statement execute function public.lock_invoice_statement();
revoke all on function public.lock_invoice_statement() from public,anon,authenticated;
create function public.guard_invoice_header() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid; expected numeric;
begin
 org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
 if tg_op='DELETE' and (not exists(select 1 from public.organizations where id=org) or app_private.organization_deleting(org)) then return old; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 if auth.uid() is not null and (org is distinct from public.auth_org() or not coalesce(public.auth_invoice_permission('invoice.manage'),false)) then raise exception 'INVOICE_FORBIDDEN' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 if tg_op='UPDATE' and new.organization_id is distinct from old.organization_id then raise exception 'INVOICE_ORGANIZATION_IMMUTABLE' using errcode='42501'; end if;
 if new.project_id is not null and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=org) then raise exception 'INVOICE_PROJECT_INVALID' using errcode='22023'; end if;
 if new.client_id is not null and not exists(select 1 from public.clients c where c.id=new.client_id and c.organization_id=org) then raise exception 'INVOICE_CLIENT_INVALID' using errcode='22023'; end if;
 if new.amount is null or new.amount<0 or new.amount::text in ('NaN','Infinity','-Infinity') then raise exception 'INVOICE_AMOUNT_INVALID' using errcode='22023'; end if;
 if tg_op='UPDATE' and exists(select 1 from public.invoice_lines l where l.invoice_id=new.id) then
  select sum(l.amount) into expected from public.invoice_lines l where l.invoice_id=new.id;
  if new.amount is distinct from expected then raise exception 'INVOICE_TOTAL_MISMATCH' using errcode='22023'; end if;
  if new.project_id is distinct from old.project_id then raise exception 'INVOICE_PROJECT_IMMUTABLE' using errcode='42501'; end if;
 end if;
 if tg_op='UPDATE' and new.currency is distinct from old.currency and coalesce(nullif(upper(new.currency),''),'USD')<>'USD'
  and exists(select 1 from public.invoice_lines l where l.invoice_id=new.id and l.source='timesheet') then raise exception 'INVOICE_TIMESHEET_CURRENCY_INVALID' using errcode='22023'; end if;
 if tg_op='UPDATE' and old.status='void' and new.status is distinct from 'void' then
  if exists(select 1 from public.invoice_lines own join public.invoice_lines other on other.organization_id=own.organization_id and other.project_id=own.project_id and other.user_id=own.user_id and other.week_start=own.week_start
   and (other.user_type=own.user_type or other.user_type is null or own.user_type is null)
   join public.invoices i on i.id=other.invoice_id where own.invoice_id=new.id and own.source='timesheet' and other.source='timesheet' and i.id<>new.id and i.status is distinct from 'void') then
   raise exception 'INVOICE_ALREADY_BILLED' using errcode='23505'; end if;
 end if;
 return new;
end $$;
create trigger invoice_header_authority before insert or update or delete on public.invoices for each row execute function public.guard_invoice_header();
revoke all on function public.guard_invoice_header() from public,anon,authenticated;

create or replace function public.invoice_line_not_already_billed() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid; header public.invoices%rowtype; seconds bigint; rate numeric; hours numeric; previous_org uuid;
begin
 org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
 if tg_op='DELETE' and (not exists(select 1 from public.organizations where id=org) or app_private.organization_deleting(org)) then return old; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 if auth.uid() is not null and (org is distinct from public.auth_org() or not coalesce(public.auth_invoice_permission('invoice.manage'),false)) then raise exception 'INVOICE_FORBIDDEN' using errcode='42501'; end if;
 if tg_op='DELETE' then
  if old.source='timesheet' and exists(select 1 from public.invoices i where i.id=old.invoice_id and i.status is distinct from 'void') then raise exception 'INVOICE_TIMESHEET_LINE_IMMUTABLE' using errcode='42501'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and new.organization_id is distinct from old.organization_id then raise exception 'INVOICE_ORGANIZATION_IMMUTABLE' using errcode='42501'; end if;
 select * into header from public.invoices where id=new.invoice_id and organization_id=org;
 if not found then raise exception 'INVOICE_PARENT_INVALID' using errcode='22023'; end if;
 if tg_op='UPDATE' and old.source='timesheet' then
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'INVOICE_TIMESHEET_LINE_IMMUTABLE' using errcode='42501'; end if;
  return new;
 end if;
 if new.quantity<=0 or new.unit_rate<0 or new.amount<0 or new.quantity::text in ('NaN','Infinity','-Infinity')
  or new.unit_rate::text in ('NaN','Infinity','-Infinity') or new.amount is distinct from round(new.quantity*new.unit_rate,2) then raise exception 'INVOICE_LINE_AMOUNT_INVALID' using errcode='22023'; end if;
 if new.project_id is not null and (new.project_id is distinct from header.project_id or not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=org)) then raise exception 'INVOICE_PROJECT_INVALID' using errcode='22023'; end if;
 if new.source='timesheet' then
  if coalesce(nullif(upper(header.currency),''),'USD')<>'USD' then raise exception 'INVOICE_TIMESHEET_CURRENCY_INVALID' using errcode='22023'; end if;
  if new.user_type is null or new.user_type not in ('admin','developer') or new.project_id is null or new.user_id is null or new.week_start is null
   or not isfinite(new.week_start) or extract(isodow from new.week_start)<>1 or new.project_id is distinct from header.project_id then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end if;
  if exists(select 1 from public.task_time_logs l where l.organization_id=org and l.developer_id=new.user_id and l.user_type is null and l.project_id=new.project_id and public.timesheet_week_of(l.started_at)=new.week_start) then raise exception 'INVOICE_IDENTITY_REVIEW_REQUIRED' using errcode='55000'; end if;
  select sum(l.seconds) into seconds from public.task_time_logs l join public.timesheets t on t.organization_id=l.organization_id and t.user_id=l.developer_id and t.user_type=l.user_type and t.week_start=public.timesheet_week_of(l.started_at)
   where l.organization_id=org and l.project_id=new.project_id and l.developer_id=new.user_id and l.user_type=new.user_type and t.week_start=new.week_start and t.status='approved' and l.is_billable and l.seconds>0;
  hours:=round(seconds::numeric/3600,2); rate:=public.bill_rate_for(new.project_id,new.user_id,new.user_type);
  if hours is null or hours<=0 then raise exception 'INVOICE_HOURS_UNAVAILABLE' using errcode='55000'; end if;
  if rate is null then raise exception 'INVOICE_RATE_REQUIRED' using errcode='55000'; end if;
  if new.quantity is distinct from hours or new.unit_rate is distinct from rate then raise exception 'INVOICE_DERIVED_AMOUNT_REQUIRED' using errcode='22023'; end if;
  if header.status is distinct from 'void' and exists(select 1 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
   where l.organization_id=org and l.source='timesheet' and l.project_id=new.project_id and l.user_id=new.user_id and l.week_start=new.week_start
   and (l.user_type=new.user_type or l.user_type is null) and l.id<>new.id and i.status is distinct from 'void') then raise exception 'INVOICE_ALREADY_BILLED' using errcode='23505'; end if;
 end if;
 return new;
end $$;
create trigger trg_invoice_line_not_billed before insert or update or delete on public.invoice_lines for each row execute function public.invoice_line_not_already_billed();
revoke all on function public.invoice_line_not_already_billed() from public,anon,authenticated;
create or replace function public.invoice_sync_amount() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare target uuid; ids uuid[];
begin
 if tg_op='INSERT' then ids:=array[new.invoice_id]; elsif tg_op='DELETE' then ids:=array[old.invoice_id]; else ids:=array[old.invoice_id,new.invoice_id]; end if;
 for target in select distinct x from unnest(ids) x loop
  if not exists(select 1 from public.invoices i join public.organizations o on o.id=i.organization_id where i.id=target and not app_private.organization_deleting(i.organization_id)) then continue; end if;
  update public.invoices set amount=coalesce((select sum(amount) from public.invoice_lines where invoice_id=target),0) where id=target;
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger trg_invoice_lines_sync after insert or update or delete on public.invoice_lines for each row execute function public.invoice_sync_amount();
revoke all on function public.invoice_sync_amount() from public,anon,authenticated;
create or replace view public.billable_hours_v with(security_invoker=true) as
with agg as (select l.organization_id,l.project_id,l.developer_id user_id,l.user_type,public.timesheet_week_of(l.started_at) week_start,sum(l.seconds) seconds
 from public.task_time_logs l join public.timesheets t on t.organization_id=l.organization_id and t.user_id=l.developer_id and t.user_type=l.user_type
 and t.week_start=public.timesheet_week_of(l.started_at) and t.status='approved'
 where l.is_billable and l.seconds>0 and l.project_id is not null and l.user_type in ('admin','developer')
 group by l.organization_id,l.project_id,l.developer_id,l.user_type,public.timesheet_week_of(l.started_at))
select a.organization_id,a.project_id,p.name project_name,a.user_id,a.week_start,round(a.seconds::numeric/3600,2) hours,
 public.bill_rate_for(a.project_id,a.user_id,a.user_type) rate,
 exists(select 1 from public.invoice_lines il join public.invoices i on i.id=il.invoice_id where il.organization_id=a.organization_id and il.source='timesheet'
 and il.project_id=a.project_id and il.user_id=a.user_id and (il.user_type=a.user_type or il.user_type is null) and il.week_start=a.week_start and i.status is distinct from 'void') invoiced,a.user_type
from agg a join public.projects p on p.id=a.project_id and p.organization_id=a.organization_id
where current_user in ('postgres','service_role') or public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage');
create or replace view public.project_pnl_v with(security_invoker=true) as
with hours as(select l.organization_id,l.project_id,round(sum(l.seconds)::numeric/3600,2) total_hours,
 round(sum(l.seconds) filter(where ep.cost_rate is not null)::numeric/3600,2) costed_hours,
 case when bool_or(ep.cost_rate is null) then null else sum(l.seconds::numeric/3600*ep.cost_rate) end cost
 from public.task_time_logs l join public.timesheets t on t.organization_id=l.organization_id and t.user_id=l.developer_id and t.user_type=l.user_type
 and t.week_start=public.timesheet_week_of(l.started_at) and t.status='approved'
 left join public.employee_profiles ep on ep.organization_id=l.organization_id and ep.user_id=l.developer_id and ep.user_type=l.user_type
 where l.seconds is not null and l.project_id is not null and l.user_type in ('admin','developer') group by l.organization_id,l.project_id),
 currency_revenue as(select organization_id,project_id,coalesce(nullif(upper(currency),''),'USD') currency,sum(amount) amount from public.invoices
 where status is distinct from 'void' and project_id is not null group by organization_id,project_id,coalesce(nullif(upper(currency),''),'USD')),
 revenue as(select organization_id,project_id,bool_and(currency='USD') usd_only,sum(amount) invoiced,jsonb_object_agg(currency,amount) totals from currency_revenue group by organization_id,project_id)
select p.organization_id,p.id project_id,p.name project_name,
 case when coalesce(r.usd_only,true) then coalesce(r.invoiced,0)::numeric(12,2) else null::numeric(12,2) end invoiced,
 coalesce(h.total_hours,0) total_hours,coalesce(h.costed_hours,0) costed_hours,h.cost::numeric(12,2) cost,
 case when h.cost is null or not coalesce(r.usd_only,true) then null else (coalesce(r.invoiced,0)-h.cost)::numeric(12,2) end margin,
 coalesce(r.totals,'{}'::jsonb) invoice_currency_totals
from public.projects p left join hours h on h.project_id=p.id and h.organization_id=p.organization_id left join revenue r on r.project_id=p.id and r.organization_id=p.organization_id
where current_user in ('postgres','service_role') or public.auth_invoice_permission('pnl.view');

-- Financial aggregates are exposed through permission-checked service APIs;
-- close direct view/helper access, which could bypass endpoint permissions.
revoke all on public.billable_hours_v,public.project_pnl_v from public,anon,authenticated;
grant select on public.billable_hours_v,public.project_pnl_v to service_role;
-- Positive grants and explicit denials both follow the effective catalogue.
create policy invoice_staff_effective_read on public.invoices for select to authenticated using(organization_id=public.auth_org() and (public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage')));
create policy invoice_staff_effective_write on public.invoices for all to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage')) with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_lines_effective_read on public.invoice_lines for select to authenticated using(organization_id=public.auth_org() and (public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage')));
create policy invoice_lines_effective_write on public.invoice_lines for all to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage')) with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
-- Add restrictive guards alongside legacy permissive policies.
create policy invoice_read_authority on public.invoices as restrictive for select to authenticated using(organization_id=public.auth_org() and
 (public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage') or (public.auth_is_client() and public.auth_plan_feature('client_portal') and client_id=public.auth_app_user_id() and status<>'draft')));
create policy invoice_insert_authority on public.invoices as restrictive for insert to authenticated with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_update_authority on public.invoices as restrictive for update to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage')) with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_delete_authority on public.invoices as restrictive for delete to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
drop policy if exists invoice_lines_client_read on public.invoice_lines;
create policy invoice_lines_client_read on public.invoice_lines for select to authenticated using(public.auth_is_client() and public.auth_plan_feature('client_portal') and exists(select 1 from public.invoices i where i.id=invoice_id and i.organization_id=invoice_lines.organization_id and i.client_id=public.auth_app_user_id() and i.status<>'draft'));
create policy invoice_lines_read_authority on public.invoice_lines as restrictive for select to authenticated using(organization_id=public.auth_org() and
 (public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage') or (public.auth_is_client() and public.auth_plan_feature('client_portal') and exists(select 1 from public.invoices i where i.id=invoice_id and i.organization_id=invoice_lines.organization_id and i.client_id=public.auth_app_user_id() and i.status<>'draft'))));
create policy invoice_lines_insert_authority on public.invoice_lines as restrictive for insert to authenticated with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_lines_update_authority on public.invoice_lines as restrictive for update to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage')) with check(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_lines_delete_authority on public.invoice_lines as restrictive for delete to authenticated using(organization_id=public.auth_org() and public.auth_invoice_permission('invoice.manage'));
create policy invoice_storage_read_authority on storage.objects as restrictive for select to authenticated using(bucket_id<>'invoices' or
 (split_part(name,'/',1)=public.auth_org()::text and (public.auth_invoice_permission('invoice.view') or public.auth_invoice_permission('invoice.manage'))));
create policy invoice_storage_insert_authority on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'invoices' or
 (split_part(name,'/',1)=public.auth_org()::text and public.auth_invoice_permission('invoice.manage')));
create policy invoice_storage_update_authority on storage.objects as restrictive for update to authenticated using(bucket_id<>'invoices' or
 (split_part(name,'/',1)=public.auth_org()::text and public.auth_invoice_permission('invoice.manage'))) with check(bucket_id<>'invoices' or
 (split_part(name,'/',1)=public.auth_org()::text and public.auth_invoice_permission('invoice.manage')));
create policy invoice_storage_delete_authority on storage.objects as restrictive for delete to authenticated using(bucket_id<>'invoices' or
 (split_part(name,'/',1)=public.auth_org()::text and public.auth_invoice_permission('invoice.manage')));

create function public.raise_timesheet_invoice(p_project_id uuid,p_selections jsonb,p_client_id uuid default null,p_title text default null,p_due_at date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); project public.projects%rowtype; invoice public.invoices%rowtype; chosen jsonb; item record; n integer:=0; total numeric:=0;
 selected_user uuid; selected_type text; week date; seen text[]:='{}'; selection_key text; new_id uuid:=gen_random_uuid(); number text;
begin
 if not coalesce(public.auth_invoice_permission('invoice.manage'),false) then raise exception 'INVOICE_FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(p_selections) is distinct from 'array' or jsonb_array_length(p_selections) not between 1 and 200 or length(p_title)>200 or (p_due_at is not null and not isfinite(p_due_at)) then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select * into project from public.projects where id=p_project_id and organization_id=org;
 if not found then raise exception 'INVOICE_PROJECT_INVALID' using errcode='22023'; end if;
 if p_client_id is not null and not exists(select 1 from public.clients where id=p_client_id and organization_id=org) then raise exception 'INVOICE_CLIENT_INVALID' using errcode='22023'; end if;
 -- Full UUID number avoids count-based collisions with manual invoice numbers.
 number:='INV-'||upper(new_id::text);
 insert into public.invoices(id,organization_id,project_id,client_id,number,title,amount,status,due_at,created_by)
 values(new_id,org,p_project_id,p_client_id,number,coalesce(nullif(btrim(p_title),''),project.name),0,'draft',p_due_at::timestamp at time zone 'UTC',public.auth_app_user_id()) returning * into invoice;
 for chosen in select value from jsonb_array_elements(p_selections) loop
  if jsonb_typeof(chosen) is distinct from 'object' or not chosen ?& array['userId','userType','weekStart'] or chosen-array['userId','userType','weekStart']<>'{}'::jsonb
   or jsonb_typeof(chosen->'userId') is distinct from 'string' or jsonb_typeof(chosen->'userType') is distinct from 'string' or jsonb_typeof(chosen->'weekStart') is distinct from 'string' then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end if;
  begin selected_user:=(chosen->>'userId')::uuid; week:=(chosen->>'weekStart')::date;
  exception when others then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end;
  selected_type:=chosen->>'userType';
  if selected_type not in ('admin','developer') or not isfinite(week) or extract(isodow from week)<>1 or week::text<>chosen->>'weekStart' then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end if;
  selection_key:=selected_user::text||':'||selected_type||':'||week::text;
  if selection_key=any(seen) then raise exception 'INVOICE_SELECTION_INVALID' using errcode='22023'; end if;
  seen:=array_append(seen,selection_key);
  select * into item from public.billable_hours_v v where v.organization_id=org and v.project_id=p_project_id and v.user_id=selected_user and v.user_type=selected_type and v.week_start=week;
  if not found or item.hours<=0 then raise exception 'INVOICE_HOURS_UNAVAILABLE' using errcode='55000'; end if;
  if item.invoiced then raise exception 'INVOICE_ALREADY_BILLED' using errcode='23505'; end if;
  if item.rate is null then raise exception 'INVOICE_RATE_REQUIRED' using errcode='55000'; end if;
  insert into public.invoice_lines(organization_id,invoice_id,description,quantity,unit_rate,amount,source,project_id,user_id,user_type,week_start,created_by)
  values(org,new_id,project.name||' — '||item.hours||'h, week of '||week,item.hours,item.rate,round(item.hours*item.rate,2),'timesheet',p_project_id,selected_user,selected_type,week,public.auth_app_user_id());
  n:=n+1; total:=total+round(item.hours*item.rate,2);
 end loop;
 select * into invoice from public.invoices where id=new_id;
 return jsonb_build_object('invoice',to_jsonb(invoice),'lines',n,'total',total);
end $$;
revoke all on function public.raise_timesheet_invoice(uuid,jsonb,uuid,text,date) from public,anon,authenticated;
grant execute on function public.raise_timesheet_invoice(uuid,jsonb,uuid,text,date) to authenticated;
commit;
