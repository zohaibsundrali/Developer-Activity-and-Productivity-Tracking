# Organization idle reminders

Admins can enable an advisory idle reminder and set its threshold from60 to3600 seconds. The initial policy is disabled with a300-second threshold. Typed admin owner/admin authority and explicit organization.settings/organization.manage denials govern writes. Employees see the policy but cannot change it.

On the desktop, a verified reminder offers Continue tracking or Pause tracking. Continue dismisses the current idle episode until fresh input; Pause uses the existing whole-tracker pause and recorded-break flow. No work time, timesheet or pay is automatically removed. Reading, meetings and other valuable work can occur without keyboard/mouse input.

Detection requires healthy keyboard and mouse sources, including mouse movement/click/scroll observations. The smaller of their monotonic inactivity measurements represents time without either input. Missing sensors/policy or a login change suppress reminders; unavailable gaps do not count as idle. No new raw input content is stored by this feature.

## Rollout

Run the complete `supabase/migrations/20260912083144_production_organization_idle_reminder_policy.sql` once after the existing identity/quota prerequisites. Deploy web and rebuild/install desktop. In Admin Account or Organization Settings, enable the policy and choose the threshold. Employee Account shows it read-only. The policy is refreshed by the desktop worker; UI reads cached status without network calls.

Before wider rollout, test on a staging Windows machine: enable60 seconds, stop input, verify reminder without duration deduction, Continue, fresh input then a new idle episode, and Pause/Resume. Check stationary clicks and scrolling reset inactivity. Disconnect policy access or stop a listener and confirm no idle assertion. Change account, disable policy and revoke the device; reminders must clear. Verify staff direct RPC writes fail and another organization's policy is not visible.

This is a reminder feature, not idle-time correction/approval, payroll classification or trusted evidence of productivity. Actual OS listener availability, real Supabase calls and installer behavior require staging verification. Existing subscription, device and identity release gates remain separate.
