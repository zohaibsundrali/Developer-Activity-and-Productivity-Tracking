# Client Portal 2.0 — API contract

This file is the single source of truth for the shapes passed between
`src/app/api/client/**` and `src/components/client/**`. Both sides are written
against it, and it is checked field by field before the work is called done.

The previous feature phase shipped with a green build and passing tests while
the page never rendered: the component required a `success` key the route did
not send. Nothing caught it because each side was tested alone. Hence this file.

## Rules that apply to every route here

- Auth is `getAuthedClient(request)`. No route trusts an org id, project id,
  client id or role from the body or the query string beyond using it as a
  lookup key that is then re-checked against the caller's allow-list.
- Every response is `{ success: true, ... }` on 200. Errors are
  `{ success: false, error: "<safe message>" }` with a real status code.
- A client may only ever touch a project in `auth_client_project_ids()`.
  Routes verify with `clientCanAccessProject` before reading anything.
- Never return: internal task titles (`client_visible = false`), employee
  emails, salaries, `employee_profiles`, productivity or activity data, internal
  comments (`internal = true`), automation config, or any other organisation's
  rows.
- Storage is reached only through short-lived signed URLs. No path, bucket name
  or public URL is returned.

---

## `GET /api/client/projects`

```
{ success: true, projects: [ ClientProjectSummary ] }
```

`ClientProjectSummary`
| field | type | note |
|---|---|---|
| `id` | uuid | |
| `name` | string | |
| `status` | string | |
| `progress` | number | 0-100, computed from client-visible tasks |
| `deadline` | ISO date \| null | |
| `health` | `"on_track" \| "at_risk" \| "overdue"` | derived; see below |
| `open_tasks` | number | client-visible only |
| `pending_approvals` | number | |

`health`: `overdue` when the deadline has passed and progress < 100;
`at_risk` when the deadline is within 7 days and progress < 75; else `on_track`.

## `GET /api/client/projects/[id]`

```
{ success: true, project: ClientProjectDetail }
```

`ClientProjectDetail` = `ClientProjectSummary` plus:
| field | type | note |
|---|---|---|
| `description` | string \| null | |
| `start_date` / `end_date` | ISO date \| null | |
| `milestones` | `[{ id, title, due_date, status, completed_at }]` | `client_visible = true` only |
| `tasks` | `[ ClientTask ]` | `client_visible = true` only |
| `team` | `[{ id, name, role }]` | **name and role only** — no email, no internal id beyond what the UI needs to key a list |
| `updates` | `[{ id, title, body, author_name, created_at }]` | `client_visible = true` only |
| `deliverables` | `[{ id, file_name, file_type, file_size, submitted_at }]` | no storage path |

`ClientTask`
| field | type |
|---|---|
| `id` | uuid |
| `title` | string |
| `status` | string |
| `priority` | string \| null |
| `due_date` | ISO date \| null |
| `assignee_name` | string \| null (**name only, never an email**) |
| `labels` | string[] |
| `attachment_count` | number |

## `GET /api/client/projects/[id]/timeline?limit=&before=`

```
{ success: true, events: [ TimelineEvent ], hasMore: boolean }
```

`TimelineEvent`
| field | type |
|---|---|
| `id` | string (stable, `"<source>:<uuid>"`) |
| `kind` | `"update" \| "milestone" \| "approval" \| "comment" \| "task_status"` |
| `title` | string |
| `body` | string \| null |
| `actor_name` | string \| null |
| `created_at` | ISO timestamp |

Merged newest-first from `project_updates`, `milestones`, `approval_events`,
`project_comments` (non-internal) and client-visible task status changes.

## `GET /api/client/projects/[id]/comments?limit=&before=`

```
{ success: true, comments: [ ClientComment ], hasMore: boolean }
```

## `POST /api/client/projects/[id]/comments`

Body: `{ body: string, attachment?: { path, name, type, size } }`

```
{ success: true, comment: ClientComment }
```

`ClientComment`
| field | type |
|---|---|
| `id` | uuid |
| `body` | string |
| `author_name` | string |
| `author_type` | `"client" \| "staff"` |
| `attachment_name` | string \| null |
| `attachment_url` | signed URL \| null (**minted per response, never a path**) |
| `created_at` | ISO timestamp |

`internal = true` rows are never returned and a client can never create one —
enforced by RLS in migration 032, not only by the route.

## `GET /api/client/approvals`

```
{ success: true, approvals: [ ClientApproval ] }
```

`ClientApproval`
| field | type |
|---|---|
| `id` | uuid |
| `project_id` / `project_name` | uuid / string |
| `title` | string |
| `description` | string \| null |
| `item_type` | string |
| `status` | `"pending" \| "approved" \| "rejected" \| "changes_requested"` |
| `created_at` | ISO timestamp |
| `history` | `[{ id, action, note, actor_name, created_at }]` newest first |

## `POST /api/client/approvals/[id]`

Body: `{ action: "approve" | "request_changes" | "reject" | "comment", note?: string }`

`request_changes` and `reject` require a non-empty `note` — a decision the team
cannot act on is not a decision.

```
{ success: true, approval: ClientApproval }
```

Every call appends to `approval_events` with the service role. The client has no
insert policy on that table: an audit trail the audited party can write is not
an audit trail.

## Client task detail

These two routes take a **task** id, not a project id. The lookup key is still
re-checked and never trusted: the task must exist in the caller's org, be
`client_visible = true`, and sit in a project in `auth_client_project_ids()`.

**All three failures answer `404`, never `403`.** A 403 confirms that the id
names a real task and that there is something there worth hiding, so iterating
ids against a route that distinguishes the cases maps out the private backlog —
its size and its timing — without reading a single title. "Not allowed to see"
and "does not exist" are told apart nowhere in the response.

## `GET /api/client/tasks/[id]`

```
{ success: true, task: ClientTaskDetail }
```

`ClientTaskDetail`
| field | type | note |
|---|---|---|
| `id` | uuid | |
| `title` | string | from `developer_tasks.task_title` |
| `description` | string \| null | from `developer_tasks.task_description` |
| `status` | string | |
| `priority` | string \| null | |
| `due_date` | ISO date \| null | `due_date`, falling back to `end_date` — the same rule as `ClientTask`, so the row and its detail cannot disagree |
| `assignee_name` | string \| null | **name only, never an email** |
| `labels` | string[] | |
| `client_approval_status` | `"pending" \| "approved" \| "changes_requested" \| "rejected"` \| null | migration 033 |
| `client_approval_note` | string \| null | the reason behind `changes_requested` |
| `attachments` | `[ ClientTaskAttachment ]` | |
| `activity` | `[ ClientTaskActivity ]` | newest first |

`ClientTaskAttachment`
| field | type |
|---|---|
| `id` | uuid |
| `file_name` | string |
| `file_type` | string \| null |
| `file_size` | number \| null |
| `url` | signed URL \| null (**minted per response, never a path**) |

`url` is signed for 10 minutes against the private `task-submissions` bucket,
and only for a path inside `pm/{organization_id}/`. A row whose path fails that
check is still listed, with `url: null` — metadata is not a download.

`ClientTaskActivity`
| field | type |
|---|---|
| `id` | string (stable, `"<source>:<uuid>"`) |
| `kind` | `"task_status" \| "approval"` |
| `title` | string |
| `actor_name` | string \| null |
| `created_at` | ISO timestamp |

Merged newest-first from the task's own status (`updated_at` is when the status
last moved — the timeline route reads it the same way), its
`client_approval_status`, and `approval_events` for approvals whose `item_ref`
is this task. **`pm_activity` is not a source**: it carries timer starts and
stops, automation runs and internal field edits, which is the productivity data
this contract forbids sending a client. Who moved a task is internal; a status
event therefore has `actor_name: null`.

## `GET /api/client/tasks/[id]/comments?limit=&before=`

```
{ success: true, comments: [ ClientComment ], hasMore: boolean }
```

## `POST /api/client/tasks/[id]/comments`

Body: `{ body: string }` — nothing else is read from it.

```
{ success: true, comment: ClientComment }
```

Same `ClientComment` as the project thread, same keyset paging on `before`, same
`limit` cap of 50. Two differences, both from the table rather than from taste:

- `task_comments` (016) has no attachment columns, so `attachment_name` and
  `attachment_url` are always `null`. They are still emitted, because a
  `ClientComment` is one shape everywhere.
- Reads filter `.eq("internal", false)`; writes hard-code `internal: false`,
  `author_type: 'client'` and `author_id` from the verified session. A client
  cannot post as staff or post an internal note by asking for one — enforced by
  RLS in migration 033, not only by the route.
