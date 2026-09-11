do $$ declare org uuid := '00000000-0000-0000-0000-000000000099'; task uuid; project uuid; subscription_state text;
begin
  insert into organizations values(org);
  insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
  insert into projects(organization_id,name) values(org,'Original') returning id into project;
  insert into developer_tasks(organization_id,status) values(org,'completed') returning id into task;
  foreach subscription_state in array array['trialing','past_due','unpaid'] loop
    update organization_subscriptions set status=subscription_state,
      trial_end=now()-interval '1 hour', grace_period_ends_at=now()-interval '1 hour'
      where organization_id=org;
    set local role authenticated;
    perform expect_rejected(format('update projects set name=''Bypassed'' where id=%L',project),'BILLING_LOCKED');
    perform expect_rejected(format('delete from projects where id=%L',project),'BILLING_LOCKED');
    perform expect_rejected(format('insert into developer_tasks(organization_id,status) values(%L,''completed'')',org),'BILLING_LOCKED');
    perform expect_rejected(format('update developer_tasks set status=''rejected'' where id=%L',task),'BILLING_LOCKED');
    perform expect_rejected(format('delete from developer_tasks where id=%L',task),'BILLING_LOCKED');
    if (select count(*) from developer_tasks where id=task) <> 1 then raise exception 'Locked data became unreadable'; end if;
    reset role;
    perform expect_rejected(format('update developer_tasks set status=''rejected'' where id=%L',task),'BILLING_LOCKED');
  end loop;
  -- Cancellation falls back to Free; it is not a write-locked state.
  update organization_subscriptions set status='canceled' where organization_id=org;
  set local role authenticated;
  update projects set name='After downgrade' where id=project;
  update developer_tasks set status='rejected' where id=task;
  reset role;
  update organization_subscriptions set status='unpaid' where organization_id=org;
  -- Cascading organization cleanup remains possible, including while locked.
  delete from organizations where id=org;
  if exists(select 1 from developer_tasks where id=task) then raise exception 'Cascade failed'; end if;
end $$;
