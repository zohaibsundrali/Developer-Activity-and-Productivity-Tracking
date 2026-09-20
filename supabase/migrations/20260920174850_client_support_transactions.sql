begin;
-- Called only by the verified client API through its server service client.
-- Invoker privileges: no SECURITY DEFINER or browser-callable write bypass.
create or replace function public.create_client_support_thread(
 p_org uuid, p_client uuid, p_project uuid, p_subject text, p_body text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare client_row public.clients%rowtype; thread_row public.support_threads%rowtype;
begin
 if nullif(btrim(p_subject),'') is null or nullif(btrim(p_body),'') is null then
  raise exception 'SUPPORT_INVALID: Subject and message are required' using errcode='22023';
 end if;
 select * into client_row from public.clients where id=p_client and organization_id=p_org and status='active' for share;
 if not found then raise exception 'SUPPORT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.memberships where organization_id=p_org and user_id=p_client and user_type='client' and status='active' for share;
 if not found then raise exception 'SUPPORT_FORBIDDEN' using errcode='42501'; end if;
 if p_project is not null then
  perform 1 from public.project_clients pc join public.projects p on p.id=pc.project_id and p.organization_id=pc.organization_id
    where pc.organization_id=p_org and pc.client_id=p_client and pc.project_id=p_project for share of pc,p;
  if not found then raise exception 'SUPPORT_FORBIDDEN' using errcode='42501'; end if;
 end if;
 insert into public.support_threads(organization_id,project_id,client_id,subject,last_message_at)
  values(p_org,p_project,p_client,btrim(p_subject),now()) returning * into thread_row;
 insert into public.support_messages(organization_id,thread_id,sender_type,sender_id,sender_name,body)
  values(p_org,thread_row.id,'client',p_client,client_row.email,btrim(p_body));
 return jsonb_build_object('thread',jsonb_build_object('id',thread_row.id,'project_id',thread_row.project_id,
  'client_id',thread_row.client_id,'subject',thread_row.subject,'status',thread_row.status,
  'last_message_at',thread_row.last_message_at,'created_at',thread_row.created_at));
end $$;

create or replace function public.reply_client_support_thread(
 p_org uuid, p_client uuid, p_thread uuid, p_body text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare client_row public.clients%rowtype; message_row public.support_messages%rowtype;
begin
 if nullif(btrim(p_body),'') is null then raise exception 'SUPPORT_INVALID: Message is required' using errcode='22023'; end if;
 select * into client_row from public.clients where id=p_client and organization_id=p_org and status='active' for share;
 if not found then raise exception 'SUPPORT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.memberships where organization_id=p_org and user_id=p_client and user_type='client' and status='active' for share;
 if not found then raise exception 'SUPPORT_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.support_threads where id=p_thread and organization_id=p_org and client_id=p_client for update;
 if not found then raise exception 'SUPPORT_NOT_FOUND' using errcode='P0002'; end if;
 insert into public.support_messages(organization_id,thread_id,sender_type,sender_id,sender_name,body)
  values(p_org,p_thread,'client',p_client,client_row.email,btrim(p_body)) returning * into message_row;
 update public.support_threads set last_message_at=message_row.created_at where id=p_thread and organization_id=p_org;
 return jsonb_build_object('message',jsonb_build_object('id',message_row.id,'thread_id',message_row.thread_id,
  'sender_type',message_row.sender_type,'sender_id',message_row.sender_id,'sender_name',message_row.sender_name,
  'body',message_row.body,'created_at',message_row.created_at));
end $$;
revoke all on function public.create_client_support_thread(uuid,uuid,uuid,text,text),
 public.reply_client_support_thread(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_client_support_thread(uuid,uuid,uuid,text,text),
 public.reply_client_support_thread(uuid,uuid,uuid,text) to service_role;
commit;
