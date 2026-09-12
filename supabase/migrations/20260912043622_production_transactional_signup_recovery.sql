begin;
alter table public.email_verifications add column signup_grant_hash text;
-- The emailed code proves mailbox access; a separate unguessable single-use
-- grant binds that proof to the browser that completed verification.
create function public.verify_signup_code(p_email text,p_code_hash text,p_grant_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.email_verifications%rowtype; mismatch integer:=0; i integer;
begin
 if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_grant_hash is null or p_grant_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('verified',false); end if;
 select * into v from public.email_verifications where email=lower(btrim(p_email)) order by created_at desc,id desc limit 1 for update;
 if v.id is null or v.consumed_at is not null or v.expires_at is null or v.expires_at<=now() or v.attempts>=5 or length(coalesce(v.code_hash,''))<>64 then return jsonb_build_object('verified',false); end if;
 -- Fixed-length full comparison avoids early-exit digest prefix comparison.
 for i in 1..64 loop mismatch:=mismatch | (ascii(substr(v.code_hash,i,1)) # ascii(substr(p_code_hash,i,1))); end loop;
 if mismatch<>0 then
  update public.email_verifications set attempts=attempts+1 where id=v.id;
  return jsonb_build_object('verified',false,'attemptsRemaining',greatest(0,4-v.attempts));
 end if;
 update public.email_verifications set verified_at=now(),signup_grant_hash=p_grant_hash where id=v.id;
 return jsonb_build_object('verified',true);
end $$;
revoke all on function public.verify_signup_code(text,text,text) from public,anon,authenticated;
grant execute on function public.verify_signup_code(text,text,text) to service_role;
create table app_private.signup_attempts (
 id uuid primary key default gen_random_uuid(), email text not null,
 profile_id uuid not null unique default gen_random_uuid(), organization_id uuid not null unique default gen_random_uuid(),
 auth_user_id uuid not null unique default gen_random_uuid(), details jsonb not null,
 subscription jsonb not null, terms_version text not null, accepted_ip inet,
 claim_id uuid not null, lease_until timestamptz not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create unique index signup_pending_email on app_private.signup_attempts(email) where completed_at is null;
alter table app_private.signup_attempts enable row level security;
revoke all on app_private.signup_attempts from public,anon,authenticated,service_role;

create function public.claim_signup(p_email text,p_claim uuid,p_details jsonb,p_plan text,p_terms text,p_grant_hash text,p_ip inet default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare a app_private.signup_attempts%rowtype; verification uuid; plan public.billing_plans%rowtype; sub jsonb; address text:=lower(btrim(p_email));
begin
 if address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(address)>254 or p_claim is null
   or p_grant_hash is null or p_grant_hash !~ '^[a-f0-9]{64}$'
   or p_terms is null or length(btrim(p_terms))=0 or jsonb_typeof(p_details) is distinct from 'object'
   or length(btrim(coalesce(p_details->>'fullName',''))) not between 1 and 120
   or length(btrim(coalesce(p_details->>'company',''))) not between 1 and 200 then raise exception 'SIGNUP_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('signup:'||address,0));
 select * into a from app_private.signup_attempts where email=address and completed_at is null for update;
 if a.id is not null and a.lease_until>now() then raise exception 'SIGNUP_BUSY'; end if;
 select id into verification from public.email_verifications where email=address and consumed_at is null and signup_grant_hash=p_grant_hash
   and verified_at is not null and verified_at>=now()-interval '60 minutes' order by verified_at desc limit 1 for update;
 if verification is null then raise exception 'SIGNUP_EMAIL_NOT_VERIFIED'; end if;
 if a.id is null then
   if exists(select 1 from public.admin_users where lower(btrim(email))=address)
     or exists(select 1 from public.developers where lower(btrim(email))=address)
     or exists(select 1 from public.clients where lower(btrim(email))=address)
     or exists(select 1 from public.memberships where lower(btrim(email))=address)
     or exists(select 1 from auth.users where lower(btrim(email))=address) then raise exception 'SIGNUP_ACCOUNT_EXISTS'; end if;
   select * into plan from public.billing_plans where code=lower(btrim(p_plan)) and is_active=true and trial_days>0 and code<>'free';
   if plan.code is null then sub:=jsonb_build_object('plan_code','free','status','active');
   else sub:=jsonb_build_object('plan_code',plan.code,'status','trialing','trial_start',now(),'trial_end',now()+make_interval(days=>plan.trial_days::integer)); end if;
   -- Only permitted fields enter the private reservation; passwords and client
   -- privilege/payment flags are never persisted or used as billing evidence.
   insert into app_private.signup_attempts(email,details,subscription,terms_version,accepted_ip,claim_id,lease_until)
   values(address,jsonb_build_object('fullName',btrim(p_details->>'fullName'),'company',btrim(p_details->>'company'),
     'industry',left(p_details->>'industry',200),'companySize',left(p_details->>'companySize',100),
     'country',left(p_details->>'country',100),'timezone',coalesce(nullif(p_details->>'timezone',''),'UTC')),
     sub,p_terms,p_ip,p_claim,now()+interval '5 minutes') returning * into a;
 else
   -- A recovery uses original consent and plan dates, not a new trial or a
   -- silently changed organization. Fresh email verification authorizes retry.
   update app_private.signup_attempts set claim_id=p_claim,lease_until=now()+interval '5 minutes',updated_at=now() where id=a.id returning * into a;
 end if;
 update public.email_verifications set consumed_at=now() where id=verification;
 return to_jsonb(a)-'accepted_ip';
end $$;

create function public.finish_signup(p_id uuid,p_claim uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare a app_private.signup_attempts%rowtype; u auth.users%rowtype; result jsonb;
begin
 select * into a from app_private.signup_attempts where id=p_id for update;
 if a.id is null or a.claim_id is distinct from p_claim then raise exception 'SIGNUP_UNAVAILABLE'; end if;
 if a.completed_at is null then
  if a.lease_until<=now() then raise exception 'SIGNUP_UNAVAILABLE'; end if;
  select * into u from auth.users where id=a.auth_user_id for share;
  if u.id is null or u.deleted_at is not null or u.email_confirmed_at is null or (u.banned_until is not null and u.banned_until>now())
    or lower(btrim(u.email)) is distinct from a.email
    or u.raw_app_meta_data->>'signup_id' is distinct from a.id::text
    or u.raw_app_meta_data->>'app_user_id' is distinct from a.profile_id::text
    or u.raw_app_meta_data->>'organization_id' is distinct from a.organization_id::text
    or u.raw_app_meta_data->>'user_type' is distinct from 'admin'
    or u.raw_app_meta_data->>'role' is distinct from 'owner' then raise exception 'SIGNUP_AUTH_UNCONFIRMED'; end if;
  if not exists(select 1 from public.billing_plans where code=a.subscription->>'plan_code' and is_active=true) then raise exception 'SIGNUP_PLAN_UNAVAILABLE'; end if;
  if to_regprocedure('app_private.organization_deleting(uuid)') is not null then
    if app_private.organization_deleting(a.organization_id) then raise exception 'SIGNUP_UNAVAILABLE'; end if;
  end if;
  insert into public.admin_users(id,full_name,company,email,is_verified,role,auth_user_id)
    values(a.profile_id,a.details->>'fullName',a.details->>'company',a.email,true,'admin',a.auth_user_id);
  insert into public.organizations(id,name,owner_id,industry,company_size,country,timezone)
    values(a.organization_id,a.details->>'company',a.profile_id,a.details->>'industry',a.details->>'companySize',a.details->>'country',a.details->>'timezone');
  update public.admin_users set organization_id=a.organization_id where id=a.profile_id and organization_id is null;
  insert into public.organization_subscriptions(organization_id,plan_code,status,trial_start,trial_end)
    values(a.organization_id,a.subscription->>'plan_code',a.subscription->>'status',(a.subscription->>'trial_start')::timestamptz,(a.subscription->>'trial_end')::timestamptz);
  insert into public.memberships(organization_id,user_id,user_type,email,role,status)
    values(a.organization_id,a.profile_id,'admin',a.email,'owner','active');
  insert into public.terms_acceptances(organization_id,user_id,user_type,email,document,document_version,entry_point,accepted_at,ip)
    values(a.organization_id,a.profile_id,'admin',a.email,'terms_of_service',a.terms_version,'signup',a.created_at,a.accepted_ip);
  update app_private.signup_attempts set completed_at=now(),updated_at=now() where id=a.id;
 end if;
 return jsonb_build_object('success',true,'admin',jsonb_build_object('id',a.profile_id,'email',a.email,'full_name',a.details->>'fullName','organization_id',a.organization_id,'auth_user_id',a.auth_user_id),
   'organizationId',a.organization_id,'organizationName',a.details->>'company',
   'plan',jsonb_build_object('code',a.subscription->>'plan_code','status',a.subscription->>'status','trialEndsAt',a.subscription->>'trial_end'));
end $$;

create function public.release_signup_claim(p_id uuid,p_claim uuid) returns void
language sql security definer set search_path=pg_catalog,public,app_private as $$
 update app_private.signup_attempts set lease_until=now(),updated_at=now() where id=p_id and claim_id=p_claim and completed_at is null;
$$;
create function public.claim_signup_recovery(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare a record; c uuid; result jsonb:='[]';
begin
 for a in select s.id from app_private.signup_attempts s join auth.users u on u.id=s.auth_user_id
   where s.completed_at is null and s.lease_until<=now() and u.deleted_at is null and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=now()) and lower(btrim(u.email))=s.email
    and u.raw_app_meta_data->>'signup_id'=s.id::text and u.raw_app_meta_data->>'organization_id'=s.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=s.profile_id::text and u.raw_app_meta_data->>'role'='owner' and u.raw_app_meta_data->>'user_type'='admin'
   order by s.updated_at limit least(greatest(p_limit,1),25) for update of s skip locked
 loop
  c:=gen_random_uuid(); update app_private.signup_attempts set claim_id=c,lease_until=now()+interval '5 minutes',updated_at=now() where id=a.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',a.id,'claim_id',c));
 end loop;
 return result;
end $$;
revoke all on function public.claim_signup(text,uuid,jsonb,text,text,text,inet),public.finish_signup(uuid,uuid),public.release_signup_claim(uuid,uuid),public.claim_signup_recovery(integer) from public,anon,authenticated;
grant execute on function public.claim_signup(text,uuid,jsonb,text,text,text,inet),public.finish_signup(uuid,uuid),public.release_signup_claim(uuid,uuid),public.claim_signup_recovery(integer) to service_role;
commit;
