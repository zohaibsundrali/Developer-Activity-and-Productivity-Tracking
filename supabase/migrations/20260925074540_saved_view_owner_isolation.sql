begin;
-- App user UUIDs are profile-scoped. Preserve type to prevent an admin and
-- developer with the same UUID from reading each other's personal filters.
alter table public.saved_views add column user_type text check(user_type in ('admin','developer'));
-- Only infer legacy ownership where it is unambiguous. Retain unresolved rows
-- with a null type for explicit review rather than assigning them to someone.
with owners as (
 select organization_id,user_id,min(user_type) as user_type
 from public.memberships where user_type in ('admin','developer')
 group by organization_id,user_id having count(distinct user_type)=1
)
update public.saved_views v set user_type=o.user_type from owners o
where v.organization_id=o.organization_id and v.user_id=o.user_id;

create or replace function public.guard_saved_view_identity() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if tg_op='INSERT' then
  if new.user_id is null then new.user_id:=public.auth_app_user_id(); end if;
  if new.user_type is null then new.user_type:=auth.jwt()->'app_metadata'->>'user_type'; end if;
 elsif new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
   or new.user_id is distinct from old.user_id or new.user_type is distinct from old.user_type
   or new.project_id is distinct from old.project_id or new.created_at is distinct from old.created_at then
  raise exception 'Saved view identity is immutable' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_saved_view_identity() from public,anon,authenticated;
create trigger saved_view_identity before insert or update on public.saved_views
for each row execute function public.guard_saved_view_identity();
alter table public.saved_views enable row level security;
-- Restrictive policies compose with the existing tenant policy. They never
-- broaden access, including for clients, or couple personal filters to billing.
create policy saved_view_read on public.saved_views as restrictive for select to authenticated
using(organization_id=public.auth_org() and not public.auth_is_client() and
 (is_shared or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type')));
create policy saved_view_insert on public.saved_views as restrictive for insert to authenticated
with check(organization_id=public.auth_org() and not public.auth_is_client()
 and user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type');
create policy saved_view_update on public.saved_views as restrictive for update to authenticated
using(organization_id=public.auth_org() and not public.auth_is_client()
 and user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type')
with check(organization_id=public.auth_org() and not public.auth_is_client()
 and user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type');
create policy saved_view_delete on public.saved_views as restrictive for delete to authenticated
using(organization_id=public.auth_org() and not public.auth_is_client()
 and user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type');
commit;
