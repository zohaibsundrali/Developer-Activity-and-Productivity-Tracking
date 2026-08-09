import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The re-plan submission guard — src/utils/replanGuard.js.
 *
 * THE DEFECT THESE TESTS PIN DOWN
 *  /developer/project-details replaces a project's still-pending developer_tasks
 *  when a plan is re-saved. developer_tasks cascades, so deleting a task deletes
 *  its task_submissions row — the uploaded proof of work, the submission note
 *  and the admin's review comments — with it. The guard's only job is to keep a
 *  task that already carries a submission OUT of that delete set.
 *
 *  It used to select task_submissions through the browser's anon-key client,
 *  with no developer filter, trusting RLS to return every relevant row.
 *  Migration 047 narrowed task_submissions to per-person: owner/admin/hr see the
 *  organisation, manager/team_lead see their reporting subtree, everyone else
 *  sees only their own. So for a manager or team_lead re-planning on behalf of
 *  somebody outside their subtree the query returned NOTHING, the guard
 *  concluded "no submissions", and the delete destroyed submitted work. A safety
 *  net had silently become the destructive path.
 *
 *  The repair routes the check through GET /api/task-submission, which runs on
 *  the service-role client after authenticating the caller and scoping to their
 *  organisation. Service role bypasses RLS, so what comes back is a fact about
 *  the rows rather than a projection of who is asking.
 *
 *  Four properties have to stay true, and each has a test below:
 *   1. The guard sees a submission it must not delete over EVEN WHEN the
 *      caller's own RLS view of task_submissions would have been empty.
 *   2. The request carries the caller's bearer token — it goes through
 *      authFetch, so it is not answered with a 401 whose empty body would read
 *      as "no submissions".
 *   3. It does not narrow the query by developer, so a submission left by a
 *      previous assignee on a reassigned task is still seen.
 *   4. It FAILS CLOSED. Anything short of a trustworthy answer throws, and the
 *      caller aborts the re-plan, rather than yielding the empty set that the
 *      old code turned straight into a delete.
 */

vi.mock('@/utils/authFetch', () => ({
  authFetch: vi.fn(),
}));

const { authFetch } = await import('@/utils/authFetch');
const { taskIdsWithSubmissions } = await import('@/utils/replanGuard');

const PROJECT = 'project-1';

// The three still-pending tasks a re-saved plan proposes to replace.
const CANDIDATES = ['task-a', 'task-b', 'task-c'];

const ok = (submissions) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, submissions }),
});

const failure = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.mocked(authFetch).mockReset();
});

describe('it sees submissions the caller\'s own RLS view would hide', () => {
  it('keeps a task whose submission belongs to another developer', async () => {
    // The scenario migration 047 created: a manager re-plans for a developer
    // outside their reporting subtree. Under the browser client this select
    // returned zero rows. The service-role route returns the truth.
    authFetch.mockResolvedValue(
      ok([
        { task_id: 'task-b', developer_id: 'someone-elses-developer-id' },
      ])
    );

    const keep = await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect(keep.has('task-b')).toBe(true);
    // And the delete set the page computes from it excludes exactly that task.
    expect(CANDIDATES.filter((id) => !keep.has(id))).toEqual(['task-a', 'task-c']);
  });

  it('keeps every candidate when every one of them has been submitted', async () => {
    authFetch.mockResolvedValue(
      ok(CANDIDATES.map((task_id) => ({ task_id, developer_id: 'other-dev' })))
    );

    const keep = await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect([...keep].sort()).toEqual([...CANDIDATES].sort());
    expect(CANDIDATES.filter((id) => !keep.has(id))).toEqual([]);
  });

  it('still allows untouched tasks through, so the guard is not a blanket block', async () => {
    authFetch.mockResolvedValue(ok([]));

    const keep = await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect(keep.size).toBe(0);
    expect(CANDIDATES.filter((id) => !keep.has(id))).toEqual(CANDIDATES);
  });

  it('ignores submissions against tasks outside the candidate set', async () => {
    // The route answers per project, so it returns submissions for tasks this
    // re-plan is not touching. Those must not widen the keep set.
    authFetch.mockResolvedValue(
      ok([{ task_id: 'task-z' }, { task_id: 'task-a' }, { task_id: null }])
    );

    const keep = await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect([...keep]).toEqual(['task-a']);
  });

  it('compares ids as strings, so a non-string id is not silently missed', async () => {
    authFetch.mockResolvedValue(ok([{ task_id: 41 }]));

    const keep = await taskIdsWithSubmissions(PROJECT, [41, 42]);

    expect(keep.has('41')).toBe(true);
    expect(keep.has('42')).toBe(false);
  });
});

describe('the request itself', () => {
  it('goes through authFetch, so it carries the caller\'s bearer token', async () => {
    authFetch.mockResolvedValue(ok([]));

    await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url] = authFetch.mock.calls[0];
    expect(url).toContain('/api/task-submission');
    expect(url).toContain(`projectId=${PROJECT}`);
  });

  it('does not narrow the query by developer', async () => {
    // A reassigned task carries a submission from its PREVIOUS assignee. Asking
    // for one developer's submissions would go blind to it — 047's "STILL OPEN"
    // item (d). The guard asks by project only.
    authFetch.mockResolvedValue(ok([]));

    await taskIdsWithSubmissions(PROJECT, CANDIDATES);

    expect(authFetch.mock.calls[0][0]).not.toContain('developerId');
  });

  it('makes no request at all when there is nothing to guard', async () => {
    expect((await taskIdsWithSubmissions(PROJECT, [])).size).toBe(0);
    expect((await taskIdsWithSubmissions(PROJECT, null)).size).toBe(0);
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('it fails closed', () => {
  // Every case here used to be an empty result set, and an empty result set is
  // what the old code fed straight into `.delete()`.
  it('throws on 401 rather than reporting no submissions', async () => {
    authFetch.mockResolvedValue(failure(401, { error: 'Unauthorized' }));

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow('Unauthorized');
  });

  it('throws on 403', async () => {
    authFetch.mockResolvedValue(failure(403, { error: 'Forbidden' }));

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow('Forbidden');
  });

  it('throws on a 500 with an unreadable body', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow(
      /Could not verify existing task submissions/
    );
  });

  it('throws on a 200 that is not success:true', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'Failed to fetch submissions' }),
    });

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow(
      'Failed to fetch submissions'
    );
  });

  it('throws when the payload carries no submissions array', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow(
      /Could not verify existing task submissions/
    );
  });

  it('propagates a network failure instead of swallowing it', async () => {
    authFetch.mockRejectedValue(new Error('network down'));

    await expect(taskIdsWithSubmissions(PROJECT, CANDIDATES)).rejects.toThrow('network down');
  });

  it('refuses to run without a project id', async () => {
    await expect(taskIdsWithSubmissions('', CANDIDATES)).rejects.toThrow(/project id/);
    expect(authFetch).not.toHaveBeenCalled();
  });
});
