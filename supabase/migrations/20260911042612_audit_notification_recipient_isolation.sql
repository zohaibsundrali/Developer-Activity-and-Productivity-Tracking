-- Apply after database/096. No data is changed. The service role remains able
-- to deliver notifications; staff read and update only their own inbox.
-- Restrictive policies also constrain any legacy permissive policy retained
-- on a deployed installation. Test with database/tests/notification_recipient.sql.
begin;

create or replace function public.notification_is_recipient(
  p_admin_id text, p_admin_email text, p_developer_id uuid, p_assigned_developer_id uuid
) returns boolean language sql stable security invoker set search_path = public, pg_temp
as $$
  -- Admin-console staff such as HR/Finance can have developer profiles.
  -- Existing writers address them through admin_id/email; an address column
  -- identifies the recipient, not a role grant or a profile-table requirement.
  select coalesce(
    auth.jwt()->'app_metadata'->>'user_type' in ('admin', 'developer')
    and (
      p_admin_id = public.auth_app_user_id()::text
      or (nullif(p_admin_email, '') is not null
          and lower(p_admin_email) = lower(auth.jwt()->>'email'))
      or p_developer_id = public.auth_app_user_id()
      or p_assigned_developer_id = public.auth_app_user_id()
    ), false);
$$;
revoke all on function public.notification_is_recipient(text,text,uuid,uuid) from public;
grant execute on function public.notification_is_recipient(text,text,uuid,uuid) to authenticated;

alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
using (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
using (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id))
with check (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id));

drop policy if exists notifications_recipient_select on public.notifications;
create policy notifications_recipient_select on public.notifications as restrictive for select to authenticated
using (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id));

drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_update on public.notifications as restrictive for update to authenticated
using (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id))
with check (organization_id = public.auth_org() and public.notification_is_recipient(admin_id, admin_email, developer_id, assigned_developer_id));

commit;
