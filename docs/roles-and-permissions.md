<!-- GENERATED FILE. Do not edit.
     Run: node scripts/generate-permission-matrix.mjs
     Guarded by tests/permissionMatrixDoc.test.js -->

# Roles and permissions

11 roles, 103 permissions. Generated from `src/utils/permissionCatalogue.js`, which is the only place the defaults are written down.

A role says what somebody may **do**. It is not a job title — those live in `employee_profiles.designation` and can say anything. Two roles with identical permissions are one role with two names.

These are **defaults**. A tenant that wants something else gets it through the per-user override layer (`user_permissions`, migration 069), not by editing the catalogue. An explicit deny beats every grant below, including an owner's.

## Permissions by role

How many of the 103 keys each role holds by default.

| Role | Keys | What the role is for |
|---|---:|---|
| `owner` | 102 | Everything, and the only role that may buy, cancel or change the plan, delete the organization, or grant another person a permission. |
| `manager` | 54 | Delivery. Projects, task assignment, the client-facing decisions, and reports. |
| `hr` | 48 | People operations. Hiring, onboarding, the reporting line — and no access to delivery or money. |
| `finance` | 27 | Money only. Billing and client accounts, deliberately WITHOUT the monitoring surface. |
| `team_lead` | 42 | A contributor who also runs a team: reviews work, sees every task and project, reads reports. |
| `qa` | 23 | A contributor who may also review other people's submissions and triage the bug queue. |
| `developer` | 18 | Contributes. Own work, plus submitting it for review. |
| `designer` | 18 | Identical to developer today. Separate so the two can diverge without a data migration. |
| `devops` | 18 | Identical to developer today (migration 067). |
| `employee` | 18 | A staff member with no delivery role. Own work only. |
| `client` | 0 | A customer, not staff. Holds no staff permission at all — the portal is a separate surface. |

## The full matrix

### Organization

| Permission | What it allows | Roles |
|---|---|---|
| `organization.manage` | Change organization settings | `owner` |
| `organization.settings` | Open organization settings | `owner` |
| `organization.delete` | Delete the organization | `owner` |
| `organization.view` | View the organization screen | `owner`, `hr` |

### People

| Permission | What it allows | Roles |
|---|---|---|
| `member.view` | View the employee directory | `owner`, `hr` |
| `member.manage` | Add and edit members | `owner`, `hr` |
| `member.invite` | Send an invitation | `owner`, `hr`, `manager` |
| `member.provision` | Create a login for a member | `owner`, `hr`, `manager` |
| `member.create` | Create a staff account | `owner`, `hr` |
| `member.delete` | Delete a staff account | `owner` |
| `member.sync_roles` | Re-sync role claims | `owner` |
| `employee.manage` | Manage employee records | `owner`, `hr` |
| `employee.onboard` | Onboard and offboard | `owner`, `hr` |
| `employee.transfer` | Move someone between teams | `owner`, `hr` |
| `employee.activate` | Activate or suspend an account | `owner`, `hr` |
| `team.manage` | Create and edit teams | `owner`, `hr` |
| `hierarchy.view` | View the org structure | `owner`, `hr`, `manager`, `team_lead` |
| `hierarchy.manage` | Set who reports to whom | `owner`, `hr` |
| `capacity.view` | View who is free | `owner`, `hr`, `manager`, `team_lead` |
| `capacity.allocate` | Set a project allocation | `owner`, `manager` |
| `employment.set_hours` | Set contracted weekly hours | `owner`, `hr` |
| `asset.view` | See the asset register | `owner`, `hr`, `finance` |
| `asset.manage` | Issue and return equipment | `owner`, `hr` |
| `licence.view` | See software licences | `owner`, `hr`, `finance` |
| `licence.manage` | Manage licences and seats | `owner`, `finance` |
| `team_stats.view` | View headcount statistics | `owner`, `hr` |
| `team.view` | View team oversight | `owner`, `manager`, `team_lead` |
| `attendance.view_all` | See everyone's attendance | `owner`, `hr`, `manager` |
| `attendance.manage` | Correct an attendance record | `owner`, `hr` |
| `leave.view_all` | See everyone's leave | `owner`, `hr`, `manager` |
| `leave.approve` | Approve or reject leave | `owner`, `hr`, `manager` |
| `leave.manage_types` | Configure leave types and quotas | `owner`, `hr` |
| `timesheet.view_all` | See everyone's timesheets | `owner`, `manager`, `team_lead`, `finance` |
| `timesheet.approve` | Approve or reject a submitted week | `owner`, `manager`, `team_lead` |
| `review_cycle.manage` | Open and close a review cycle | `owner`, `hr` |
| `review.write` | Write a performance review | `owner`, `hr`, `manager`, `team_lead` |
| `review.view_all` | Read everyone's reviews | `owner`, `hr` |
| `goal.manage` | Set and update goals | `owner`, `hr`, `manager`, `team_lead` |
| `job.view` | See the open roles | `owner`, `hr`, `manager`, `team_lead` |
| `job.manage` | Post and close a job opening | `owner`, `hr` |
| `candidate.view` | See applicants | `owner`, `hr` |
| `candidate.manage` | Move a candidate through hiring | `owner`, `hr` |

### Projects

| Permission | What it allows | Roles |
|---|---|---|
| `project.view_all` | View every project | `owner`, `manager`, `team_lead` |
| `project.create` | Start a project | `owner`, `manager`, `team_lead` |
| `project.delete` | Delete a project | `owner` |
| `project.assign_manager` | Assign a project manager | `owner` |
| `project.manage_members` | Add and remove people on a project | `owner`, `manager` |
| `project.close` | Close a project | `owner` |
| `project.complete` | Mark a project complete | `owner`, `manager`, `team_lead` |
| `project.hub` | Open the project hub | `owner`, `manager`, `team_lead` |
| `project.board` | Open the board | `owner` |

### Delivery

| Permission | What it allows | Roles |
|---|---|---|
| `task.manage` | Create and assign tasks | `owner`, `manager`, `team_lead` |
| `task.view_all` | View every task | `owner`, `manager`, `team_lead` |
| `task.review` | Review submitted work | `owner`, `manager`, `team_lead`, `qa` |
| `task.submit` | Submit work for review | `developer`, `designer`, `devops`, `qa`, `employee`, `team_lead` |
| `sprint.view` | Open sprints | `owner`, `manager`, `team_lead` |
| `bug.triage` | Triage the bug queue | `owner`, `manager`, `team_lead`, `qa` |
| `bug.raise` | Raise a defect from a failed test | `owner`, `manager`, `team_lead`, `qa` |
| `test_case.view` | See the test cases | `owner`, `manager`, `team_lead`, `qa`, `developer`, `designer`, `devops`, `employee` |
| `test_case.manage` | Write and edit test cases | `owner`, `manager`, `team_lead`, `qa` |
| `test_run.manage` | Start and close a test run | `owner`, `manager`, `team_lead`, `qa` |
| `test_run.execute` | Record a test result | `owner`, `manager`, `team_lead`, `qa`, `developer`, `designer`, `devops`, `employee` |

### Clients

| Permission | What it allows | Roles |
|---|---|---|
| `proposal.view` | View incoming requests | `owner`, `manager`, `team_lead` |
| `proposal.decide` | Accept or reject a request | `owner`, `manager` |
| `change_request.view` | View change requests | `owner`, `manager`, `team_lead` |
| `change_request.create` | Raise a change request | `owner`, `manager` |
| `change_request.decide` | Advance a change request | `owner`, `manager` |
| `change_request.approve` | Approve a change request for sale | `owner` |
| `client.view` | View client accounts | `owner`, `finance` |
| `client.notify` | Message a client | `owner`, `manager` |
| `task.set_client_visibility` | Decide what the client sees on a task | `owner`, `manager` |

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
| `review.view_own` | Read your shared review and goals | everyone except `client` |

### Money

| Permission | What it allows | Roles |
|---|---|---|
| `billing.view` | View billing | `owner`, `finance` |
| `billing.manage` | Change the subscription | `owner`, `finance` |
| `billing.purchase` | Buy, cancel or change the plan | `owner` |
| `invoice.view` | View client invoices | `owner`, `finance` |
| `invoice.manage` | Raise and edit client invoices | `owner`, `finance` |
| `pnl.view` | View project profit and loss | `owner`, `finance` |
| `contract.view` | Read client contracts | `owner`, `manager`, `finance` |
| `contract.manage` | Draft and sign a contract | `owner`, `finance` |
| `contract.amend` | Amend a signed contract | `owner` |

### Oversight

| Permission | What it allows | Roles |
|---|---|---|
| `report.view` | Open reports | `owner`, `manager`, `team_lead` |
| `productivity.recalculate` | Recalculate productivity metrics | `owner` |
| `monitoring.view` | View developer activity | `owner` |
| `automation.manage` | Configure automation | `owner` |
| `system.health` | Open system health | `owner` |
| `system.audit` | Run the auth audit | `owner` |
| `permissions.manage` | Grant and revoke individual permissions | `owner` |
| `signal.view` | View delivery signals | `owner`, `hr`, `manager`, `team_lead` |

## Two things this table does not say

**A permission is not the only gate.** Four of them run in order and none replaces the others: middleware decides which *area* you may enter, `canAccessAdminSection` decides which *section*, `requirePermission` checks the key against a verified JWT, and RLS decides which *rows*. The browser holds a PostgREST client bound to the user's own token, so RLS is the real perimeter — a rule that lives only in an API route is a convention, not a control.

**Some rules cannot be a key.** `project.complete` is granted to four roles here, but the closure route also requires that the caller *owns* the project they are completing. Ownership is a fact about a row, not about a role, so it stays in the route — a role-only check would let every manager complete every project. Project-scoped roles (`project_members`, migration 071) are the same idea stored as data.

