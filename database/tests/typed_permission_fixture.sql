create table user_permissions(membership_id uuid,permission_key text,allowed boolean,unique(membership_id,permission_key));
insert into memberships(organization_id,user_id,user_type,role,status) values
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','admin','employee','active');
insert into user_permissions(membership_id,permission_key,allowed)
select id,'organization.manage',true from memberships where user_id='10000000-0000-0000-0000-000000000001' and user_type='developer';
