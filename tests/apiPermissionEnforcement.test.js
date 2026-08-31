import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ROLES } from '@/utils/roles';

// /api/task-plan/review reads SUPABASE_SERVICE_ROLE_KEY at request time and
// answers 500 "Server misconfigured" without it — which would make every
// assertion below pass for the wrong reason on the refusals and fail on the
// approvals. vitest.config.mjs supplies the URL and the anon key but not this
// one; createClient is mocked, so the value is never used for anything.
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

/**
 * THE ROUTES THAT ASKED WHO YOU WERE AND NEVER ASKED WHAT YOU MAY DO.
 *
 * Seven handlers whose entire authorization was "you presented a valid token
 * and you are not a client". Every one of them then did something only a
 * subset of staff should be able to do:
 *
 *   /api/automation/notify      fanned out in-app notifications AND email from
 *                               the company's sending domain to fifty named
 *                               colleagues.
 *   /api/ai-generate-tasks      wrote tasks into any project in the org and
 *                               spent money at a model provider doing it.
 *   /api/change-requests  GET   returned estimated_cost, estimated_hours and
 *                               pm_notes for the whole commercial pipeline.
 *   /api/proposals        GET   returned every client's stated budget.
 *   /api/task-submission        let anyone submit against anyone's task, and
 *                               wiped the reviewer's verdict doing it.
 *   /api/admin-review           let the person who did the work approve it.
 *   /api/task-plan/review       ditto, one step earlier in the workflow.
 *
 * WHY THESE TESTS DRIVE THE HANDLERS INSTEAD OF READING THEM.
 *
 * The suite's usual move is to read the route file and match a string. That
 * has failed this codebase twice in ways worth not repeating: an assertion
 * matched the explanatory COMMENT above a guard rather than the guard (delete
 * the code, keep the comment, test still green), and an assertion was loose
 * enough that the broken version satisfied it too. Neither is possible here —
 * nothing below reads a source file. Each test calls the exported handler with
 * a mocked auth identity and a mocked database, and asserts on the STATUS and
 * on WHICH WRITES REACHED THE DATABASE. A guard that has been deleted, negated
 * or widened changes both.
 *
 * The role lists are written out rather than derived from the catalogue, for
 * the reason tests/routeGuards.test.js gives: a record that updates itself when
 * the thing it records changes is not a record. Widen a key and this fails.
 */

// ── Identities and ids ────────────────────────────────────────────────────
const ORG = 'org-1111';
const OTHER_ORG = 'org-9999';
const ME = 'user-me';
const COLLEAGUE = 'user-colleague';
const THIRD_PARTY = 'user-third-party';

const STAFF_ROLES = ROLES.filter((r) => r !== 'client');
/** Roles whose accounts live in admin_users, so userType is "admin". */
const ADMIN_USER_TYPES = new Set(['owner', 'admin', 'manager', 'hr', 'finance']);

function staff(role, extra = {}) {
  return {
    token: 't',
    userId: 'auth-' + role,
    email: role + '@example.test',
    orgId: ORG,
    role,
    userType: ADMIN_USER_TYPES.has(role) ? 'admin' : 'developer',
    appUserId: ME,
    overrides: {},
    overridesUnavailable: false,
    ...extra,
  };
}

function client(extra = {}) {
  return {
    token: 't',
    userId: 'auth-client',
    email: 'client@example.test',
    orgId: ORG,
    role: 'client',
    userType: 'client',
    appUserId: 'client-1',
    overrides: {},
    overridesUnavailable: false,
    ...extra,
  };
}

// ── The Supabase double ───────────────────────────────────────────────────
//
// A chainable stand-in that RECORDS every query instead of running one. The
// recording is the point: "did this request reach the UPDATE" is the only
// honest way to test a guard that is supposed to stop it, and a mock that only
// returns rows cannot answer it.
const { state } = vi.hoisted(() => ({
  state: { auth: null, tables: {}, queries: [], emails: [], fetches: [], aiTasks: [] },
}));

function resolveQuery(q) {
  const handler = state.tables[q.table];
  const byOp = handler && (typeof handler === 'function' ? handler : handler[q.op]);
  if (byOp === undefined) {
    return q.terminal ? { data: null, error: null } : { data: [], error: null, count: 0 };
  }
  return typeof byOp === 'function' ? byOp(q) : byOp;
}

function builder(table, op, payload) {
  const q = { table, op, payload, filters: [], terminal: null };
  state.queries.push(q);
  const chain = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (onFulfilled, onRejected) =>
            Promise.resolve(resolveQuery(q)).then(onFulfilled, onRejected);
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => {
            q.terminal = prop;
            return chain;
          };
        }
        return (...args) => {
          q.filters.push({ method: String(prop), args });
          return chain;
        };
      },
    }
  );
  return chain;
}

const db = {
  from(table) {
    return {
      select: (...a) => builder(table, 'select', a[0]),
      insert: (rows) => builder(table, 'insert', rows),
      update: (payload) => builder(table, 'update', payload),
      upsert: (payload) => builder(table, 'upsert', payload),
      delete: () => builder(table, 'delete', null),
    };
  },
  storage: {
    from: () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: 'https://example-test.supabase.co/signed' },
        error: null,
      }),
    }),
  },
};

/** Every recorded query of one kind. */
const queries = (table, op) =>
  state.queries.filter((q) => q.table === table && (op ? q.op === op : true));

/** Did this query carry `.eq(column, value)`? */
const hasEq = (q, column, value) =>
  q.filters.some(
    (f) => f.method === 'eq' && f.args[0] === column && String(f.args[1]) === String(value)
  );

// ── Module mocks ──────────────────────────────────────────────────────────
//
// serverPermissions is deliberately NOT mocked. It is the thing under test:
// mocking it would turn every assertion below into a test of the mock.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }));

vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => db,
}));

vi.mock('@/utils/entitlements', () => ({
  requireUnlocked: async () => null,
  checkFeatureAccess: async () => null,
  requireUnlockedOrg: async () => null,
}));

vi.mock('@/utils/emailService', () => ({
  emailMode: () => 'mock',
  sendTemplatedEmail: async (payload) => {
    state.emails.push(payload);
    return { delivered: true };
  },
}));

vi.mock('mammoth', () => ({
  default: { extractRawText: async () => ({ value: 'A requirements document.' }) },
}));

// ── Route handles ─────────────────────────────────────────────────────────
const notifyPOST = () => import('@/app/api/automation/notify/route').then((m) => m.POST);
const aiPOST = () => import('@/app/api/ai-generate-tasks/route').then((m) => m.POST);
const changeRequestsGET = () => import('@/app/api/change-requests/route').then((m) => m.GET);
const changeRequestsPOST = () => import('@/app/api/change-requests/route').then((m) => m.POST);
const proposalsGET = () => import('@/app/api/proposals/route').then((m) => m.GET);
const proposalsPOST = () => import('@/app/api/proposals/route').then((m) => m.POST);
const submissionPOST = () => import('@/app/api/task-submission/route').then((m) => m.POST);
const adminReviewPOST = () => import('@/app/api/admin-review/route').then((m) => m.POST);
const planReviewPOST = () => import('@/app/api/task-plan/review/route').then((m) => m.POST);

function postRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(url) {
  return new Request(url, { method: 'GET' });
}

async function call(handler, request) {
  const response = await handler(request);
  return { status: response.status, body: await response.json() };
}

let realFetch;

beforeEach(() => {
  state.auth = null;
  state.tables = {};
  state.queries = [];
  state.emails = [];
  state.fetches = [];
  state.aiTasks = [{ title: 'Build the thing', description: 'Do it', noOfDays: 2 }];

  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url) => {
    const href = String(url);
    state.fetches.push(href);
    if (href.includes('router.huggingface.co')) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(state.aiTasks) } }],
        }),
      };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// 1. /api/automation/notify — automation.manage
// ══════════════════════════════════════════════════════════════════════════

const NOTIFY_ALLOWED = ['owner', 'admin'];

function notifyTables() {
  state.tables = {
    memberships: {
      select: () => ({
        data: [
          { user_id: COLLEAGUE, user_type: 'developer', email: 'c@example.test', role: 'developer' },
        ],
        error: null,
      }),
    },
    organizations: { select: () => ({ data: { name: 'Acme' }, error: null }) },
    notifications: { insert: () => ({ data: null, error: null }) },
  };
}

async function notify(auth) {
  state.auth = auth;
  notifyTables();
  return call(
    await notifyPOST(),
    postRequest('http://localhost/api/automation/notify', {
      userIds: [COLLEAGUE],
      subject: 'Ship it',
      message: 'Please ship it',
      sendEmail: true,
    })
  );
}

describe('/api/automation/notify only fans out for automation.manage', () => {
  it.each(NOTIFY_ALLOWED)('%s may send', async (role) => {
    const { status } = await notify(staff(role));
    expect(status).toBe(200);
    expect(queries('notifications', 'insert')).toHaveLength(1);
  });

  it.each(STAFF_ROLES.filter((r) => !NOTIFY_ALLOWED.includes(r)))(
    '%s is refused, and nothing is written or emailed',
    async (role) => {
      const { status } = await notify(staff(role));
      expect(status).toBe(403);
      // The two assertions that make deleting the guard fail. A status-only
      // test would still pass against a route that 403s AFTER sending.
      expect(queries('notifications', 'insert')).toHaveLength(0);
      expect(state.emails).toHaveLength(0);
    }
  );

  it('refuses a client even if their role column says owner', async () => {
    const { status } = await notify(client({ role: 'owner' }));
    expect(status).toBe(403);
    expect(state.emails).toHaveLength(0);
  });

  it('answers 401 with no token at all', async () => {
    state.auth = null;
    notifyTables();
    const { status } = await call(
      await notifyPOST(),
      postRequest('http://localhost/api/automation/notify', { userIds: [COLLEAGUE] })
    );
    expect(status).toBe(401);
  });

  it('really does send for an allowed role — so the refusals above mean something', async () => {
    const { status } = await notify(staff('owner'));
    expect(status).toBe(200);
    expect(state.emails).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. /api/ai-generate-tasks — task.manage, plus the caps and the org stamp
// ══════════════════════════════════════════════════════════════════════════

const TASK_MANAGE = ['owner', 'admin', 'manager', 'team_lead'];

function aiTables() {
  state.tables = {
    projects: {
      select: () => ({
        data: {
          assigned_developer_id: COLLEAGUE,
          name: 'Apollo',
          created_at: '2026-01-01',
          assigned_at: null,
          assigned_date: null,
        },
        error: null,
      }),
      update: () => ({ data: null, error: null }),
    },
    developer_tasks: { insert: () => ({ data: null, error: null }) },
  };
}

async function generate(auth) {
  state.auth = auth;
  aiTables();
  return call(
    await aiPOST(),
    postRequest('http://localhost/api/ai-generate-tasks', {
      projectId: 'proj-1',
      fileUrl: 'https://example-test.supabase.co/storage/v1/object/public/reqs.docx',
    })
  );
}

describe('/api/ai-generate-tasks only writes tasks for task.manage', () => {
  it.each(TASK_MANAGE)('%s may generate', async (role) => {
    const { status } = await generate(staff(role));
    expect(status).toBe(200);
    expect(queries('developer_tasks', 'insert')).toHaveLength(1);
  });

  it.each(STAFF_ROLES.filter((r) => !TASK_MANAGE.includes(r)))(
    '%s is refused before a single task is written or a model is billed',
    async (role) => {
      const { status } = await generate(staff(role));
      expect(status).toBe(403);
      expect(queries('developer_tasks', 'insert')).toHaveLength(0);
      // The money half of the finding: the refusal must land BEFORE the call
      // to the third-party model provider, not after it.
      expect(state.fetches.filter((u) => u.includes('router.huggingface.co'))).toHaveLength(0);
    }
  );

  it('refuses a client', async () => {
    const { status } = await generate(client());
    expect(status).toBe(403);
    expect(queries('developer_tasks', 'insert')).toHaveLength(0);
  });

  it('stamps every generated task with the organization from the TOKEN', async () => {
    // These rows are written with the service role, which bypasses both RLS and
    // the trigger that would otherwise fill this in. Without it the tasks exist
    // and no org-scoped query can see them.
    await generate(staff('manager', { orgId: ORG }));
    const rows = queries('developer_tasks', 'insert')[0].payload;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.organization_id).toBe(ORG);
    }
  });

  it('never takes the organization from anywhere but the token', async () => {
    state.auth = staff('manager', { orgId: OTHER_ORG });
    aiTables();
    await call(
      await aiPOST(),
      postRequest('http://localhost/api/ai-generate-tasks', {
        projectId: 'proj-1',
        organizationId: ORG,
        organization_id: ORG,
        fileUrl: 'https://example-test.supabase.co/reqs.docx',
      })
    );
    const rows = queries('developer_tasks', 'insert')[0].payload;
    expect(rows.every((r) => r.organization_id === OTHER_ORG)).toBe(true);
  });

  it('caps how many tasks one generation may insert', async () => {
    state.aiTasks = Array.from({ length: 400 }, (_, i) => ({
      title: `Task ${i}`,
      description: 'x',
      noOfDays: 1,
    }));
    const { status, body } = await generate(staff('admin'));
    expect(status).toBe(200);
    const rows = queries('developer_tasks', 'insert')[0].payload;
    expect(rows.length).toBeLessThanOrEqual(100);
    // The template written back to the project must describe the same set that
    // was inserted, or the screen and the table disagree forever.
    expect(body.tasks).toHaveLength(rows.length);
  });

  it('caps the length of a title and a description', async () => {
    state.aiTasks = [
      { title: 'T'.repeat(5000), description: 'D'.repeat(50000), noOfDays: 1 },
    ];
    await generate(staff('admin'));
    const [row] = queries('developer_tasks', 'insert')[0].payload;
    expect(row.task_title.length).toBeLessThanOrEqual(200);
    expect(row.task_description.length).toBeLessThanOrEqual(2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. The commercial pipeline: change-requests GET and proposals GET
// ══════════════════════════════════════════════════════════════════════════

const PIPELINE_READERS = ['owner', 'admin', 'manager', 'team_lead'];

const CHANGE_REQUEST_ROW = {
  id: 'cr-1',
  title: 'Add SSO',
  estimated_cost: 42000,
  estimated_hours: 300,
  pm_notes: 'They will not like the price.',
};

const PROPOSAL_ROW = { id: 'p-1', title: 'New portal', budget: 90000, internal_notes: 'lowball' };

async function listChangeRequests(auth) {
  state.auth = auth;
  state.tables = {
    change_requests: { select: () => ({ data: [CHANGE_REQUEST_ROW], error: null }) },
    project_clients: { select: () => ({ data: [{ project_id: 'proj-1' }], error: null }) },
  };
  return call(await changeRequestsGET(), getRequest('http://localhost/api/change-requests'));
}

async function listProposals(auth) {
  state.auth = auth;
  state.tables = {
    project_proposals: { select: () => ({ data: [PROPOSAL_ROW], error: null }) },
  };
  return call(await proposalsGET(), getRequest('http://localhost/api/proposals'));
}

describe('/api/change-requests GET does not hand the margin to every staff role', () => {
  it.each(PIPELINE_READERS)('%s sees the queue', async (role) => {
    const { status, body } = await listChangeRequests(staff(role));
    expect(status).toBe(200);
    expect(body.changeRequests).toHaveLength(1);
    expect(body.changeRequests[0].estimated_cost).toBe(42000);
  });

  it.each(STAFF_ROLES.filter((r) => !PIPELINE_READERS.includes(r)))(
    '%s is refused, and gets no row and no cost',
    async (role) => {
      const { status, body } = await listChangeRequests(staff(role));
      expect(status).toBe(403);
      expect(body.changeRequests).toBeUndefined();
      // Belt and braces against a "refuse but still serialise" mistake.
      expect(JSON.stringify(body)).not.toContain('42000');
      expect(JSON.stringify(body)).not.toContain('pm_notes');
    }
  );

  it('still serves a client its own projects, with pm_notes stripped', async () => {
    // requirePermission 403s every client, so a guard placed above the client
    // branch instead of inside the staff branch would break the client portal.
    const { status, body } = await listChangeRequests(client());
    expect(status).toBe(200);
    expect(body.changeRequests).toHaveLength(1);
    expect(body.changeRequests[0]).not.toHaveProperty('pm_notes');
  });

  it('leaves POST alone — a manager may still raise one', async () => {
    state.auth = staff('manager');
    state.tables = {
      projects: { select: () => ({ data: { id: 'proj-1' }, error: null }) },
      change_requests: { insert: () => ({ data: { id: 'cr-2' }, error: null }) },
      memberships: { select: () => ({ data: [], error: null }) },
    };
    const { status } = await call(
      await changeRequestsPOST(),
      postRequest('http://localhost/api/change-requests', {
        projectId: 'proj-1',
        title: 'Add SSO',
        description: 'Please add SSO',
      })
    );
    expect(status).toBe(201);
  });
});

describe('/api/proposals GET does not hand every client budget to every staff role', () => {
  it.each(PIPELINE_READERS)('%s sees the queue', async (role) => {
    const { status, body } = await listProposals(staff(role));
    expect(status).toBe(200);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].budget).toBe(90000);
  });

  it.each(STAFF_ROLES.filter((r) => !PIPELINE_READERS.includes(r)))(
    '%s is refused, and gets no proposal and no budget',
    async (role) => {
      const { status, body } = await listProposals(staff(role));
      expect(status).toBe(403);
      expect(body.proposals).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('90000');
    }
  );

  it('still serves a client its own proposals, with internal_notes stripped', async () => {
    const { status, body } = await listProposals(client());
    expect(status).toBe(200);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]).not.toHaveProperty('internal_notes');
  });

  it('scopes a client to its own client_id even though the query is service-role', async () => {
    await listProposals(client({ appUserId: 'client-7' }));
    const q = queries('project_proposals', 'select')[0];
    expect(hasEq(q, 'client_id', 'client-7')).toBe(true);
  });

  it('leaves POST alone — it is still client-only', async () => {
    state.auth = staff('owner');
    state.tables = {};
    const { status, body } = await call(
      await proposalsPOST(),
      postRequest('http://localhost/api/proposals', { title: 'x', description: 'y' })
    );
    expect(status).toBe(403);
    expect(body.error).toMatch(/Only a client can submit/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. /api/task-submission — you submit your own work
// ══════════════════════════════════════════════════════════════════════════

const REJECTED_TASK = {
  id: 'task-1',
  developer_id: COLLEAGUE,
  project_id: 'proj-1',
  task_title: 'Ship the thing',
  end_date: '2030-01-01',
  status: 'rejected',
  rejection_reason: 'Tests missing',
  reviewed_by: 'reviewer-1',
};

function submissionTables(task = REJECTED_TASK) {
  state.tables = {
    developer_tasks: {
      select: (q) => (q.terminal ? { data: task, error: null } : { data: [], error: null }),
      update: () => ({ data: null, error: null }),
    },
    task_submissions: {
      select: () => ({ data: null, error: null }),
      insert: () => ({ data: { id: 'sub-1' }, error: null }),
    },
    activity_logs: { insert: () => ({ data: null, error: null }) },
    projects: { select: () => ({ data: { created_by: 'admin-1', name: 'Apollo' }, error: null }) },
    developers: { select: () => ({ data: { name: 'Colleague' }, error: null }) },
    notifications: { insert: () => ({ data: null, error: null }) },
  };
}

async function submit(auth, { developerId = COLLEAGUE, task = REJECTED_TASK } = {}) {
  state.auth = auth;
  submissionTables(task);
  return call(
    await submissionPOST(),
    postRequest('http://localhost/api/task-submission', {
      taskId: 'task-1',
      projectId: 'proj-1',
      developerId,
      fileUrl: 'https://example-test.supabase.co/proof.png',
      fileName: 'proof.png',
      fileType: 'image/png',
      fileSize: 100,
      storagePath: 'org-1111/proof.png',
      submissionNotes: 'done',
    })
  );
}

describe('/api/task-submission: the submitter has to be the assignee', () => {
  it('the assignee may submit their own task', async () => {
    const { status } = await submit(staff('developer', { appUserId: COLLEAGUE }));
    expect(status).toBe(200);
    expect(queries('developer_tasks', 'update')).toHaveLength(1);
  });

  it.each(['developer', 'designer', 'qa', 'devops', 'employee', 'hr', 'finance'])(
    'a %s who is not the assignee is refused, and the recorded verdict survives',
    async (role) => {
      const { status } = await submit(staff(role, { appUserId: THIRD_PARTY }));
      expect(status).toBe(403);
      // The damage the finding is actually about: the update clears
      // reviewed_by / reviewed_at / rejection_reason / admin_comments. If it
      // never runs, the verdict is still on the row.
      expect(queries('developer_tasks', 'update')).toHaveLength(0);
      expect(queries('task_submissions', 'insert')).toHaveLength(0);
    }
  );

  it('an HR user cannot forge attribution by naming a developer in the body', async () => {
    // The exact old hole: actingDeveloperId was forced to the token identity
    // only when userType === "developer", and hr/admin/owner are all userType
    // "admin", so the body decided who the submission said had done the work.
    const { status } = await submit(staff('hr', { appUserId: THIRD_PARTY }), {
      developerId: COLLEAGUE,
    });
    expect(status).toBe(403);
    expect(queries('task_submissions', 'insert')).toHaveLength(0);
  });

  it.each(['owner', 'admin', 'manager', 'team_lead'])(
    'a %s holds task.manage and may submit on the assignee\'s behalf',
    async (role) => {
      const { status } = await submit(staff(role, { appUserId: THIRD_PARTY }));
      expect(status).toBe(200);
    }
  );

  it('attributes an on-behalf submission to the real assignee, never to the body', async () => {
    await submit(staff('manager', { appUserId: THIRD_PARTY }), { developerId: 'someone-else' });
    const row = queries('task_submissions', 'insert')[0].payload;
    expect(row.developer_id).toBe(COLLEAGUE);
    expect(row.developer_id).not.toBe('someone-else');
    const log = queries('activity_logs', 'insert')[0].payload;
    expect(log.developer_id).toBe(COLLEAGUE);
  });

  it('keeps an audit copy of the verdict the resubmission clears', async () => {
    await submit(staff('developer', { appUserId: COLLEAGUE }));
    const update = queries('developer_tasks', 'update')[0].payload;
    expect(update.rejection_reason).toBeNull();
    expect(update.reviewed_by).toBeNull();
    const log = queries('activity_logs', 'insert')[0].payload;
    expect(log.old_value).toBe('rejected');
    expect(log.action_description).toContain('Tests missing');
  });

  it('scopes the status update to the organization, like every other write here', async () => {
    await submit(staff('developer', { appUserId: COLLEAGUE }));
    const update = queries('developer_tasks', 'update')[0];
    expect(hasEq(update, 'id', 'task-1')).toBe(true);
    expect(hasEq(update, 'organization_id', ORG)).toBe(true);
  });

  it('refuses a task with no assignee rather than inventing one', async () => {
    const { status } = await submit(staff('developer', { appUserId: COLLEAGUE }), {
      task: { ...REJECTED_TASK, developer_id: null },
    });
    expect(status).toBe(409);
    expect(queries('developer_tasks', 'update')).toHaveLength(0);
  });

  it('still refuses a resubmission of an approved task', async () => {
    const { status } = await submit(staff('developer', { appUserId: COLLEAGUE }), {
      task: { ...REJECTED_TASK, status: 'completed' },
    });
    expect(status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. Separation of duties — nobody reviews their own work
// ══════════════════════════════════════════════════════════════════════════

const REVIEWERS = ['owner', 'admin', 'manager', 'team_lead', 'qa'];

function reviewTables({ taskDeveloper, submissionDeveloper, reviewer }) {
  state.tables = {
    developer_tasks: {
      select: (q) =>
        q.terminal
          ? {
              data: {
                id: 'task-1',
                developer_id: taskDeveloper,
                project_id: 'proj-1',
                task_title: 'Ship it',
                end_date: '2030-01-01',
                status: 'awaiting_approval',
              },
              error: null,
            }
          : { data: [], error: null },
      update: () => ({ data: null, error: null }),
    },
    // The reviewer owns the project — the check that already existed. It is
    // satisfied here on purpose, so the ONLY thing these tests can be failing
    // or passing on is the self-review rule.
    projects: {
      select: () => ({ data: { id: 'proj-1', created_by: reviewer, added_by: null }, error: null }),
      update: () => ({ data: null, error: null }),
    },
    task_submissions: {
      select: () => ({
        data: {
          id: 'sub-1',
          task_id: 'task-1',
          developer_id: submissionDeveloper,
          submitted_at: '2029-12-01T00:00:00.000Z',
          review_status: 'pending',
          is_reviewed: false,
          file_url: 'https://example-test.supabase.co/proof.png',
        },
        error: null,
      }),
      update: () => ({ data: null, error: null }),
    },
    admin_reviews: { insert: () => ({ data: null, error: null }) },
    activity_logs: { insert: () => ({ data: null, error: null }) },
    productivity_metrics: { upsert: () => ({ data: null, error: null }) },
    notifications: { insert: () => ({ data: null, error: null }) },
  };
}

async function review(auth, { taskDeveloper, submissionDeveloper } = {}) {
  state.auth = auth;
  reviewTables({
    taskDeveloper: taskDeveloper ?? COLLEAGUE,
    submissionDeveloper: submissionDeveloper ?? taskDeveloper ?? COLLEAGUE,
    reviewer: auth.appUserId,
  });
  return call(
    await adminReviewPOST(),
    postRequest('http://localhost/api/admin-review', {
      submissionId: 'sub-1',
      taskId: 'task-1',
      action: 'approve',
      comments: 'Looks good',
    })
  );
}

describe('/api/admin-review refuses to let anyone approve their own work', () => {
  it.each(REVIEWERS)('a %s may review a colleague\'s submission', async (role) => {
    const { status } = await review(staff(role, { appUserId: ME }), { taskDeveloper: COLLEAGUE });
    expect(status).toBe(200);
    expect(queries('developer_tasks', 'update')).toHaveLength(1);
  });

  it.each(REVIEWERS)('a %s may NOT review a task assigned to themselves', async (role) => {
    // The team_lead case is the whole finding: they hold task.review,
    // task.submit AND project.create, so one person can create the project,
    // assign themselves, submit, approve and bank the point.
    const { status, body } = await review(staff(role, { appUserId: ME }), { taskDeveloper: ME });
    expect(status).toBe(403);
    expect(body.error).toMatch(/your own/i);
    // No point awarded, no status moved, no review record written.
    expect(queries('developer_tasks', 'update')).toHaveLength(0);
    expect(queries('task_submissions', 'update')).toHaveLength(0);
    expect(queries('admin_reviews', 'insert')).toHaveLength(0);
    expect(queries('productivity_metrics', 'upsert')).toHaveLength(0);
  });

  it.each(['owner', 'admin'])(
    '%s is NOT exempt — separation of duties that stops at the top is not separation of duties',
    async (role) => {
      const { status } = await review(staff(role, { appUserId: ME }), { taskDeveloper: ME });
      expect(status).toBe(403);
      expect(queries('developer_tasks', 'update')).toHaveLength(0);
    }
  );

  it('refuses when the SUBMISSION is theirs even if the task names someone else', async () => {
    // Both identities are checked, because either one alone is a way round.
    const { status } = await review(staff('manager', { appUserId: ME }), {
      taskDeveloper: COLLEAGUE,
      submissionDeveloper: ME,
    });
    expect(status).toBe(403);
    expect(queries('admin_reviews', 'insert')).toHaveLength(0);
  });

  it('refuses a self-review of a REJECTION too, not only an approval', async () => {
    state.auth = staff('manager', { appUserId: ME });
    reviewTables({ taskDeveloper: ME, submissionDeveloper: ME, reviewer: ME });
    const { status } = await call(
      await adminReviewPOST(),
      postRequest('http://localhost/api/admin-review', {
        submissionId: 'sub-1',
        taskId: 'task-1',
        action: 'reject',
        rejectionReason: 'convenient',
      })
    );
    expect(status).toBe(403);
    expect(queries('developer_tasks', 'update')).toHaveLength(0);
  });

  it.each(STAFF_ROLES.filter((r) => !REVIEWERS.includes(r)))(
    '%s still cannot reach the route at all',
    async (role) => {
      const { status } = await review(staff(role, { appUserId: ME }), { taskDeveloper: COLLEAGUE });
      expect(status).toBe(403);
      expect(queries('developer_tasks', 'update')).toHaveLength(0);
    }
  );
});

// ── /api/task-plan/review ─────────────────────────────────────────────────

function planTables(assignedDeveloperId, reviewer) {
  state.tables = {
    projects: {
      select: () => ({
        data: {
          id: 'proj-1',
          created_by: reviewer,
          added_by: null,
          added_by_admin: null,
          assigned_developer_id: assignedDeveloperId,
          task_plan_submitted: true,
          task_plan_status: 'pending',
        },
        error: null,
      }),
      update: () => ({ data: { id: 'proj-1', task_plan_status: 'approved' }, error: null }),
    },
  };
}

async function reviewPlan(auth, assignedDeveloperId) {
  state.auth = auth;
  planTables(assignedDeveloperId, auth.appUserId);
  return call(
    await planReviewPOST(),
    postRequest('http://localhost/api/task-plan/review', {
      projectId: 'proj-1',
      adminId: auth.appUserId,
      action: 'approve',
    })
  );
}

describe('/api/task-plan/review refuses to let anyone approve their own plan', () => {
  it.each(REVIEWERS)('a %s may approve a plan somebody else submitted', async (role) => {
    const { status } = await reviewPlan(staff(role, { appUserId: ME }), COLLEAGUE);
    expect(status).toBe(200);
    expect(queries('projects', 'update')).toHaveLength(1);
  });

  it.each(REVIEWERS)('a %s may NOT approve the plan for a project assigned to them', async (role) => {
    const { status, body } = await reviewPlan(staff(role, { appUserId: ME }), ME);
    expect(status).toBe(403);
    expect(body.error).toMatch(/your own/i);
    expect(queries('projects', 'update')).toHaveLength(0);
  });

  it.each(['owner', 'admin'])('%s is not exempt here either', async (role) => {
    const { status } = await reviewPlan(staff(role, { appUserId: ME }), ME);
    expect(status).toBe(403);
    expect(queries('projects', 'update')).toHaveLength(0);
  });

  it('refuses a self-review of a rejection too', async () => {
    state.auth = staff('manager', { appUserId: ME });
    planTables(ME, ME);
    const { status } = await call(
      await planReviewPOST(),
      postRequest('http://localhost/api/task-plan/review', {
        projectId: 'proj-1',
        adminId: ME,
        action: 'reject',
        rejectionReason: 'not really',
      })
    );
    expect(status).toBe(403);
    expect(queries('projects', 'update')).toHaveLength(0);
  });
});
