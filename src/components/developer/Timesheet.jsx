"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
      if (daysLeft < 0) return { label: "Overdue", color: "text-red-600 bg-red-50 border-red-200" };
      if (daysLeft <= 3) return { label: `${daysLeft}d left`, color: "text-orange-600 bg-orange-50 border-orange-200" };
      return { label: `${daysLeft}d left`, color: "text-green-600 bg-green-50 border-green-200" };
    }
    if (task.is_on_time === true) return { label: "On Time", color: "text-green-700 bg-green-100 border-green-200" };
    if (task.is_on_time === false) return { label: "Late", color: "text-red-700 bg-red-100 border-red-200" };
    return null;
  };

  const getStatusBadge = (status) => {
    const map = {
      pending: "bg-gray-100 text-gray-600 border-gray-200",
      in_progress: "bg-blue-100 text-blue-700 border-blue-200",
      awaiting_approval: "bg-yellow-100 text-yellow-700 border-yellow-200",
      completed: "bg-green-100 text-green-700 border-green-200",
      rejected: "bg-red-100 text-red-700 border-red-200",
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
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#009578]"></div>
        <span className="ml-3 text-gray-600">Loading timesheet...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">My Timesheet</h2>
        <p className="text-gray-500 text-sm mt-1">Track your task completion, deadlines, and productivity score</p>
      </div>

      {/* Productivity Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-gray-800">{totalTasks}</div>
          <div className="text-sm text-gray-500 mt-1">Total Tasks</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-green-600">{onTimeTasks}</div>
          <div className="text-sm text-green-700 mt-1">On Time</div>
          <div className="text-xs text-green-600">+{onTimeTasks} pts</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-red-600">{lateTasks}</div>
          <div className="text-sm text-red-700 mt-1">Late</div>
          <div className="text-xs text-red-600">−{lateTasks} pts</div>
        </div>
        <div className={`rounded-xl border p-4 text-center shadow-sm ${productivityPct >= 80 ? 'bg-green-50 border-green-200' : productivityPct >= 50 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
          <div className={`text-3xl font-bold ${productivityPct >= 80 ? 'text-green-600' : productivityPct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {productivityPct}%
          </div>
          <div className="text-sm text-gray-600 mt-1">Productivity</div>
          <div className="text-xs text-gray-500">Points: {totalPoints >= 0 ? `+${totalPoints}` : totalPoints}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 border-b">
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
                ? "border-[#009578] text-[#009578]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {/* Tasks Table */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No tasks found.</div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Task Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Project</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Start Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Deadline</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Completed On</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Deadline Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTasks.map((task, i) => {
                  const status = getStatusBadge(task.status);
                  const deadline = getDeadlineStatus(task);
                  return (
                    <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800 break-words max-w-[28rem]">
                          {task.task_title}
                        </div>
                        {task.rejection_reason && (
                          <div className="text-xs text-red-600 mt-1">
                            Rejected: {task.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{task.projects?.name || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(task.start_date)}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(task.end_date)}</td>
                      <td className="px-4 py-3 text-gray-600">
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
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-bold">
                        {task.status === "completed" ? (
                          <span className={task.is_on_time ? "text-green-600" : "text-red-600"}>
                            {task.is_on_time ? "+1" : "−1"}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
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
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Productivity Formula:</strong> 
        {" "}(On-time tasks − Late tasks) / Total tasks × 100 + 50%
        {" "}· On-time completion = +1 point · Late completion = −1 point
      </div>
    </div>
  );
}
