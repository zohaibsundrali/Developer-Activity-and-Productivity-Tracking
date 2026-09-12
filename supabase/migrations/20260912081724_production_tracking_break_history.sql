-- Breaks are device-measured seconds, separate from active tracked time.
-- Wall-clock adjustments must not invalidate monotonic measured durations.
begin;
alter table public.productivity_sessions
 add column break_periods jsonb not null default '[]'::jsonb,
 add column break_duration numeric not null default 0;
create function public.guard_tracking_break_history() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare item jsonb; prior jsonb; previous jsonb; amount numeric; total numeric:=0;
 ident uuid; seen uuid[]:='{}'; stamp timestamptz; idx integer:=0; count_items integer; previous_status text;
begin
 if jsonb_typeof(new.break_periods) is distinct from 'array' or new.break_duration is null
  or new.break_duration::text in ('NaN','Infinity','-Infinity') or new.break_duration<0 then
  raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end if;
 count_items:=jsonb_array_length(new.break_periods);
 if count_items>10000 then raise exception 'TRACKING_BREAK_LIMIT' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(new.break_periods) loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','started_at','ended_at','duration_seconds']
   or item-array['id','started_at','ended_at','duration_seconds'] <> '{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string'
   or jsonb_typeof(item->'started_at') is distinct from 'string'
   or jsonb_typeof(item->'duration_seconds') is distinct from 'number' then
   raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end if;
  begin
   ident:=(item->>'id')::uuid; stamp:=(item->>'started_at')::timestamptz;
   amount:=(item->>'duration_seconds')::numeric;
  exception when others then raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end;
  if ident is null or ident=any(seen) or not isfinite(stamp)
   or item->>'started_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
   or amount<0 or amount::text in ('NaN','Infinity','-Infinity') then
   raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end if;
  seen:=array_append(seen,ident);
  if item->'ended_at'='null'::jsonb then
   if idx<>count_items-1 or amount<>0 or new.status='completed' then
    raise exception 'TRACKING_BREAK_OPEN_INVALID' using errcode='22023'; end if;
  else
   if jsonb_typeof(item->'ended_at') is distinct from 'string'
    or item->>'ended_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end if;
   begin stamp:=(item->>'ended_at')::timestamptz;
   exception when others then raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end;
   if not isfinite(stamp) then raise exception 'TRACKING_BREAK_INVALID' using errcode='22023'; end if;
  end if;
  total:=total+amount; idx:=idx+1;
 end loop;
 -- Python floating-point sums can differ slightly from exact decimal sums.
 if abs(new.break_duration-total)>0.000001 then
  raise exception 'TRACKING_BREAK_TOTAL_MISMATCH' using errcode='22023'; end if;
 if tg_op='UPDATE' then previous:=old.break_periods; previous_status:=old.status;
 else
  -- INSERT fires before an UPSERT's conflict branch; only visible records are read.
  select s.break_periods,s.status into previous,previous_status from public.productivity_sessions s where s.session_id=new.session_id;
 end if;
 if previous_status='completed' and (new.break_periods is distinct from previous or new.status is distinct from previous_status) then
  raise exception 'TRACKING_BREAK_SESSION_COMPLETED' using errcode='42501'; end if;
 if previous is not null then
  if jsonb_array_length(previous)>count_items then
   raise exception 'TRACKING_BREAK_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  for idx in 0..jsonb_array_length(previous)-1 loop
   prior:=previous->idx; item:=new.break_periods->idx;
   if prior->'ended_at'<>'null'::jsonb then
    if item is distinct from prior then raise exception 'TRACKING_BREAK_HISTORY_IMMUTABLE' using errcode='42501'; end if;
   elsif (item->'id',item->'started_at') is distinct from (prior->'id',prior->'started_at') then
    raise exception 'TRACKING_BREAK_HISTORY_IMMUTABLE' using errcode='42501';
   end if;
  end loop;
 end if;
 return new;
end $$;
create trigger tracking_break_history before insert or update on public.productivity_sessions
 for each row execute function public.guard_tracking_break_history();
revoke all on function public.guard_tracking_break_history() from public,anon,authenticated;
comment on column public.productivity_sessions.break_duration is 'Closed break duration in monotonic device-measured seconds; excluded from total_duration.';
comment on column public.productivity_sessions.break_periods is 'Append-only device break history; at most one open final entry. UTC timestamps describe device clock, not trusted payroll evidence.';
commit;
