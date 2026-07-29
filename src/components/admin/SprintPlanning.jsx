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
/*  Shared style tokens (match the existing design system)                     */
/* -------------------------------------------------------------------------- */

const PANEL_CLASS = "rounded-xl border border-border bg-card p-5 shadow-card";
const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const BTN_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-60";
const BADGE_BASE = "rounded-full px-2 py-0.5 text-[10px] font-semibold";
const EMPTY_BOX =
  "rounded-lg border border-dashed border-border bg-background/50 px-4 py-6 text-center text-sm text-muted-foreground";

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
};

const SPRINT_STATUS_STYLES = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
};

const EPIC_STATUS_STYLES = {
  open: "bg-muted text-muted-foreground",
  in_progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
};

const TYPE_STYLES = {
  feature: "bg-info/15 text-info",
  bug: "bg-destructive/15 text-destructive",
  improvement: "bg-success/15 text-success",
  research: "bg-warning/15 text-warning",
  documentation: "bg-muted text-muted-foreground",
  story: "bg-primary/10 text-primary",
};

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
  return `${formatDate(start) || "?"} - ${formatDate(end) || "?"}`;
}

function sumPoints(tasks) {
  return tasks.reduce((acc, t) => acc + (Number(t.story_points) || 0), 0);
}

const NEXT_SPRINT_STATUS = { planned: "active", active: "completed" };

/* -------------------------------------------------------------------------- */
/*  Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function Badge({ className = "", children }) {
  return <span className={`${BADGE_BASE} ${className}`}>{children}</span>;
}

function PointsChip({ children }) {
  return (
    <span
      className={`${BADGE_BASE} bg-primary/10 tabular-nums text-primary`}
      title="Story points"
    >
      {children}
    </span>
  );
}

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
          className={`${INPUT_CLASS} !py-1 text-xs`}
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
          <Badge className={TYPE_STYLES[task.task_type] || "bg-muted text-muted-foreground"}>
            {labelize(task.task_type)}
          </Badge>
        )
      )}

      {task.priority && (
        <Badge className={PRIORITY_STYLES[task.priority] || "bg-muted text-muted-foreground"}>
          {labelize(task.priority)}
        </Badge>
      )}

      {/* story points inline input */}
      <input
        type="number"
        min="0"
        aria-label="Story points"
        title="Story points"
        className={`${INPUT_CLASS} !py-1 w-16 tabular-nums text-xs`}
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
        className={`${INPUT_CLASS} !py-1 text-xs`}
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
          className={`${INPUT_CLASS} !py-1 text-xs`}
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
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-60"
          disabled={busy}
          title="Remove from sprint"
          onClick={() => onMutate(() => assignTaskToSprint(task.id, null))}
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
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
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder="Epic name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <select
          className={INPUT_CLASS}
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
        className={`${INPUT_CLASS} min-h-[60px] resize-y`}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Color</span>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            className={`h-6 w-6 rounded-full border-2 transition ${
              color === c ? "border-foreground" : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !name.trim()}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {initial?.id ? "Save epic" : "Create epic"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
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
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder="Sprint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <select
          className={INPUT_CLASS}
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
      <input
        className={INPUT_CLASS}
        placeholder="Sprint goal (optional)"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Start date
          <input
            type="date"
            className={INPUT_CLASS}
            value={startDate || ""}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          End date
          <input
            type="date"
            className={INPUT_CLASS}
            value={endDate || ""}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !name.trim()}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {initial?.id ? "Save sprint" : "Create sprint"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
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
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-primary" />
          Epics
        </h3>
        {!epicFormOpen && (
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              setEditingEpic(null);
              setEpicFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New epic
          </button>
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
        <div className={EMPTY_BOX}>No epics yet. Create one to group related stories.</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {epics.map((epic) =>
            editingEpic && editingEpic.id === epic.id ? (
              <div key={epic.id} className="w-full">
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
                className="flex min-w-[13rem] flex-col gap-2 rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: epic.color || "#64748b" }}
                  />
                  <span className="flex-1 truncate text-sm font-semibold text-foreground">
                    {epic.name}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary"
                    title="Edit epic"
                    onClick={() => {
                      setEpicFormOpen(false);
                      setEditingEpic(epic);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                {epic.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{epic.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <Badge className={EPIC_STATUS_STYLES[epic.status] || "bg-muted text-muted-foreground"}>
                    {labelize(epic.status)}
                  </Badge>
                  <Badge className="bg-primary/10 tabular-nums text-primary">
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
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Rocket className="h-4 w-4 text-primary" />
          Sprints
        </h3>
        {!sprintFormOpen && (
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              setEditingSprint(null);
              setSprintFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New sprint
          </button>
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
        <div className={EMPTY_BOX}>No sprints yet. Plan one to start scheduling work.</div>
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
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">{sprint.name}</span>
                  <Badge
                    className={SPRINT_STATUS_STYLES[sprint.status] || "bg-muted text-muted-foreground"}
                  >
                    {labelize(sprint.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {dateRange(sprint.start_date, sprint.end_date)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge className="bg-muted tabular-nums text-muted-foreground">
                      {sprintTasks.length} tasks
                    </Badge>
                    <PointsChip>{sumPoints(sprintTasks)} pts</PointsChip>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-primary"
                      title="Edit sprint"
                      onClick={() => {
                        setSprintFormOpen(false);
                        setEditingSprint(sprint);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {next && (
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={busy}
                        onClick={() => advanceSprint(sprint)}
                      >
                        {next === "active" ? (
                          <>
                            <Play className="h-3.5 w-3.5" />
                            Start
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Complete
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {sprint.goal && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Flag className="h-3 w-3" />
                    {sprint.goal}
                  </p>
                )}

                {/* tasks */}
                {sprintTasks.length === 0 ? (
                  <div className={EMPTY_BOX}>No tasks in this sprint. Add some from the backlog.</div>
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
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks className="h-4 w-4 text-primary" />
          Backlog
        </h3>
        <Badge className="bg-muted tabular-nums text-muted-foreground">
          {backlog.length} tasks
        </Badge>
      </div>

      {/* quick add */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder="New backlog task title…"
          value={newBacklogTitle}
          onChange={(e) => setNewBacklogTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addBacklogTask();
            }
          }}
        />
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy || !newBacklogTitle.trim()}
          onClick={addBacklogTask}
        >
          <Plus className="h-3.5 w-3.5" />
          Add task
        </button>
      </div>

      {backlog.length === 0 ? (
        <div className={EMPTY_BOX}>Backlog is empty.</div>
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
      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "sprints" && renderSprints()}
      {tab === "epics" && renderEpics()}
      {tab === "backlog" && renderBacklog()}
    </div>
  );
}
