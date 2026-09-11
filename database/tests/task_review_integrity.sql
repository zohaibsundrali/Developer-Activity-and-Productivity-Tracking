-- Reproduce the historical broad grant so writes reach the field guard.
create policy fixture_tasks_write on developer_tasks for all to authenticated using(true) with check(true);
-- Add the production review columns to this deliberately minimal fixture.
alter table developer_tasks add column reviewed_by uuid, add column reviewed_at timestamptz,
  add column admin_comments text, add column rejection_reason text, add column is_on_time boolean,
  add column productivity_points int default 0, add column actual_completion_date date,
  add column submitted_at timestamptz;
do $$ declare org uuid := '00000000-0000-0000-0000-000000000098'; task uuid; actor_role text;
begin
  insert into organizations values(org);
  insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
  insert into developer_tasks(organization_id,status) values(org,'pending') returning id into task;
  foreach actor_role in array array['owner','admin','manager','team_lead','qa','developer','hr','finance'] loop
    perform set_config('request.jwt.claims', jsonb_build_object('app_metadata',jsonb_build_object('role',actor_role,'user_type','developer','organization_id',org))::text,true);
    set local role authenticated;
    if (select count(*) from developer_tasks where id=task) <> 1 then raise exception 'Task fixture is inaccessible'; end if;
    perform expect_rejected(format('update developer_tasks set status=''completed'' where id=%L',task),'Task verdicts');
    perform expect_rejected(format('update developer_tasks set status=''rejected'' where id=%L',task),'Task verdicts');
    perform expect_rejected(format('update developer_tasks set productivity_points=999 where id=%L',task),'Task review field');
    perform expect_rejected(format('update developer_tasks set reviewed_at=now() where id=%L',task),'Task review field');
    perform expect_rejected(format('update developer_tasks set submitted_at=now() where id=%L',task),'Task review field');
    perform expect_rejected(format('insert into developer_tasks(organization_id,status) values(%L,''completed'')',org),'Task verdicts');
    perform expect_rejected(format('insert into developer_tasks(organization_id,status,admin_comments) values(%L,''pending'',''Approved'')',org),'Task review field');
    update developer_tasks set status='in_progress' where id=task;
    reset role;
  end loop;
  -- The verified server review can still apply its outcome and score.
  update developer_tasks set status='completed',productivity_points=1,reviewed_at=now() where id=task;
  set local role authenticated;
  perform expect_rejected(format('update developer_tasks set status=''pending'' where id=%L',task),'Task verdicts');
  perform expect_rejected(format('update developer_tasks set reviewed_at=null where id=%L',task),'Task review field');
  insert into developer_tasks(organization_id,status) values(org,'pending');
  reset role;
  delete from organizations where id=org;
end $$;
