begin;
-- Proposal decisions, project creation, client linkage and delivery intent commit
-- together. Only the verified server boundary may invoke this transaction.
create table public.proposal_decision_emails (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 proposal_id uuid not null references public.project_proposals(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 decision text not null check(decision in ('accepted','rejected','needs_info')),
 title text not null, reason text, created_at timestamptz not null default now(),
 delivered_at timestamptz, attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, last_error text
);
alter table public.proposal_decision_emails enable row level security;
revoke all on public.proposal_decision_emails from public,anon,authenticated;
grant all on public.proposal_decision_emails to service_role;
create index proposal_decision_emails_pending on public.proposal_decision_emails(next_attempt_at) where delivered_at is null;
-- RLS cannot hide internal_notes. Browser overview uses only these public
-- columns; full staff details remain behind the verified proposals API.
revoke select on public.project_proposals from public,anon,authenticated;
grant select(id,organization_id,client_id,title,description,budget,currency,desired_deadline,status,decision_reason,decided_by,decided_at,assigned_manager_id,project_id,attachment_path,attachment_name,attachment_type,attachment_size,created_at,updated_at,estimated_cost,estimated_hours,estimated_timeline_days,estimated_by,estimated_at) on public.project_proposals to authenticated;
-- A direct client insert cannot pre-populate the staff's estimate or notes.
revoke insert on public.project_proposals from public,anon,authenticated;
grant insert(id,organization_id,client_id,title,description,budget,currency,desired_deadline,status,attachment_path,attachment_name,attachment_type,attachment_size) on public.project_proposals to authenticated;
create policy proposal_decisions_server_only on public.project_proposals as restrictive for update to authenticated using(false) with check(false);

create or replace function public.decide_project_proposal(p_org uuid,p_proposal uuid,p_actor uuid,p_actor_type text,p_decision text,
 p_reason text default null,p_manager uuid default null,p_manager_type text default null,p_cost numeric default null,
 p_hours numeric default null,p_days integer default null,p_internal_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare m public.memberships%rowtype; mgr public.memberships%rowtype; p public.project_proposals%rowtype;
 project_row public.projects%rowtype; manager_type text; notice_id uuid;
begin
 perform app_private.lock_quota(p_org);
 select * into m from public.memberships where organization_id=p_org and user_id=p_actor and user_type=p_actor_type and status='active' for share;
 if not found or p_actor_type not in ('admin','developer') or not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='proposal.decide'),m.role in ('owner','admin','manager'),false) then
  raise exception 'PROPOSAL_FORBIDDEN' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('accepted','rejected','needs_info','in_review','estimate') or (p_decision in ('rejected','needs_info') and nullif(btrim(p_reason),'') is null) then
  raise exception 'PROPOSAL_INVALID' using errcode='22023'; end if;
 select * into p from public.project_proposals where id=p_proposal and organization_id=p_org for update;
 if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
 if p.status='accepted' and p_decision='accepted' then
  select * into project_row from public.projects where id=p.project_id and organization_id=p_org and proposal_id=p.id;
  if not found or not exists(select 1 from public.project_clients where organization_id=p_org and project_id=p.project_id and client_id=p.client_id) then
   raise exception 'PROPOSAL_CONFLICT: accepted project requires repair'; end if;
  return jsonb_build_object('proposal',to_jsonb(p),'project',to_jsonb(project_row),'replayed',true);
 end if;
 if p.status in ('accepted','rejected') then raise exception 'PROPOSAL_CONFLICT: decision is terminal'; end if;
 if p.status='needs_info' and p_decision='needs_info' and nullif(btrim(p_reason),'') is not distinct from nullif(btrim(p.decision_reason),'') then
  return jsonb_build_object('proposal',to_jsonb(p),'replayed',true);
 end if;
 if p_decision='estimate' then
  if (p_cost is null and p_hours is null) or p_cost<0 or p_hours<0 or p_days<0 or
    p_cost::text in ('NaN','Infinity','-Infinity') or p_hours::text in ('NaN','Infinity','-Infinity') then
   raise exception 'PROPOSAL_INVALID: invalid estimate' using errcode='22023'; end if;
  update public.project_proposals set status='in_review',estimated_cost=p_cost,estimated_hours=p_hours,
   estimated_timeline_days=p_days,internal_notes=coalesce(left(p_internal_notes,5000),internal_notes),estimated_by=p_actor,estimated_at=now()
   where id=p.id returning * into p;
  return jsonb_build_object('proposal',to_jsonb(p));
 end if;
 if p_decision='accepted' then
  if not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='project.create'),m.role in ('owner','admin','manager','team_lead'),false) then raise exception 'PROPOSAL_FORBIDDEN' using errcode='42501'; end if;
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED'; end if;
  perform id from public.clients where id=p.client_id and organization_id=p_org and status='active' for share;
  if not found then raise exception 'PROPOSAL_INVALID: inactive client' using errcode='22023'; end if;
  perform id from public.memberships where organization_id=p_org and user_id=p.client_id and user_type='client' and status='active' for share;
  if not found then raise exception 'PROPOSAL_INVALID: inactive client membership' using errcode='22023'; end if;
  if p_manager is not null then
   if not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='project.assign_manager'),m.role in ('owner','admin'),false) then raise exception 'PROPOSAL_FORBIDDEN' using errcode='42501'; end if;
   manager_type:=p_manager_type;
   if manager_type is null then
    select case when count(distinct user_type)=1 then min(user_type) end into manager_type from public.memberships where organization_id=p_org and user_id=p_manager;
   end if;
   select * into mgr from public.memberships where organization_id=p_org and user_id=p_manager and user_type=manager_type and status='active' for share;
   if not found or manager_type not in ('admin','developer') or mgr.role not in ('owner','admin','manager','team_lead') then raise exception 'PROPOSAL_INVALID: invalid or ambiguous manager' using errcode='22023'; end if;
  end if;
  -- The existing project quota and typed-manager roster triggers remain active.
  insert into public.projects(organization_id,name,description,status,budget,deadline,created_by,created_by_type,manager_id,manager_type,proposal_id)
  values(p_org,p.title,p.description,'pending',coalesce(p.estimated_cost,p.budget),
   case when p.estimated_timeline_days>0 then (now() at time zone 'UTC')::date+p.estimated_timeline_days else p.desired_deadline end,
   p_actor,p_actor_type,p_manager,manager_type,p.id) returning * into project_row;
  insert into public.project_clients(organization_id,project_id,client_id) values(p_org,project_row.id,p.client_id);
 end if;
 update public.project_proposals set status=p_decision,decision_reason=nullif(btrim(p_reason),''),decided_by=p_actor,decided_at=now(),
  project_id=case when p_decision='accepted' then project_row.id else project_id end,
  assigned_manager_id=case when p_decision='accepted' then p_manager else assigned_manager_id end
  where id=p.id returning * into p;
 if p_decision in ('accepted','rejected','needs_info') then
  insert into public.proposal_decision_emails(organization_id,proposal_id,client_id,decision,title,reason)
  values(p_org,p.id,p.client_id,p_decision,p.title,p.decision_reason) returning id into notice_id;
 end if;
 if p_decision='accepted' and p_manager is not null then
  insert into public.notifications(organization_id,admin_id,admin_recipient_type,developer_id,admin_email,type,category,title,message,entity_type,entity_id,project_id,read)
  values(p_org,case when manager_type='admin' then p_manager end,case when manager_type='admin' then 'admin' end,
   case when manager_type='developer' then p_manager end,case when manager_type='admin' then mgr.email end,
   'project_assigned','assignment','A project has been assigned to you',format('"%s" came from a client proposal and is yours to plan.',project_row.name),'project',project_row.id,project_row.id,false);
 end if;
 return jsonb_build_object('proposal',to_jsonb(p),'project',case when p_decision='accepted' then to_jsonb(project_row) end,'emailQueued',notice_id is not null);
end $$;
revoke all on function public.decide_project_proposal(uuid,uuid,uuid,text,text,text,uuid,text,numeric,numeric,integer,text) from public,anon,authenticated;
grant execute on function public.decide_project_proposal(uuid,uuid,uuid,text,text,text,uuid,text,numeric,numeric,integer,text) to service_role;

create or replace function public.claim_proposal_decision_emails(p_proposal uuid default null,p_limit integer default 25)
returns setof public.proposal_decision_emails language sql security definer set search_path=pg_catalog,public as $$
 update public.proposal_decision_emails e set lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=e.attempts+1
 where e.id in (select id from public.proposal_decision_emails where delivered_at is null and next_attempt_at<=now()
 and (lease_until is null or lease_until<now()) and (p_proposal is null or proposal_id=p_proposal)
 order by created_at,id limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked) returning e.*;
$$;
create or replace function public.finish_proposal_decision_email(p_id uuid,p_lease uuid,p_delivered boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.proposal_decision_emails set delivered_at=case when p_delivered then now() end,
 lease_id=null,lease_until=null,next_attempt_at=now()+interval '15 minutes',last_error=case when p_delivered then null else 'Delivery unavailable; retry scheduled' end
 where id=p_id and lease_id=p_lease and delivered_at is null;
 return found;
end $$;
revoke all on function public.claim_proposal_decision_emails(uuid,integer),public.finish_proposal_decision_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_proposal_decision_emails(uuid,integer),public.finish_proposal_decision_email(uuid,uuid,boolean) to service_role;
commit;
