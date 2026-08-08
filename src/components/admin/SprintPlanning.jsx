"use client";

import { useMemo, useState } from "react";
import {
  saveSprint,
  saveEpic,
  assignTaskToSprint,
  setTaskEpic,
  setTaskType,
  setStoryPoints,
  setSprintStatus,
  createTask,
  PRIORITIES,
  TASK_TYPES,
  SPRINT_STATUS,
} from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import { Badge, Button, EmptyState, Input, Tabs } from "@/components/ui";
import { SELECT_CLASS } from "@/components/admin/views/viewKit";
import {
  Layers,
  Flag,
  Plus,
  Play,
  CheckCircle2,
  Trash2,
  Pencil,
  X,
  Rocket,
  ListChecks,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Shared style tokens                                                        */
/* -------------------------------------------------------------------------- */

const PANEL_CLASS = "rounded-xl border border-border bg-card p-4 shadow-card sm:p-5";
const TEXTAREA_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
// Compact control used inside the dense task rows.
const ROW_SELECT_CLASS = `${SELECT_CLASS} h-8 px-2 text-xs`;

// Every chip on this screen is a UI-kit Badge; these maps only choose a variant.
const PRIORITY_VARIANT = {
  low: "outline",
  medium: "info",
  high: "warning",
  urgent: "destructive",
};

const SPRINT_STATUS_VARIANT = {
  planned: "secondary",
  active: "info",
  completed: "success",
};

const EPIC_STATUS_VARIANT = {
  open: "secondary",
  in_progress: "info",
  done: "success",
};

const TYPE_VARIANT = {
  feature: "info",
  bug: "destructive",
  improvement: "success",
  research: "warning",
  documentation: "secondary",
  story: "default",
};

// The colours an epic or label can be given. These are values written to the
// database as the user's own choice of colour, not app chrome, which is why
// they are literal here and nowhere else.
const COLOR_SWATCHES = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

const TABS = [
  { id: "sprints", label: "Sprints", icon: Rocket },
  { id: "epics", label: "Epics", icon: Layers },
  { id: "backlog", label: "Backlog", icon: ListChecks },
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function labelize(value) {
  if (!value) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
}

function dateRange(start, end) {
  if (!start && !end) return "No dates";
  return `${formatDate(start) || "?"} – ${formatDate(end) || "?"}`;
}

function sumPoints(tasks) {
  return tasks.reduce((acc, t) => acc + (Number(t.story_points) || 0), 0);
}

const NEXT_SPRINT_STATUS = { planned: "active", active: "completed" };

/* -------------------------------------------------------------------------- */
/*  Compact task row (shared by sprint + backlog lists)                        */
/* -------------------------------------------------------------------------- */

function TaskRow({
  task,
  epics,
  sprints,
  employees,
  variant, // "sprint" | "backlog"
  busy,
  onMutate,
}) {
  const assignee = useMemo(
    () => employees.find((e) => e.userId === task.developer_id),
    [employees, task.developer_id]
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <span className="min-w-[8rem] flex-1 truncate text-sm text-foreground" title={task.task_title}>
        {task.task_title}
      </span>

      {/* task type — badge in sprints, editable select in backlog */}
      {variant === "backlog" ? (
        <select
          aria-label="Task type"
          className={ROW_SELECT_CLASS}
          value={task.task_type || "feature"}
          disabled={busy}
          onChange={(e) =>
            onMutate(() => setTaskType(task.id, e.target.value))
          }
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {labelize(t)}
            </option>
          ))}
        </select>
      ) : (
        task.task_type && (
          <Badge variant={TYPE_VARIANT[task.task_type] || "secondary"} size="sm">
            {labelize(task.task_type)}
          </Badge>
        )
      )}

      {task.priority && (
        <Badge variant={PRIORITY_VARIANT[task.priority] || "secondary"} size="sm">
          {labelize(task.priority)}
        </Badge>
      )}

      {/* story points inline input */}
      <input
        type="number"
        min="0"
        aria-label="Story points"
        title="Story points"
        className={`${ROW_SELECT_CLASS} w-16 tabular-nums`}
        defaultValue={task.story_points ?? ""}
        disabled={busy}
        onBlur={(e) => {
          const raw = e.target.value;
          const next = raw === "" ? "" : Number(raw);
          const current = task.story_points ?? "";
          if (String(next) === String(current)) return;
          onMutate(() => setStoryPoints(task.id, next));
        }}
      />

      {/* epic select */}
      <select
        aria-label="Epic"
        className={ROW_SELECT_CLASS}
        value={task.epic_id || ""}
        disabled={busy}
        onChange={(e) =>
          onMutate(() => setTaskEpic(task.id, e.target.value || null))
        }
      >
        <option value="">No epic</option>
        {epics.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.name}
          </option>
        ))}
      </select>

      <span className="min-w-[5rem] truncate text-xs text-muted-foreground">
        {assignee ? assignee.name : "Unassigned"}
      </span>

      {/* sprint control */}
      {variant === "backlog" ? (
        <select
          aria-label="Add to sprint"
          className={ROW_SELECT_CLASS}
          value=""
          disabled={busy || sprints.length === 0}
          onChange={(e) => {
            if (!e.target.value) return;
            onMutate(() => assignTaskToSprint(task.id, e.target.value));
          }}
        >
          <option value="">Add to sprint…</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          title="Remove from sprint"
          onClick={() => onMutate(() => assignTaskToSprint(task.id, null))}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Epic form                                                                   */
/* -------------------------------------------------------------------------- */

function EpicForm({ initial, busy, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [color, setColor] = useState(initial?.color || COLOR_SWATCHES[0]);
  const [status, setStatus] = useState(initial?.status || "open");

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      ...(initial?.id ? { id: initial.id } : {}),
      name: trimmed,
      description: description.trim(),
      color,
      status,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="flex flex-wrap gap-3">
        <Input
          className="flex-1"
          placeholder="Epic name"
          aria-label="Epic name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <select
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Epic status"
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </div>
      <textarea
        className={`${TEXTAREA_CLASS} min-h-[60px] resize-y`}
        placeholder="Description (optional)"
        aria-label="Epic description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Colour</span>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            className={`h-6 w-6 rounded-full border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              color === c ? "border-foreground" : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <CheckCircle2 aria-hidden="true" />
          {initial?.id ? "Save epic" : "Create epic"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sprint form                                                                 */
/* -------------------------------------------------------------------------- */

function SprintForm({ initial, sortOrder, busy, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [goal, setGoal] = useState(initial?.goal || "");
  const [startDate, setStartDate] = useState(initial?.start_date || "");
  const [endDate, setEndDate] = useState(initial?.end_date || "");
  const [status, setStatus] = useState(initial?.status || "planned");

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      ...(initial?.id ? { id: initial.id } : {}),
      name: trimmed,
      goal: goal.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      status,
      sort_order: initial?.sort_order ?? sortOrder,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="flex flex-wrap gap-3">
        <Input
          className="flex-1"
          placeholder="Sprint name"
          aria-label="Sprint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <select
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Sprint status"
        >
          {SPRINT_STATUS.map((s) => (
            <option key={s} value={s}>
              {labelize(s)}
            </option>
          ))}
        </select>
      </div>
      <Input
        placeholder="Sprint goal (optional)"
        aria-label="Sprint goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Start date
          <Input
            type="date"
            value={startDate || ""}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          End date
          <Input
            type="date"
            value={endDate || ""}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <CheckCircle2 aria-hidden="true" />
          {initial?.id ? "Save sprint" : "Create sprint"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function SprintPlanning({
  projectId,
  sprints = [],
  epics = [],
  tasks = [],
  employees = [],
  onChanged,
}) {
  const [tab, setTab] = useState("sprints");
  const [busy, setBusy] = useState(false);

  // form / editor state
  const [epicFormOpen, setEpicFormOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState(null);
  const [sprintFormOpen, setSprintFormOpen] = useState(false);
  const [editingSprint, setEditingSprint] = useState(null);
  const [newBacklogTitle, setNewBacklogTitle] = useState("");

  /* ---- derived data ---- */
  const tasksBySprint = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.sprint_id) continue;
      if (!map.has(t.sprint_id)) map.set(t.sprint_id, []);
      map.get(t.sprint_id).push(t);
    }
    return map;
  }, [tasks]);

  const backlog = useMemo(() => tasks.filter((t) => !t.sprint_id), [tasks]);

  const epicTaskCounts = useMemo(() => {
    const counts = new Map();
    for (const t of tasks) {
      if (!t.epic_id) continue;
      counts.set(t.epic_id, (counts.get(t.epic_id) || 0) + 1);
    }
    return counts;
  }, [tasks]);

  const orderedSprints = useMemo(
    () => [...sprints].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [sprints]
  );

  /* ---- mutation wrapper ---- */
  const runMutation = async (fn, errTitle = "Update failed") => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      if (result && result.error) {
        showError(errTitle, result.error.message);
        return;
      }
      if (onChanged) await onChanged();
    } catch (err) {
      showError(errTitle, err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- epic handlers ---- */
  const submitEpic = async (patch) => {
    await runMutation(() => saveEpic(projectId, patch), "Could not save epic");
    setEpicFormOpen(false);
    setEditingEpic(null);
  };

  /* ---- sprint handlers ---- */
  const submitSprint = async (patch) => {
    await runMutation(() => saveSprint(projectId, patch), "Could not save sprint");
    setSprintFormOpen(false);
    setEditingSprint(null);
  };

  const advanceSprint = (sprint) => {
    const next = NEXT_SPRINT_STATUS[sprint.status];
    if (!next) return;
    runMutation(() => setSprintStatus(sprint.id, next), "Could not update sprint status");
  };

  /* ---- backlog handlers ---- */
  const addBacklogTask = async () => {
    const title = newBacklogTitle.trim();
    if (!title) return;
    await runMutation(
      () => createTask(projectId, { task_title: title, status: "pending", task_type: "feature" }),
      "Could not create task"
    );
    setNewBacklogTitle("");
  };

  /* ------------------------------------------------------------------ */
  /*  Sections                                                           */
  /* ------------------------------------------------------------------ */

  const renderEpics = () => (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Epics
        </h3>
        {!epicFormOpen && (
          <Button
            size="sm"
            onClick={() => {
              setEditingEpic(null);
              setEpicFormOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New epic
          </Button>
        )}
      </div>

      {epicFormOpen && !editingEpic && (
        <EpicForm
          initial={null}
          busy={busy}
          onSubmit={submitEpic}
          onCancel={() => setEpicFormOpen(false)}
        />
      )}

      {epics.length === 0 && !epicFormOpen ? (
        <EmptyState
          icon={Layers}
          title="No epics yet"
          description="Create one to group related stories under a single theme."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {epics.map((epic) =>
            editingEpic && editingEpic.id === epic.id ? (
              <div key={epic.id} className="sm:col-span-2 lg:col-span-3">
                <EpicForm
                  initial={epic}
                  busy={busy}
                  onSubmit={submitEpic}
                  onCancel={() => setEditingEpic(null)}
                />
              </div>
            ) : (
              <div
                key={epic.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: epic.color || COLOR_SWATCHES[7] }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate text-sm font-semibold text-foreground">
                    {epic.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit epic ${epic.name}`}
                    title="Edit epic"
                    onClick={() => {
                      setEpicFormOpen(false);
                      setEditingEpic(epic);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </div>
                {epic.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{epic.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <Badge variant={EPIC_STATUS_VARIANT[epic.status] || "secondary"} size="sm">
                    {labelize(epic.status)}
                  </Badge>
                  <Badge variant="default" size="sm" className="tabular-nums">
                    {epicTaskCounts.get(epic.id) || 0} tasks
                  </Badge>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );

  const renderSprints = () => (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Rocket className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Sprints
        </h3>
        {!sprintFormOpen && (
          <Button
            size="sm"
            onClick={() => {
              setEditingSprint(null);
              setSprintFormOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New sprint
          </Button>
        )}
      </div>

      {sprintFormOpen && !editingSprint && (
        <SprintForm
          initial={null}
          sortOrder={orderedSprints.length}
          busy={busy}
          onSubmit={submitSprint}
          onCancel={() => setSprintFormOpen(false)}
        />
      )}

      {orderedSprints.length === 0 && !sprintFormOpen ? (
        <EmptyState
          icon={Rocket}
          title="No sprints yet"
          description="Plan one to start scheduling work into fixed-length iterations."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {orderedSprints.map((sprint) => {
            const sprintTasks = tasksBySprint.get(sprint.id) || [];
            const next = NEXT_SPRINT_STATUS[sprint.status];
            const isEditing = editingSprint && editingSprint.id === sprint.id;

            if (isEditing) {
              return (
                <SprintForm
                  key={sprint.id}
                  initial={sprint}
                  sortOrder={sprint.sort_order ?? 0}
                  busy={busy}
                  onSubmit={submitSprint}
                  onCancel={() => setEditingSprint(null)}
                />
              );
            }

            return (
              <div
                key={sprint.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
              >
                {/* header */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-sm font-semibold text-foreground">{sprint.name}</span>
                  <Badge variant={SPRINT_STATUS_VARIANT[sprint.status] || "secondary"} size="sm">
                    {labelize(sprint.status)}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {dateRange(sprint.start_date, sprint.end_date)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge variant="secondary" size="sm" className="tabular-nums">
                      {sprintTasks.length} tasks
                    </Badge>
                    <Badge variant="default" size="sm" className="tabular-nums" title="Story points">
                      {sumPoints(sprintTasks)} pts
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit sprint ${sprint.name}`}
                      title="Edit sprint"
                      onClick={() => {
                        setSprintFormOpen(false);
                        setEditingSprint(sprint);
                      }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {next && (
                      <Button size="sm" disabled={busy} onClick={() => advanceSprint(sprint)}>
                        {next === "active" ? (
                          <>
                            <Play aria-hidden="true" />
                            Start
                          </>
                        ) : (
                          <>
                            <CheckCircle2 aria-hidden="true" />
                            Complete
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {sprint.goal && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Flag className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {sprint.goal}
                  </p>
                )}

                {/* tasks */}
                {sprintTasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    No tasks in this sprint. Add some from the Backlog tab.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {sprintTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        epics={epics}
                        sprints={orderedSprints}
                        employees={employees}
                        variant="sprint"
                        busy={busy}
                        onMutate={runMutation}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderBacklog = () => (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Backlog
        </h3>
        <Badge variant="secondary" size="sm" className="tabular-nums">
          {backlog.length} tasks
        </Badge>
      </div>

      {/* quick add */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="flex-1"
          placeholder="New backlog task title…"
          aria-label="New backlog task title"
          value={newBacklogTitle}
          onChange={(e) => setNewBacklogTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addBacklogTask();
            }
          }}
        />
        <Button size="default" disabled={busy || !newBacklogTitle.trim()} onClick={addBacklogTask}>
          <Plus aria-hidden="true" />
          Add task
        </Button>
      </div>

      {backlog.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Backlog is empty"
          description="Everything is either in a sprint or not created yet. Add a task above to start filling it."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {backlog.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              epics={epics}
              sprints={orderedSprints}
              employees={employees}
              variant="backlog"
              busy={busy}
              onMutate={runMutation}
            />
          ))}
        </div>
      )}
    </section>
  );

  /* ------------------------------------------------------------------ */

  return (
    <div className={`${PANEL_CLASS} flex flex-col gap-5`}>
      <Tabs
        aria-label="Planning sections"
        active={tab}
        onChange={(id) => setTab(id)}
        tabs={TABS.map(({ id, label, icon: Icon }) => ({
          id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </span>
          ),
          count:
            id === "sprints"
              ? orderedSprints.length
              : id === "epics"
              ? epics.length
              : backlog.length,
        }))}
      />

      {tab === "sprints" && renderSprints()}
      {tab === "epics" && renderEpics()}
      {tab === "backlog" && renderBacklog()}
    </div>
  );
}
