import { supabase } from "@/utils/supabaseClient";
import { isOnSomeonesPlate } from "@/utils/taskState";

/**
 * Who works here, what the projects are, and which tasks join the two.
 *
 * WHY THIS IS ONE MODULE AND NOT TWO SCREENS' WORTH OF QUERIES
 *
 * Team Structure asks "for this project, who is on it?". Capacity asks "for
 * this person, what are they on?". They are the same graph read from opposite
 * ends, off the same five tables, with the same joining rules — and the joining
 * rules are the part worth getting right once:
 *
 *   - a person's ROLE comes from `memberships`
 *   - their NAME comes from `developers` or `admin_users`, because staff and
 *     admins are two tables and PostgREST cannot union them in one request
 *   - a person is ON a project via `projects.manager_id`, the legacy single
 *     `projects.assigned_developer_id`, or by holding a `developer_tasks` row
 *
 * Two copies of that would drift, and the drift would show as two screens
 * disagreeing about who is on a project — the least debuggable kind of bug,
 * because both look right on their own.
 *
 * IT IS FIVE QUERIES. Counted, not estimated.
 *
 * This replaced a call to `loadEmployees()`, which reads like one call and is
 * seven: memberships, developers, admin_users, employee_profiles, teams,
 * departments and projects. A helper whose cost is invisible at the call site
 * is how a page ends up slow while every line in it looks cheap. Four is not
 * reachable without dropping `admin_users` and printing an email where an
 * owner-or-admin project manager's name belongs.
 *
 * NOTHING HERE FETCHES PER PROJECT OR PER PERSON. Everything is grouped in
 * memory afterwards. The shape that kills these screens is a query inside a
 * map over projects.
 */

/**
 * Capacity asks whether the ASSIGNEE is still holding the task, which is not
 * the same question as whether it is finished — see utils/taskState.js, which
 * holds both and explains the one status they disagree about.
 *
 * `rejected` counts as on their plate: work sent back is back with the person
 * who did it, and a capacity view that forgets that reports them as free while
 * they are fixing something.
 */
export const isOpenTask = isOnSomeonesPlate;

/** yyyy-mm-dd, for date-only comparison without a timezone argument. */
const ymd = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export function isOverdue(task, today = ymd(new Date())) {
  if (!isOpenTask(task)) return false;
  const due = ymd(task?.due_date || task?.end_date);
  return Boolean(due && today && due < today);
}

/**
 * Load the graph for one organization.
 *
 * Returns:
 *   projects       — array, archived removed
 *   projectById    — Map<id, project>
 *   tasks          — array
 *   tasksByProject — Map<projectId, task[]>
 *   tasksByPerson  — Map<userId, task[]>
 *   people         — array of { userId, name, email, role }
 *   personById     — Map<userId, person>
 *   personByEmail  — Map<lowercased email, person>
 */
export async function loadOrgWorkGraph(orgId) {
  if (!orgId) throw new Error("Your session has no organization. Sign in again.");

  const [projRes, taskRes, memRes, devRes, adminRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, status, progress, priority, deadline, end_date, manager_id, " +
          "assigned_developer_id, assigned_developer_email, archived"
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("developer_tasks")
      // `task_type` is here for one reason: a bug IS a developer_tasks row with
      // task_type='bug' (see utils/bugs.js — there is no bug table). Selecting
      // one more column on a query this module already makes is what lets the
      // admin Overview count open bugs without a ninth request. Team Structure
      // and Capacity ignore it.
      .select("id, project_id, developer_id, status, due_date, task_title, task_type")
      .eq("organization_id", orgId)
      .limit(5000),
    supabase
      .from("memberships")
      .select("user_id, user_type, role, email, status")
      .eq("organization_id", orgId)
      .neq("user_type", "client"),
    supabase.from("developers").select("id, name, email").eq("organization_id", orgId),
    supabase.from("admin_users").select("id, full_name, email").eq("organization_id", orgId),
  ]);

  // Only the projects read is fatal. A screen with people and no tasks is
  // thin but honest; a screen with no projects has nothing to say at all.
  if (projRes.error) throw projRes.error;

  const nameById = new Map();
  for (const d of devRes.data || []) {
    nameById.set(String(d.id), { name: d.name, email: d.email });
  }
  for (const a of adminRes.data || []) {
    nameById.set(String(a.id), { name: a.full_name, email: a.email });
  }

  const personById = new Map();
  const personByEmail = new Map();
  for (const m of memRes.data || []) {
    if (!m.user_id) continue;
    const profile = nameById.get(String(m.user_id)) || {};
    const email = profile.email || m.email || "";
    const person = {
      userId: m.user_id,
      // A membership whose profile row is missing still appears, named from the
      // local part of its address. Somebody silently absent from their own
      // project is worse than somebody shown by an imperfect name.
      name: profile.name || (email ? email.split("@")[0] : "Member"),
      email,
      role: m.role || m.user_type || "developer",
      status: m.status || "active",
    };
    personById.set(String(m.user_id), person);
    if (email) personByEmail.set(email.toLowerCase(), person);
  }

  const projects = (projRes.data || []).filter((p) => !p.archived);
  const projectById = new Map(projects.map((p) => [String(p.id), p]));

  const tasks = taskRes.data || [];
  const tasksByProject = new Map();
  const tasksByPerson = new Map();
  for (const t of tasks) {
    if (t.project_id) {
      const key = String(t.project_id);
      if (!tasksByProject.has(key)) tasksByProject.set(key, []);
      tasksByProject.get(key).push(t);
    }
    if (t.developer_id) {
      const key = String(t.developer_id);
      if (!tasksByPerson.has(key)) tasksByPerson.set(key, []);
      tasksByPerson.get(key).push(t);
    }
  }

  return {
    projects,
    projectById,
    tasks,
    tasksByProject,
    tasksByPerson,
    people: Array.from(personById.values()),
    personById,
    personByEmail,
  };
}

/**
 * Everybody on one project: the union of the three facts that put them there.
 *
 * `taskCount` is summed, not counted per row — somebody holding four tasks is
 * one team member, not four.
 *
 * The manager is returned separately and REMOVED from the team, because every
 * screen showing this renders them above it. Leaving them in both places is how
 * a two-person project reports three people.
 */
export function projectTeam(project, graph) {
  const tasks = graph.tasksByProject.get(String(project.id)) || [];
  const members = new Map();

  const add = (person, taskCount = 0) => {
    if (!person?.userId) return;
    const key = String(person.userId);
    const seen = members.get(key);
    if (seen) {
      seen.taskCount += taskCount;
      return;
    }
    members.set(key, { key, ...person, taskCount });
  };

  const manager = project.manager_id
    ? graph.personById.get(String(project.manager_id)) || null
    : null;

  if (project.assigned_developer_id) {
    add(graph.personById.get(String(project.assigned_developer_id)));
  } else if (project.assigned_developer_email) {
    add(graph.personByEmail.get(String(project.assigned_developer_email).toLowerCase()));
  }

  for (const t of tasks) {
    if (!t.developer_id) continue;
    add(graph.personById.get(String(t.developer_id)), 1);
  }

  if (manager?.userId) members.delete(String(manager.userId));

  return {
    manager: manager ? { key: String(manager.userId), ...manager, taskCount: 0 } : null,
    team: Array.from(members.values()),
    tasks,
  };
}

/**
 * The other direction: what one person is carrying, across every project.
 *
 * `projects` counts the DISTINCT projects they hold open work on, plus any they
 * manage. Somebody managing three projects with no tasks of their own is not
 * idle, and a capacity view that shows them as free is the reason work lands on
 * the wrong person.
 */
export function personLoad(person, graph, today = ymd(new Date())) {
  const tasks = graph.tasksByPerson.get(String(person.userId)) || [];
  const open = tasks.filter(isOpenTask);
  const overdue = open.filter((t) => isOverdue(t, today));

  const projectIds = new Set();
  for (const t of open) if (t.project_id) projectIds.add(String(t.project_id));
  const managing = graph.projects.filter(
    (p) => p.manager_id && String(p.manager_id) === String(person.userId)
  );
  for (const p of managing) projectIds.add(String(p.id));

  return {
    openTasks: open.length,
    totalTasks: tasks.length,
    overdue: overdue.length,
    projectCount: projectIds.size,
    projectIds: Array.from(projectIds),
    managingCount: managing.length,
    tasks: open,
  };
}

/**
 * A word for how loaded somebody is.
 *
 * THE THRESHOLDS ARE A CONVENTION, NOT A MEASUREMENT. Nothing in this product
 * records how long a task takes, so "6 open tasks" is heavy for one person and
 * a quiet week for another. They exist to sort the list and to make the
 * extremes visible — not to tell anybody they are overloaded. Any screen using
 * them must show the underlying count beside the label, so the reader can
 * disagree with it.
 *
 * Overdue work outranks volume: two overdue tasks is a worse position than six
 * on-time ones, and sorting purely by count hides exactly that.
 */
export const LOAD_LEVELS = {
  free: { id: "free", label: "Free", tone: "muted", rank: 0 },
  light: { id: "light", label: "Light", tone: "success", rank: 1 },
  steady: { id: "steady", label: "Steady", tone: "info", rank: 2 },
  heavy: { id: "heavy", label: "Heavy", tone: "warning", rank: 3 },
  overloaded: { id: "overloaded", label: "Overloaded", tone: "error", rank: 4 },
};

export function loadLevel({ openTasks, overdue }) {
  if (overdue >= 3) return LOAD_LEVELS.overloaded;
  if (openTasks === 0) return LOAD_LEVELS.free;
  if (openTasks >= 10) return LOAD_LEVELS.overloaded;
  if (openTasks >= 6 || overdue > 0) return LOAD_LEVELS.heavy;
  if (openTasks >= 3) return LOAD_LEVELS.steady;
  return LOAD_LEVELS.light;
}
