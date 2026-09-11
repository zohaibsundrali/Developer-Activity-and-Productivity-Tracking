\set ON_ERROR_STOP on
\ir agile_container_write_authority.sql
create table milestones(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid,title text,status text default 'pending');
alter table milestones enable row level security;
grant select,insert,update,delete on milestones to authenticated;
create policy legacy_milestone on milestones for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
\ir ../../supabase/migrations/20260911171109_production_milestone_write_authority.sql
do $$ declare org uuid:='79000000-0000-0000-0000-000000000001'; actor uuid:='79000000-0000-0000-0000-000000000011'; project uuid:='79000000-0000-0000-0000-000000000101'; milestone uuid; n int; begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 insert into milestones(organization_id,project_id,title) values(org,project,' Release ') returning id into milestone;
 update milestones set status='completed' where id=milestone;
 update milestones set status='pending' where id=milestone;
 perform agile_expect_denied(format('update milestones set project_id=%L where id=%L','79000000-0000-0000-0000-000000000102',milestone));
 perform agile_expect_denied(format('update milestones set organization_id=%L where id=%L','79000000-0000-0000-0000-000000000002',milestone));
 perform agile_expect_denied(format('update milestones set title='' '' where id=%L',milestone));
 perform set_config('test.agile_locked','yes',true);
 update milestones set status='completed' where id=milestone; get diagnostics n=row_count;
 if n<>0 then raise exception 'Locked plan updated milestone'; end if;
 delete from milestones where id=milestone; get diagnostics n=row_count;
 if n<>0 then raise exception 'Locked plan deleted milestone'; end if;
 perform agile_expect_denied(format('insert into milestones(organization_id,project_id,title) values(%L,%L,''Locked'')',org,project));
 perform set_config('test.agile_locked','no',true);
 reset role;
 insert into user_permissions values(actor,'admin','task.manage',false);
 set local role authenticated;
 update milestones set status='completed' where id=milestone; get diagnostics n=row_count;
 if n<>0 then raise exception 'Permission deny updated milestone'; end if;
 delete from milestones where id=milestone; get diagnostics n=row_count;
 if n<>0 then raise exception 'Permission deny deleted milestone'; end if;
 reset role;
 update memberships set status='active' where user_id=actor and user_type='developer';
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 -- Existing fixture grants Developer task.manage; same-UUID Admin deny does not bleed.
 update milestones set status='completed' where id=milestone; get diagnostics n=row_count;
 if n<>1 then raise exception 'Typed explicit grant not honored'; end if;
 reset role;
end $$;
