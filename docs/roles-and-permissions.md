<!-- GENERATED FILE. Do not edit.
     Run: node scripts/generate-permission-matrix.mjs
     Guarded by tests/permissionMatrixDoc.test.js -->

# Roles and permissions

12 roles, 80 permissions. Generated from `src/utils/permissionCatalogue.js`, which is the only place the defaults are written down.

A role says what somebody may **do**. It is not a job title — those live in `employee_profiles.designation` and can say anything. Two roles with identical permissions are one role with two names.

These are **defaults**. A tenant that wants something else gets it through the per-user override layer (`user_permissions`, migration 069), not by editing the catalogue. An explicit deny beats every grant below, including an owner's.

## Permissions by role

How many of the 80 keys each role holds by default.

| Role | Keys | What the role is for |
|---|---:|---|
| `owner` | 79 | Everything, and the only role that may buy, cancel or change the plan, delete the organization, or grant another person a permission. |
| `admin` | 74 | Runs the organization day to day. Everything except the four owner-only keys. |
| `manager` | 43 | Delivery. Projects, task assignment, the client-facing decisions, and reports. |
| `hr` | 35 | People operations. Hiring, onboarding, the reporting line — and no access to delivery or money. |
| `finance` | 21 | Money only. Billing and client accounts, deliberately WITHOUT the monitoring surface. |
| `team_lead` | 33 | A contributor who also runs a team: reviews work, sees every task and project, reads reports. |
| `qa` | 17 | A contributor who may also review other people's submissions and triage the bug queue. |
| `developer` | 15 | Contributes. Own work, plus submitting it for review. |
| `designer` | 15 | Identical to developer today. Separate so the two can diverge without a data migration. |
| `devops` | 15 | Identical to developer today (migration 067). |
| `employee` | 15 | A staff member with no delivery role. Own work only. |
| `client` | 0 | A customer, not staff. Holds no staff permission at all — the portal is a separate surface. |

## The full matrix

### Organization

| Permission | What it allows | Roles |
|---|---|---|
| `organization.manage` | Change organization settings | `owner` |
| `organization.settings` | Open organization settings | `owner` |
| `organization.delete` | Delete the organization | `owner` |
| `organization.view` | View the organization screen | `owner`, `admin`, `hr` |

### People

| Permission | What it allows | Roles |
|---|---|---|
| `member.view` | View the employee directory | `owner`, `admin`, `hr` |
| `member.manage` | Add and edit members | `owner`, `admin`, `hr` |
| `member.invite` | Send an invitation | `owner`, `admin`, `hr`, `manager` |
| `member.provision` | Create a login for a member | `owner`, `admin`, `hr`, `manager` |
| `member.create` | Create a staff account | `owner`, `admin`, `hr` |
| `member.delete` | Delete a staff account | `owner`, `admin` |
| `member.sync_roles` | Re-sync role claims | `owner`, `admin` |
| `employee.manage` | Manage employee records | `owner`, `admin`, `hr` |
| `employee.onboard` | Onboard and offboard | `owner`, `admin`, `hr` |
| `employee.transfer` | Move someone between teams | `owner`, `admin`, `hr` |
| `employee.activate` | Activate or suspend an account | `owner`, `admin`, `hr` |
| `team.manage` | Create and edit teams | `owner`, `admin`, `hr` |
| `hierarchy.view` | View the org structure | `owner`, `admin`, `hr`, `manager`, `team_lead` |
| `hierarchy.manage` | Set who reports to whom | `owner`, `admin`, `hr` |
| `capacity.view` | View who is free | `owner`, `admin`, `hr`, `manager`, `team_lead` |
| `team_stats.view` | View headcount statistics | `owner`, `admin`, `hr` |
| `team.view` | View team oversight | `owner`, `admin`, `manager`, `team_lead` |
| `attendance.view_all` | See everyone's attendance | `owner`, `admin`, `hr`, `manager` |
| `attendance.manage` | Correct an attendance record | `owner`, `admin`, `hr` |
| `leave.view_all` | See everyone's leave | `owner`, `admin`, `hr`, `manager` |
| `leave.approve` | Approve or reject leave | `owner`, `admin`, `hr`, `manager` |
| `leave.manage_types` | Configure leave types and quotas | `owner`, `admin`, `hr` |
| `timesheet.view_all` | See everyone's timesheets | `owner`, `admin`, `manager`, `team_lead`, `finance` |
| `timesheet.approve` | Approve or reject a submitted week | `owner`, `admin`, `manager`, `team_lead` |

### Projects

| Permission | What it allows | Roles |
|---|---|---|
| `project.view_all` | View every project | `owner`, `admin`, `manager`, `team_lead` |
| `project.create` | Start a project | `owner`, `admin`, `manager`, `team_lead` |
| `project.delete` | Delete a project | `owner`, `admin` |
| `project.assign_manager` | Assign a project manager | `owner`, `admin` |
| `project.manage_members` | Add and remove people on a project | `owner`, `admin`, `manager` |
| `project.close` | Close a project | `owner`, `admin` |
| `project.complete` | Mark a project complete | `owner`, `admin`, `manager`, `team_lead` |
| `project.hub` | Open the project hub | `owner`, `admin`, `manager`, `team_lead` |
| `project.board` | Open the board | `owner`, `admin` |

### Delivery

| Permission | What it allows | Roles |
|---|---|---|
| `task.manage` | Create and assign tasks | `owner`, `admin`, `manager`, `team_lead` |
| `task.view_all` | View every task | `owner`, `admin`, `manager`, `team_lead` |
| `task.review` | Review submitted work | `owner`, `admin`, `manager`, `team_lead`, `qa` |
| `task.submit` | Submit work for review | `developer`, `designer`, `devops`, `qa`, `employee`, `team_lead` |
| `sprint.view` | Open sprints | `owner`, `admin`, `manager`, `team_lead` |
| `bug.triage` | Triage the bug queue | `owner`, `admin`, `manager`, `team_lead`, `qa` |

### Clients

| Permission | What it allows | Roles |
|---|---|---|
| `proposal.view` | View incoming requests | `owner`, `admin`, `manager`, `team_lead` |
| `proposal.decide` | Accept or reject a request | `owner`, `admin`, `manager` |
| `change_request.view` | View change requests | `owner`, `admin`, `manager`, `team_lead` |
| `change_request.create` | Raise a change request | `owner`, `admin`, `manager` |
| `change_request.decide` | Advance a change request | `owner`, `admin`, `manager` |
| `change_request.approve` | Approve a change request for sale | `owner`, `admin` |
| `client.view` | View client accounts | `owner`, `admin`, `finance` |
| `client.notify` | Message a client | `owner`, `admin`, `manager` |
| `task.set_client_visibility` | Decide what the client sees on a task | `owner`, `admin`, `manager` |

### Your own work

| Permission | What it allows | Roles |
|---|---|---|
| `task.view_own` | See the work assigned to you | everyone except `client` |
| `task.update_own` | Move your own task along | everyone except `client` |
| `project.view_own` | Open a project you are on | everyone except `client` |
| `timesheet.view_own` | See your own timesheet | everyone except `client` |
| `timesheet.log_own` | Log your own hours | everyone except `client` |
| `timesheet.submit_own` | Submit your week for approval | everyone except `client` |
| `team.view_own` | See who else is on your projects | everyone except `client` |
| `profile.manage_own` | Edit your profile and password | everyone except `client` |
| `productivity.view_own` | See your own delivery metrics | everyone except `client` |
| `monitoring.view_own` | See your own recorded activity | everyone except `client` |
| `attendance.view_own` | See your own attendance | everyone except `client` |
| `attendance.log_own` | Check yourself in and out | everyone except `client` |
| `leave.view_own` | See your own leave | everyone except `client` |
| `leave.request_own` | Request leave | everyone except `client` |

### Money

| Permission | What it allows | Roles |
|---|---|---|
| `billing.view` | View billing | `owner`, `admin`, `finance` |
| `billing.manage` | Change the subscription | `owner`, `admin`, `finance` |
| `billing.purchase` | Buy, cancel or change the plan | `owner` |
| `invoice.view` | View client invoices | `owner`, `admin`, `finance` |
| `invoice.manage` | Raise and edit client invoices | `owner`, `admin`, `finance` |
| `pnl.view` | View project profit and loss | `owner`, `admin`, `finance` |

### Oversight

| Permission | What it allows | Roles |
|---|---|---|
| `report.view` | Open reports | `owner`, `admin`, `manager`, `team_lead` |
| `productivity.recalculate` | Recalculate productivity metrics | `owner`, `admin` |
| `monitoring.view` | View developer activity | `owner`, `admin` |
| `automation.manage` | Configure automation | `owner`, `admin` |
| `system.health` | Open system health | `owner`, `admin` |
| `system.audit` | Run the auth audit | `owner`, `admin` |
| `permissions.manage` | Grant and revoke individual permissions | `owner` |
| `signal.view` | View delivery signals | `owner`, `admin`, `hr`, `manager`, `team_lead` |

## Two things this table does not say

**A permission is not the only gate.** Four of them run in order and none replaces the others: middleware decides which *area* you may enter, `canAccessAdminSection` decides which *section*, `requirePermission` checks the key against a verified JWT, and RLS decides which *rows*. The browser holds a PostgREST client bound to the user's own token, so RLS is the real perimeter — a rule that lives only in an API route is a convention, not a control.

**Some rules cannot be a key.** `project.complete` is granted to four roles here, but the closure route also requires that the caller *owns* the project they are completing. Ownership is a fact about a row, not about a role, so it stays in the route — a role-only check would let every manager complete every project. Project-scoped roles (`project_members`, migration 071) are the same idea stored as data.

