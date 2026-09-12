\set ON_ERROR_STOP on
create schema auth;
create schema app_private;
create table public.organizations(id uuid primary key,status text,owner_id uuid);
create table public.memberships(id uuid primary key,organization_id uuid,user_id uuid,user_type text,role text,email text,status text,deletion_blocked boolean);
create table public.admin_users(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table public.developers(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table public.clients(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
create table app_private.organization_deletions(organization_id uuid);
create table app_private.signup_attempts(id uuid,organization_id uuid,profile_id uuid,auth_user_id uuid,email text,details jsonb,terms_version text,created_at timestamptz,completed_at timestamptz);
create table app_private.profile_provisioning(id uuid,organization_id uuid,profile_id uuid,user_type text,role text,email text,auth_user_id uuid,created_at timestamptz,completed_at timestamptz);
create table public.invitations(id uuid,organization_id uuid,role text,email text,status text,token text);
create table app_private.invitation_attempts(invitation_id uuid,profile_id uuid,auth_user_id uuid,completed_at timestamptz,claim_id uuid);
create table public.terms_acceptances(organization_id uuid,user_id uuid,user_type text,document text);
insert into organizations values(md5('org')::uuid,'active',md5('signup')::uuid);
insert into memberships select md5(label||'member')::uuid,md5('org')::uuid,md5(label)::uuid,kind,role,'PRIVATE_EMAIL_'||label,'active',false
from (values('signup','admin','owner'),('provision','client','client'),('invitation','admin','admin'),('noauth','admin','admin'),('ambiguous','admin','admin'),('disabled','admin','admin'),('misplaced','client','client'),('healthy','admin','admin')) v(label,kind,role);
insert into admin_users values(md5('healthy')::uuid,md5('org')::uuid,md5('healthyauth')::uuid);
insert into clients values(md5('misplaced')::uuid,md5('otherorg')::uuid,null);
insert into auth.users select md5(label||'auth')::uuid,'PRIVATE_EMAIL_'||label,
 jsonb_build_object('organization_id',md5('org')::uuid,'app_user_id',md5(label)::uuid,'user_type',kind,'role',role,
 'signup_id',md5('signuprecord')::uuid,'provisioning_id',md5('provisionrecord')::uuid,'invitation_id',md5('invitationrecord')::uuid,'unused_secret','DO_NOT_RETURN_FULL_METADATA'),now(),null,
 case when label='disabled' then now()+interval '1 day' else null end
from (values('signup','admin','owner'),('provision','client','client'),('invitation','admin','admin'),('ambiguous','admin','admin'),('disabled','admin','admin'),('healthy','admin','admin')) v(label,kind,role);
insert into auth.users select md5('ambiguousduplicate')::uuid,email,raw_app_meta_data,email_confirmed_at,null,null from auth.users where id=md5('ambiguousauth')::uuid;
insert into app_private.signup_attempts values(md5('signuprecord')::uuid,md5('org')::uuid,md5('signup')::uuid,md5('signupauth')::uuid,'PRIVATE_EMAIL_signup','{"fullName":"PRIVATE_NAME","company":"PRIVATE_COMPANY","password":"PRIVATE_PASSWORD"}','version',now(),now());
insert into app_private.profile_provisioning values(md5('provisionrecord')::uuid,md5('org')::uuid,md5('provision')::uuid,'client','client','PRIVATE_EMAIL_provision',md5('provisionauth')::uuid,now(),now());
insert into invitations values(md5('invitationrecord')::uuid,md5('org')::uuid,'admin','PRIVATE_EMAIL_invitation','accepted','PRIVATE_INVITATION_TOKEN');
insert into app_private.invitation_attempts values(md5('invitationrecord')::uuid,md5('invitation')::uuid,md5('invitationauth')::uuid,now(),md5('PRIVATE_CLAIM')::uuid);
insert into terms_acceptances values(md5('org')::uuid,md5('signup')::uuid,'admin','terms_of_service');
begin read only;
\ir ../../scripts/sql/missing-profile-recovery-evidence.sql
rollback;
