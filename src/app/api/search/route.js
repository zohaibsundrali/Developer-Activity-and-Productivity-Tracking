import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/search?q=<term>&limit=<n>&types=<csv>
//
// One search box over eight entity types. Every query runs through
// orgScopedClient(auth.token) — as the calling user, never as the service role —
// so Row Level Security decides row by row what comes back.
//
// There is deliberately no role matrix in this file. Eight roles times eight
// tables is a table that drifts out of step with the policies the moment either
// side changes, and it is the policies that are actually enforced. The only
// thing this route decides is WHICH TABLES IT TOUCHES; who may see which rows
// inside them is a database question.

const MIN_TERM_LENGTH = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// Every type a staff caller may search.
const STAFF_TYPES = [
  "project",
  "task",
  "employee",
  "team",
  "client",
  "sprint",
  "epic",
  "comment",
];

// The subset a client-portal user may search — what the portal itself shows.
//
// This list is load-bearing, not decoration. RLS is the enforcement for the
// tables that were hardened: memberships carries an auth_is_client() predicate
// (018), task_comments filters `internal` (033), and developer_tasks was
// narrowed to client_visible = true (035). But `developers`, `admin_users` and
// `teams` still sit behind the original 013 `org_isolation` policy, which is
// org-wide and says nothing about clients — a client asking those tables for
// rows would get them. For those three, this array IS the guard. Do not widen
// it without narrowing the policies first.
const CLIENT_TYPES = ["project", "task", "comment"];

// `%` and `_` are LIKE metacharacters and `\` is LIKE's default escape
// character, so all three have to be neutralised — an unescaped `_` turns
// "a_b" into a single-character wildcard and silently widens the match.
//
// `*` is escaped for a different reason: PostgREST rewrites `*` to `%` in
// like/ilike patterns before Postgres ever sees the string, so a bare asterisk
// widens the match the same way even though it is not a LIKE metacharacter.
function escapeLikeTerm(term) {
  return term.replace(/[\\%_*]/g, "\\$&");
}

// A pattern safe to interpolate into a PostgREST `or=(...)` filter. That
// grammar separates conditions on commas and delimits groups with parentheses,
// so a term containing either would restructure the filter rather than be
// matched by it. Double-quoting takes the value out of the grammar; inside the
// quotes only `"` and `\` need escaping — which means the backslashes
// escapeLikeTerm just added have to survive this second pass, hence the
// double-escape.
function orLikePattern(escapedTerm) {
  return `"%${escapedTerm.replace(/["\\]/g, "\\$&")}%"`;
}

// Drop empty keys so `meta` carries only what a given type actually has.
function compactMeta(fields) {
  const out = {};
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

// ── Destinations ──────────────────────────────────────────────────────
// Only routes that exist and read what we put in the URL. The three surfaces
// are separated by middleware.ts on user_type, so the same entity points
// somewhere different depending on who is asking; nothing here branches on
// ROLE, only on which dashboard the caller is allowed to enter.
//
// A previous phase shipped `?task=` and `?project=` links that no component
// ever read. Nothing below is invented: /admin/project-details/[projectId] and
// /developer/project-details (which re-fetches from `?id=`) are real page
// files, and every ?section= value appears in the switch of the dashboard it
// belongs to.
function projectHref(auth, projectId) {
  if (!projectId) return null;
  if (auth.userType === "client") {
    return `/client?section=projects&projectId=${projectId}`;
  }
  if (auth.userType === "admin") return `/admin/project-details/${projectId}`;
  return `/developer/project-details?id=${projectId}`;
}

// /admin/* is gated to user_type 'admin' by middleware, so pointing anyone else
// at an admin section is a redirect to /login — not a destination.
function adminSectionHref(auth, section) {
  return auth.userType === "admin" ? `/admin/dashboard?section=${section}` : null;
}

// The staff dashboard's own people view, for callers who live on /developer.
function staffTeamHref(auth) {
  return auth.userType === "developer" ? "/developer/dashboard?section=team" : null;
}

// Nothing about the search should be able to take the whole response down: a
// missing table or a policy that rejects outright would otherwise blank out
// seven healthy result sets. A failed type comes back empty and loud in the log.
async function runSearch(label, query) {
  const { data, error } = await query;
  if (error) {
    console.error(`[search] ${label} error:`, error);
    return [];
  }
  return data || [];
}

const EMPTY_ROWS = Promise.resolve([]);

// Index rows by id for the in-memory join that replaces per-row lookups.
function byId(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}

function uniqueIds(...idLists) {
  const set = new Set();
  for (const list of idLists) {
    for (const id of list || []) if (id) set.add(id);
  }
  return [...set];
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const term = (searchParams.get("q") || "").trim();

    // Short-circuit BEFORE any search query is built. A search box fires on
    // every keystroke and a one-character term matches most of the org, so the
    // first useful term is two characters. The guard sits after the auth check
    // so an anonymous caller still gets 401 rather than a cheerful empty body.
    if (term.length < MIN_TERM_LENGTH) {
      return NextResponse.json({
        success: true,
        query: term,
        results: {},
        totals: {},
        truncated: false,
      });
    }

    const requestedLimit = Number.parseInt(searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // One row past the limit is what tells us there was more without paying for
    // a count query on every keystroke.
    const fetchLimit = limit + 1;

    const allowedTypes = auth.userType === "client" ? CLIENT_TYPES : STAFF_TYPES;
    const requestedTypes = (searchParams.get("types") || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const wantedTypes = requestedTypes.length
      ? allowedTypes.filter((t) => requestedTypes.includes(t))
      : allowedTypes;
    const wanted = new Set(wantedTypes);
    const want = (type) => wanted.has(type);

    const escaped = escapeLikeTerm(term);
    const like = `%${escaped}%`;
    const orLike = orLikePattern(escaped);

    const db = orgScopedClient(auth.token);

    // ── Pass 1: the searches ────────────────────────────────────────────
    // Every builder is handed to runSearch synchronously, so all ten requests
    // are already in flight by the time Promise.all is awaited. Nothing in this
    // route ever issues a query from inside a loop over rows.
    const [
      projectRows,
      taskRows,
      developerMatches,
      adminMatches,
      membershipEmailMatches,
      teamRows,
      clientRows,
      sprintRows,
      epicRows,
      commentRows,
    ] = await Promise.all([
      want("project")
        ? runSearch(
            "projects",
            db
              .from("projects")
              .select("id, name, status, deadline")
              .ilike("name", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("task")
        ? runSearch(
            "tasks",
            db
              .from("developer_tasks")
              .select("id, task_title, status, priority, project_id, developer_id")
              .ilike("task_title", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      // An "employee" spans three tables: the two profile tables the org never
      // merged (admin_users, developers) and the memberships row that carries
      // their role and team. Names live in the profiles, so a name match starts
      // there; an email match can come from either the profile or the
      // membership, and the union is deduplicated below.
      want("employee")
        ? runSearch(
            "developers",
            db
              .from("developers")
              .select("id, name, email")
              .or(`name.ilike.${orLike},email.ilike.${orLike}`)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("employee")
        ? runSearch(
            "admin_users",
            db
              .from("admin_users")
              .select("id, full_name, email")
              .or(`full_name.ilike.${orLike},email.ilike.${orLike}`)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("employee")
        ? runSearch(
            "memberships",
            db
              .from("memberships")
              .select("id, user_id, user_type, email, role, team_id")
              .neq("user_type", "client")
              .ilike("email", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("team")
        ? runSearch(
            "teams",
            db
              .from("teams")
              .select("id, name, department_id")
              .ilike("name", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("client")
        ? runSearch(
            "clients",
            db
              .from("clients")
              .select("id, name, company, status")
              .or(`name.ilike.${orLike},company.ilike.${orLike}`)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("sprint")
        ? runSearch(
            "sprints",
            db
              .from("sprints")
              .select("id, name, status, project_id")
              .ilike("name", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      want("epic")
        ? runSearch(
            "epics",
            db
              .from("epics")
              .select("id, name, project_id")
              .ilike("name", like)
              .limit(fetchLimit)
          )
        : EMPTY_ROWS,

      // `internal = false` duplicates the client half of the RLS policy added
      // in 033. Kept because a client must never be one policy edit away from
      // reading the team talking about them.
      want("comment")
        ? runSearch(
            "task_comments",
            (() => {
              let q = db
                .from("task_comments")
                .select("id, body, author_name, task_id")
                .ilike("body", like);
              if (auth.userType === "client") q = q.eq("internal", false);
              return q.limit(fetchLimit);
            })()
          )
        : EMPTY_ROWS,
    ]);

    // ── Pass 2: batched name resolution ─────────────────────────────────
    // Project names, assignee names and comment task titles are all looked up
    // by collecting the referenced ids off the hits and issuing ONE query per
    // referenced table — never one query per row.
    const employeeCandidates = [];
    const seenCandidates = new Set();
    const addCandidate = (userType, userId) => {
      if (!userId) return;
      const key = `${userType}:${userId}`;
      if (seenCandidates.has(key)) return;
      seenCandidates.add(key);
      employeeCandidates.push({ key, userType, userId });
    };
    for (const row of developerMatches) addCandidate("developer", row.id);
    for (const row of adminMatches) addCandidate("admin", row.id);
    for (const row of membershipEmailMatches) addCandidate(row.user_type, row.user_id);

    const candidateIds = employeeCandidates.map((c) => c.userId);
    // Profiles already in hand from the name/email search need no second fetch;
    // the ones reached only through a membership email match do.
    const knownDeveloperIds = new Set(developerMatches.map((r) => r.id));
    const knownAdminIds = new Set(adminMatches.map((r) => r.id));
    const missingDeveloperIds = employeeCandidates
      .filter((c) => c.userType === "developer" && !knownDeveloperIds.has(c.userId))
      .map((c) => c.userId);
    const missingAdminIds = employeeCandidates
      .filter((c) => c.userType === "admin" && !knownAdminIds.has(c.userId))
      .map((c) => c.userId);

    const assigneeIds = uniqueIds(
      taskRows.map((t) => t.developer_id),
      missingDeveloperIds
    );
    const referencedProjectIds = uniqueIds(
      taskRows.map((t) => t.project_id),
      sprintRows.map((s) => s.project_id),
      epicRows.map((e) => e.project_id)
    );
    const commentTaskIds = uniqueIds(commentRows.map((c) => c.task_id));
    const departmentIds = uniqueIds(teamRows.map((t) => t.department_id));

    const [
      projectNameRows,
      assigneeRows,
      adminProfileRows,
      membershipRows,
      commentTaskRows,
      departmentRows,
    ] = await Promise.all([
      referencedProjectIds.length
        ? runSearch(
            "project names",
            db.from("projects").select("id, name").in("id", referencedProjectIds)
          )
        : EMPTY_ROWS,

      assigneeIds.length
        ? runSearch(
            "assignee names",
            db.from("developers").select("id, name, email").in("id", assigneeIds)
          )
        : EMPTY_ROWS,

      missingAdminIds.length
        ? runSearch(
            "admin profiles",
            db.from("admin_users").select("id, full_name, email").in("id", missingAdminIds)
          )
        : EMPTY_ROWS,

      candidateIds.length
        ? runSearch(
            "membership roles",
            db
              .from("memberships")
              .select("id, user_id, user_type, email, role, team_id")
              .neq("user_type", "client")
              .in("user_id", candidateIds)
          )
        : EMPTY_ROWS,

      commentTaskIds.length
        ? runSearch(
            "comment tasks",
            db
              .from("developer_tasks")
              .select("id, task_title, project_id")
              .in("id", commentTaskIds)
          )
        : EMPTY_ROWS,

      departmentIds.length
        ? runSearch(
            "departments",
            db.from("departments").select("id, name").in("id", departmentIds)
          )
        : EMPTY_ROWS,
    ]);

    const projectNames = byId(projectNameRows);
    const assignees = byId(assigneeRows);
    const commentTasks = byId(commentTaskRows);
    const departments = byId(departmentRows);
    const developerProfiles = byId(developerMatches);
    const adminProfiles = byId([...adminMatches, ...adminProfileRows]);

    // memberships keyed the way the two profile tables force us to: by the pair
    // (user_type, user_id), because an admin id and a developer id are drawn
    // from different tables and could collide in principle.
    const memberships = new Map();
    for (const row of [...membershipEmailMatches, ...membershipRows]) {
      const key = `${row.user_type}:${row.user_id}`;
      if (!memberships.has(key)) memberships.set(key, row);
    }

    // ── Pass 3: team names ──────────────────────────────────────────────
    // The only lookup that cannot join pass 2 — the team ids live on the
    // membership rows pass 2 fetched. Still one query for the whole result set.
    const employeeTeamIds = uniqueIds(
      employeeCandidates
        .map((c) => memberships.get(c.key)?.team_id)
        .filter(Boolean)
    );
    const employeeTeamRows = employeeTeamIds.length
      ? await runSearch(
          "employee teams",
          db.from("teams").select("id, name").in("id", employeeTeamIds)
        )
      : [];
    const employeeTeams = byId(employeeTeamRows);

    // ── Shape the hits ──────────────────────────────────────────────────
    // subtitle is the parent context (a task's project, an employee's team, a
    // comment's task); meta carries the structured badges. A project has no
    // parent and its deadline is not one of the named meta keys, so it rides in
    // the free-form `label`.
    const results = {};
    const totals = {};
    let truncated = false;

    const collect = (type, rows, toHit) => {
      if (!want(type)) return;
      if (rows.length > limit) truncated = true;
      const hits = rows.slice(0, limit).map(toHit);
      results[type] = hits;
      totals[type] = hits.length;
    };

    collect("project", projectRows, (p) => ({
      id: p.id,
      type: "project",
      title: p.name,
      subtitle: null,
      meta: compactMeta({ status: p.status, label: p.deadline }),
      href: projectHref(auth, p.id),
    }));

    collect("task", taskRows, (t) => {
      const projectName = projectNames.get(t.project_id)?.name || null;
      return {
        id: t.id,
        type: "task",
        title: t.task_title,
        subtitle: projectName,
        meta: compactMeta({
          status: t.status,
          priority: t.priority,
          assignee_name: assignees.get(t.developer_id)?.name || null,
          project_name: projectName,
        }),
        // No route anywhere reads a task id, so the honest destination is the
        // project that contains the task.
        href: projectHref(auth, t.project_id),
      };
    });

    collect("employee", employeeCandidates, (candidate) => {
      const membership = memberships.get(candidate.key) || null;
      const profile =
        candidate.userType === "admin"
          ? adminProfiles.get(candidate.userId) || null
          : developerProfiles.get(candidate.userId) ||
            assignees.get(candidate.userId) ||
            null;
      const name = profile ? profile.full_name || profile.name : null;
      const teamName = membership?.team_id
        ? employeeTeams.get(membership.team_id)?.name || null
        : null;
      return {
        id: candidate.userId,
        type: "employee",
        // Falling back to the address keeps a hit from rendering as a blank row
        // when a profile row is gone but the membership survives.
        title: name || profile?.email || membership?.email || "Unknown",
        subtitle: teamName,
        meta: compactMeta({ label: membership?.role }),
        href: adminSectionHref(auth, "employees") || staffTeamHref(auth),
      };
    });

    collect("team", teamRows, (t) => ({
      id: t.id,
      type: "team",
      title: t.name,
      subtitle: departments.get(t.department_id)?.name || null,
      meta: compactMeta({}),
      // Teams are created and edited in OrganizationManagement.
      href: adminSectionHref(auth, "organization") || staffTeamHref(auth),
    }));

    collect("client", clientRows, (c) => ({
      id: c.id,
      type: "client",
      title: c.name || c.company,
      subtitle: c.company || null,
      meta: compactMeta({ status: c.status }),
      href: adminSectionHref(auth, "clients"),
    }));

    collect("sprint", sprintRows, (s) => {
      const projectName = projectNames.get(s.project_id)?.name || null;
      return {
        id: s.id,
        type: "sprint",
        title: s.name,
        subtitle: projectName,
        meta: compactMeta({ status: s.status, project_name: projectName }),
        // Sprints and epics are both planned in AgileWorkspace.
        href: adminSectionHref(auth, "sprints"),
      };
    });

    collect("epic", epicRows, (e) => {
      const projectName = projectNames.get(e.project_id)?.name || null;
      return {
        id: e.id,
        type: "epic",
        title: e.name,
        subtitle: projectName,
        meta: compactMeta({ project_name: projectName }),
        href: adminSectionHref(auth, "sprints"),
      };
    });

    collect("comment", commentRows, (c) => {
      const task = commentTasks.get(c.task_id) || null;
      return {
        id: c.id,
        type: "comment",
        title: c.body,
        subtitle: task?.task_title || null,
        meta: compactMeta({ label: c.author_name }),
        // Same reasoning as a task hit: comments have no route of their own, so
        // the destination is the project the commented-on task belongs to.
        href: projectHref(auth, task?.project_id),
      };
    });

    return NextResponse.json({
      success: true,
      query: term,
      results,
      totals,
      truncated,
    });
  } catch (err) {
    console.error("[search] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
