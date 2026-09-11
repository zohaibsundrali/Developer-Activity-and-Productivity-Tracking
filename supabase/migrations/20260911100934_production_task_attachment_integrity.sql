begin;
alter table public.task_attachments add column uploaded_by_type text check(uploaded_by_type in ('admin','developer'));
-- Retain ambiguous legacy attribution without guessing a profile type.
update public.task_attachments a set uploaded_by_type=(select min(m.user_type) from public.memberships m
 where m.organization_id=a.organization_id and m.user_id=a.uploaded_by and m.user_type in ('admin','developer')
 having count(distinct m.user_type)=1);

create or replace function public.auth_attachment_parent(p_org uuid,p_task uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_org=public.auth_org() and not public.auth_is_client()
  and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
  and exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=public.auth_app_user_id()
    and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active')
  and exists(select 1 from public.developer_tasks t where t.id=p_task and t.organization_id=p_org);
$$;
revoke all on function public.auth_attachment_parent(uuid,uuid) from public;
grant execute on function public.auth_attachment_parent(uuid,uuid) to authenticated;
alter table public.task_attachments enable row level security;
-- The existing UI permits collaborators who can access the task to remove its
-- attachments. Keep that behavior, including for legacy untyped uploads.
create policy attachment_parent_access on public.task_attachments as restrictive for all to authenticated
using(public.auth_attachment_parent(organization_id,task_id))
with check(public.auth_attachment_parent(organization_id,task_id));

create or replace function public.guard_task_attachment_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare prefix text; metadata jsonb; profile_type text;
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if tg_op='UPDATE' then
  if row(new.id,new.organization_id,new.task_id,new.uploaded_by,new.uploaded_by_type,new.file_path,new.created_at,new.file_size,new.file_type)
   is distinct from row(old.id,old.organization_id,old.task_id,old.uploaded_by,old.uploaded_by_type,old.file_path,old.created_at,old.file_size,old.file_type) then
   raise exception 'Attachment identity and stored file metadata cannot be changed' using errcode='42501';
  end if;
 else
  profile_type:=auth.jwt()->'app_metadata'->>'user_type';
  if new.uploaded_by is distinct from public.auth_app_user_id() or profile_type not in ('admin','developer')
   or (new.uploaded_by_type is not null and new.uploaded_by_type is distinct from profile_type) then
   raise exception 'Attachment uploader must match verified identity' using errcode='42501';
  end if;
  new.uploaded_by_type:=profile_type;
  prefix:=format('pm/%s/%s/',new.organization_id,new.task_id);
  if new.file_path is null or left(new.file_path,length(prefix))<>prefix
   or length(new.file_path)<=length(prefix) or substring(new.file_path from length(prefix)+1) like '%/%'
   or substring(new.file_path from length(prefix)+1) in ('.','..') then
   raise exception 'Attachment path must belong to its organization and task' using errcode='22023';
  end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id='task-submissions' and o.name=new.file_path;
  if not found then raise exception 'Attachment upload is unavailable' using errcode='22023'; end if;
  new.file_size:=(metadata->>'size')::bigint;
  new.file_type:=coalesce(metadata->>'mimetype','application/octet-stream');
  if new.file_size is null or new.file_size<0 then raise exception 'Attachment upload size is unavailable' using errcode='22023'; end if;
 end if;
 if nullif(btrim(new.file_name),'') is null then raise exception 'Attachment file name is required' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.guard_task_attachment_identity() from public;
create trigger task_attachment_identity before insert or update on public.task_attachments
for each row execute function public.guard_task_attachment_identity();
commit;
