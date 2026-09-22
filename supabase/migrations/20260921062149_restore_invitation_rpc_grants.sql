begin;
-- Supabase default privileges can grant anon/authenticated explicitly. Removing
-- PUBLIC alone does not remove those grants from these server-only RPCs.
revoke all on function public.claim_invitation(uuid,uuid),
 public.finish_invitation(uuid,uuid,text,text,inet),
 public.release_invitation_claim(uuid,uuid),
 public.claim_invitation_cleanup(integer),
 public.finish_invitation_cleanup(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.claim_invitation(uuid,uuid),
 public.finish_invitation(uuid,uuid,text,text,inet),
 public.release_invitation_claim(uuid,uuid),
 public.claim_invitation_cleanup(integer),
 public.finish_invitation_cleanup(uuid,uuid)
 to service_role;
do $$ declare f regprocedure; begin
 foreach f in array array[
 'public.claim_invitation(uuid,uuid)'::regprocedure,
 'public.finish_invitation(uuid,uuid,text,text,inet)'::regprocedure,
 'public.release_invitation_claim(uuid,uuid)'::regprocedure,
 'public.claim_invitation_cleanup(integer)'::regprocedure,
 'public.finish_invitation_cleanup(uuid,uuid)'::regprocedure
 ] loop
  if has_function_privilege('anon',f,'EXECUTE')
   or has_function_privilege('authenticated',f,'EXECUTE')
   or not has_function_privilege('service_role',f,'EXECUTE') then
   raise exception 'Invitation RPC grant verification failed: %',f;
  end if;
 end loop;
end $$;
commit;
