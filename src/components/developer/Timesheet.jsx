"use client";
import { useState, useEffect } from "react";
import { ListChecks } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import {
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonTable,
  StatusPill,
  Tabs,
} from "@/components/ui";

/** Deadline chips map onto StatusPill statuses so state is never colour alone. */
const DEADLINE_TONE = {
  overdue: "error",
  soon: "warning",
  ok: "success",
  onTime: "success",
  late: "error",
};

/**
 * Productivity score, as the footer describes it:
 * (on-time − late) ÷ total tasks × 100 + 50, expressed as a percentage.
 *
 * The +50 baseline means an all-on-time developer scores 150 before clamping,
 * so the card used to show "150%" — a percentage that cannot exist. The bottom
 * was already clamped at 0; the top is now clamped at 100 to match, so the
 * number stays inside the range the label claims for it.
 */
export function productivityPercent(onTimeTasks, lateTasks, totalTasks) {
  if (!(totalTasks > 0)) return 0;
  const raw = ((onTimeTasks - lateTasks) / totalTasks) * 100 + 50;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

const STATUS_PILL = {
  pending: { status: "pending", label: "Pending" },
  in_progress: { status: "active", label: "In progress" },
  awaiting_approval: { status: "pending", label: "Awaiting review" },
  completed: { status: "success", label: "Completed" },
  rejected: { status: "error", label: "Rejected" },
};

export default function Timesheet({ user }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // all, completed, pending, rejected
  const [developerId, setDeveloperId] = useState(null);

  useEffect(() => {
    const resolveDevId = async () => {
      // Try to get developer record by email from localStorage user
      if (user?.email) {
        const { data: dev } = await supabase
          .from("developers")
          .select("id")
          .eq("email", user.email)
          .single();
        if (dev?.id) {
          setDeveloperId(dev.id);
          return;
        }
      }
      // Fallback to user id
      if (user?.id) setDeveloperId(user.id);
    };
    if (user) resolveDevId();
  }, [user]);

  useEffect(() => {
    if (developerId) fetchTasks();
  }, [developerId]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError("");
      const { data, error } = await supabase
        .from("developer_tasks")
        .select(`
          *,
          projects (
            id,
            name,
            deadline
          )
        `)
        .eq("developer_id", developerId)
        .order("task_order", { ascending: true });

      if (error) throw error;
      setTasks(data || []);
    } catch (err) {
      console.error("Failed to load timesheet:", err);
      setError(err?.message || "Could not load your timesheet.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getDeadlineStatus = (task) => {
    if (task.status !== "completed") {
      const today = new Date();
      const end = task.end_date ? new Date(task.end_date) : null;
      if (!end) return null;
      const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) return { label: "Overdue", tone: DEADLINE_TONE.overdue };
      if (daysLeft <= 3) return { label: `${daysLeft}d left`, tone: DEADLINE_TONE.soon };
      return { label: `${daysLeft}d left`, tone: DEADLINE_TONE.ok };
    }
    if (task.is_on_time === true) return { label: "On time", tone: DEADLINE_TONE.onTime };
    if (task.is_on_time === false) return { label: "Late", tone: DEADLINE_TONE.late };
    return null;
  };

  const getStatusPill = (status) => STATUS_PILL[status] || { status: "unknown", label: status || "Unknown" };

  const filteredTasks = tasks.filter((t) => {
    if (filter === "all") return true;
    if (filter === "completed") return t.status === "completed";
    if (filter === "pending") return ["pending", "in_progress", "awaiting_approval"].includes(t.status);
    if (filter === "rejected") return t.status === "rejected";
    return true;
  });

  // Productivity stats
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const onTimeTasks = completedTasks.filter((t) => t.is_on_time === true).length;
  const lateTasks = completedTasks.filter((t) => t.is_on_time === false).length;
  const totalTasks = tasks.length;
  const productivityPct = productivityPercent(onTimeTasks, lateTasks, totalTasks);
  const totalPoints = onTimeTasks - lateTasks;

  // Written out in full — Tailwind only ships classes it can see as literals.
  const productivityToneClass =
    productivityPct >= 80
      ? "text-success"
      : productivityPct >= 50
      ? "text-warning"
      : "text-destructive";

  const tabs = [
    { id: "all", label: "All", count: tasks.length },
    {
      id: "pending",
      label: "Active",
      count: tasks.filter((t) => ["pending", "in_progress", "awaiting_approval"].includes(t.status)).length,
    },
    { id: "completed", label: "Completed", count: completedTasks.length },
    { id: "rejected", label: "Rejected", count: tasks.filter((t) => t.status === "rejected").length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">My timesheet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Task completion, deadlines and your productivity score.
        </p>
      </div>

      {/* Summary tiles — figures are tabular so the four numbers align. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
              <div className="text-3xl font-semibold tabular-nums text-foreground">{totalTasks}</div>
              <div className="mt-1 text-sm text-muted-foreground">Total tasks</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
              <div className="text-3xl font-semibold tabular-nums text-success">{onTimeTasks}</div>
              <div className="mt-1 text-sm text-muted-foreground">On time</div>
              <div className="text-xs tabular-nums text-muted-foreground">+{onTimeTasks} pts</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
              <div className="text-3xl font-semibold tabular-nums text-destructive">{lateTasks}</div>
              <div className="mt-1 text-sm text-muted-foreground">Late</div>
              <div className="text-xs tabular-nums text-muted-foreground">−{lateTasks} pts</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
              <div className={`text-3xl font-semibold tabular-nums ${productivityToneClass}`}>
                {productivityPct}%
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Productivity</div>
              <div className="text-xs tabular-nums text-muted-foreground">
                Points: {totalPoints >= 0 ? `+${totalPoints}` : totalPoints}
              </div>
            </div>
          </>
        )}
      </div>

      <Tabs tabs={tabs} active={filter} onChange={setFilter} aria-label="Filter timesheet by status" />

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-card" aria-busy="true">
          <SkeletonTable rows={6} cols={6} />
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load your timesheet" description={error} onRetry={fetchTasks} />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filter === "all" ? "No tasks yet" : "Nothing in this view"}
          description={
            filter === "all"
              ? "Tasks assigned to you will show up here with their deadlines and points."
              : "Try another tab — you have tasks in other states."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-border text-sm">
              <thead>
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 text-right">#</th>
                  <th scope="col" className="px-4 py-3 text-left">Task</th>
                  <th scope="col" className="px-4 py-3 text-left">Project</th>
                  <th scope="col" className="px-4 py-3 text-left">Start</th>
                  <th scope="col" className="px-4 py-3 text-left">Deadline</th>
                  <th scope="col" className="px-4 py-3 text-left">Completed</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-left">Deadline status</th>
                  <th scope="col" className="px-4 py-3 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.map((task, i) => {
                  const pill = getStatusPill(task.status);
                  const deadline = getDeadlineStatus(task);
                  return (
                    <tr key={task.id} className="h-12 transition-colors duration-150 hover:bg-muted/40">
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[28rem] break-words font-medium text-foreground">
                          {task.task_title}
                        </div>
                        {task.rejection_reason && (
                          <div className="mt-1 text-xs text-destructive">
                            Rejected: {task.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="block max-w-[14rem] truncate" title={task.projects?.name || undefined}>
                          {task.projects?.name || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {formatDate(task.start_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {formatDate(task.end_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {task.actual_completion_date
                          ? formatDate(task.actual_completion_date)
                          : task.submitted_at
                          ? formatDate(task.submitted_at)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={pill.status} label={pill.label} size="sm" />
                      </td>
                      <td className="px-4 py-3">
                        {deadline ? (
                          <StatusPill status={deadline.tone} label={deadline.label} size="sm" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {task.status === "completed" ? (
                          <span
                            className={`font-semibold tabular-nums ${
                              task.is_on_time ? "text-success" : "text-destructive"
                            }`}
                          >
                            {task.is_on_time ? "+1" : "−1"}
                          </span>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* How the score is calculated — quiet, not another alert box. */}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Productivity formula:</span>{" "}
        (on-time tasks − late tasks) ÷ total tasks × 100 + 50%, held within 0–100%. On-time completion is{" "}
        <Badge variant="success" size="sm">+1</Badge> point, late completion is{" "}
        <Badge variant="destructive" size="sm">−1</Badge>.
      </p>
    </div>
  );
}
