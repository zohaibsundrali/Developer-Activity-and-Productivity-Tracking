"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";

export default function Timesheet({ user }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
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
      if (daysLeft < 0) return { label: "Overdue", color: "text-destructive bg-destructive/10 border-destructive/20" };
      if (daysLeft <= 3) return { label: `${daysLeft}d left`, color: "text-warning bg-warning/10 border-warning/20" };
      return { label: `${daysLeft}d left`, color: "text-success bg-success/10 border-success/20" };
    }
    if (task.is_on_time === true) return { label: "On Time", color: "text-success bg-success/10 border-success/20" };
    if (task.is_on_time === false) return { label: "Late", color: "text-destructive bg-destructive/10 border-destructive/20" };
    return null;
  };

  const getStatusBadge = (status) => {
    const map = {
      pending: "bg-warning/10 text-warning border-warning/20",
      in_progress: "bg-info/10 text-info border-info/20",
      awaiting_approval: "bg-info/10 text-info border-info/20",
      completed: "bg-success/10 text-success border-success/20",
      rejected: "bg-destructive/10 text-destructive border-destructive/20",
    };
    const labels = {
      pending: "Pending",
      in_progress: "In Progress",
      awaiting_approval: "Awaiting Review",
      completed: "Completed",
      rejected: "Rejected",
    };
    return { cls: map[status] || map.pending, label: labels[status] || status };
  };

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
  const productivityPct =
    totalTasks > 0
      ? Math.max(0, Math.round(((onTimeTasks - lateTasks) / totalTasks) * 100 + 50))
      : 0;
  const totalPoints = onTimeTasks - lateTasks;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        <span className="ml-3 text-muted-foreground">Loading timesheet...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">My Timesheet</h2>
        <p className="text-muted-foreground text-sm mt-1">Track your task completion, deadlines, and productivity score</p>
      </div>

      {/* Productivity Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
          <div className="text-3xl font-bold text-foreground">{totalTasks}</div>
          <div className="text-sm text-muted-foreground mt-1">Total Tasks</div>
        </div>
        <div className="rounded-xl border border-success/20 bg-success/10 p-4 text-center shadow-card">
          <div className="text-3xl font-bold text-success">{onTimeTasks}</div>
          <div className="text-sm text-success mt-1">On Time</div>
          <div className="text-xs text-success">+{onTimeTasks} pts</div>
        </div>
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-center shadow-card">
          <div className="text-3xl font-bold text-destructive">{lateTasks}</div>
          <div className="text-sm text-destructive mt-1">Late</div>
          <div className="text-xs text-destructive">−{lateTasks} pts</div>
        </div>
        <div className={`rounded-xl border p-4 text-center shadow-card ${productivityPct >= 80 ? 'bg-success/10 border-success/20' : productivityPct >= 50 ? 'bg-warning/10 border-warning/20' : 'bg-destructive/10 border-destructive/20'}`}>
          <div className={`text-3xl font-bold ${productivityPct >= 80 ? 'text-success' : productivityPct >= 50 ? 'text-warning' : 'text-destructive'}`}>
            {productivityPct}%
          </div>
          <div className="text-sm text-muted-foreground mt-1">Productivity</div>
          <div className="text-xs text-muted-foreground">Points: {totalPoints >= 0 ? `+${totalPoints}` : totalPoints}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 border-b border-border">
        <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
        {[
          { key: "all", label: `All (${tasks.length})` },
          { key: "pending", label: `Active (${tasks.filter(t => ["pending","in_progress","awaiting_approval"].includes(t.status)).length})` },
          { key: "completed", label: `Completed (${completedTasks.length})` },
          { key: "rejected", label: `Rejected (${tasks.filter(t => t.status === "rejected").length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap flex-shrink-0 ${
              filter === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {/* Tasks Table */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No tasks found.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-border text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Task Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Project</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Start Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Deadline</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Completed On</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Deadline Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.map((task, i) => {
                  const status = getStatusBadge(task.status);
                  const deadline = getDeadlineStatus(task);
                  return (
                    <tr key={task.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground font-mono">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground break-words max-w-[28rem]">
                          {task.task_title}
                        </div>
                        {task.rejection_reason && (
                          <div className="text-xs text-destructive mt-1">
                            Rejected: {task.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{task.projects?.name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(task.start_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(task.end_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {task.actual_completion_date
                          ? formatDate(task.actual_completion_date)
                          : task.submitted_at
                          ? formatDate(task.submitted_at)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {deadline ? (
                          <span className={`px-2 py-1 rounded-full text-xs font-medium border ${deadline.color}`}>
                            {deadline.label}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-bold">
                        {task.status === "completed" ? (
                          <span className={task.is_on_time ? "text-success" : "text-destructive"}>
                            {task.is_on_time ? "+1" : "−1"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
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

      {/* Productivity Formula Note */}
      <div className="bg-info/10 border border-info/20 rounded-lg p-4 text-sm text-info">
        <strong>Productivity Formula:</strong> 
        {" "}(On-time tasks − Late tasks) / Total tasks × 100 + 50%
        {" "}· On-time completion = +1 point · Late completion = −1 point
      </div>
    </div>
  );
}
