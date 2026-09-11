-- Run after quota_fixture.sql and the production_quota_enforcement migration.
do $$
declare org uuid := '00000000-0000-0000-0000-000000000001'; task uuid; row_id uuid;
begin
  -- The authenticated role writes directly, without an application API.
  set local role authenticated;
  insert into projects(organization_id,name) values (org,'one'),(org,'two');
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'PLAN_LIMIT_REACHED');
  update projects set name = 'editable at limit' where organization_id = org;
  insert into developer_tasks(organization_id,status) values (org,'pending'),(org,'reviewed');
  insert into developer_tasks(organization_id,status) values (org,'completed') returning id into task;
  perform expect_rejected(format('update developer_tasks set status=''in_progress'' where id=%L',task),'PLAN_LIMIT_REACHED');
  update developer_tasks set status = 'completed' where organization_id = org;
  update developer_tasks set status = 'in_progress' where id = task;
  insert into memberships(organization_id,user_type) values (org,'admin'),(org,'developer');
  insert into memberships(organization_id,user_type) values (org,'client') returning id into row_id;
  perform expect_rejected(format('update memberships set user_type=''developer'' where id=%L',row_id),'PLAN_LIMIT_REACHED');
  insert into developers(organization_id) values (org),(org);
  perform expect_rejected(format('insert into developers(organization_id) values (%L)',org),'PLAN_LIMIT_REACHED');
  insert into screenshots(organization_id) values (org),(org);
  perform expect_rejected(format('insert into screenshots(organization_id) values (%L)',org),'PLAN_LIMIT_REACHED');
  update screenshots set organization_id = org; -- bigint IDs and neutral updates
  reset role;
  -- Service role/backend cannot bypass the trigger either.
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'PLAN_LIMIT_REACHED');
  insert into organization_subscriptions(organization_id,plan_code,status) values (org,'professional','active');
  insert into projects(organization_id) values (org),(org);
  update organization_subscriptions set status='canceled' where organization_id=org;
  if app_private.plan_limit(org,'projects') <> 2 then raise exception 'Cancellation did not revert to Free'; end if;
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'PLAN_LIMIT_REACHED');
  update projects set name='preserved after downgrade' where organization_id=org;
  update organization_subscriptions set status='trialing',trial_end=now()-interval '1 second' where organization_id=org;
  perform expect_rejected(format('insert into developers(organization_id) values (%L)',org),'BILLING_LOCKED');
  update organization_subscriptions set status='past_due',grace_period_ends_at=now()-interval '1 second' where organization_id=org;
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'BILLING_LOCKED');
  update organization_subscriptions set status='unpaid' where organization_id=org;
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'BILLING_LOCKED');
  update organization_subscriptions set status='active',last_payment_status='demo_paid',current_period_end=now()-interval '1 second' where organization_id=org;
  if app_private.plan_limit(org,'projects') <> 2 then raise exception 'Demo did not expire'; end if;
  update organization_subscriptions set last_payment_status='paid' where organization_id=org;
  if app_private.plan_limit(org,'projects') <> 4 then raise exception 'Real renewal latency locked payer'; end if;
  update organization_subscriptions set plan_code='enterprise' where organization_id=org;
  insert into projects(organization_id) select org from generate_series(1,10);
  update billing_plans set limits=limits-'projects' where code='enterprise';
  perform expect_rejected(format('insert into projects(organization_id) values (%L)',org),'BILLING_UNAVAILABLE');
  -- Organization cascading deletion must not recreate its quota-lock FK.
  delete from organizations where id=org;
end; $$;
