-- Public invoker wrappers must reach their intended guarded private routines.
-- Trigger helpers and arbitrary-tenant billing locks must stay inaccessible.
do $$declare f record; callee text; target regprocedure; begin
 for f in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') loop
  for callee in select distinct m[1] from regexp_matches(f.prosrc,'app_private\.([a-z_]+)\(','g') m loop
   for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname=callee loop
    if not has_function_privilege('authenticated',target,'execute') then raise exception 'Broken private call from % to %',f.oid::regprocedure,target;end if;
    if has_function_privilege('anon',target,'execute') then raise exception 'Anonymous private entrypoint exposed: %',target;end if;
   end loop;
  end loop;
 end loop;
 if to_regprocedure('app_private.lock_quota(uuid)') is not null and has_function_privilege('authenticated',to_regprocedure('app_private.lock_quota(uuid)'),'execute') then raise exception 'Unscoped quota lock exposed';end if;
end$$;
select 'Private workflow grants and least-privilege checks passed' as result;

do $$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','app_private') and p.prokind='f'
    and pg_get_functiondef(p.oid) ~ $pattern$errcode\s*=\s*'40001'$pattern$) then
  raise exception 'Application conflict still raises retryable serialization failure';
 end if;
end $$;
