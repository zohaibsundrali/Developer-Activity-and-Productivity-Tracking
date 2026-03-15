"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function DeadlineMonitor({ currentAdmin }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, overdue, at_risk, on_track
  const [groupBy, setGroupBy] = useState("project"); // project, developer, status
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (currentAdmin?.id) fetchAllTasks();
  }, [currentAdmin]);

  const fetchAllTasks = async () => {
    try {
      setLoading(true);

      // Get admin's projects first
      const { data: projects } = await supabase
        .from("projects")
        .select("id")
        .or(`admin_id.eq.${currentAdmin.id},created_by.eq.${currentAdmin.id}`);

      if (!projects || projects.length === 0) {
        setTasks([]);
        return;
      }

      const projectIds = projects.map((p) => p.id);

      const { data, error } = await supabase
        .from("developer_tasks")
        .select(`
          *,
          projects (
            id,
            name,
            deadline
          ),
          developers (
            id,
            name,
            email,
            designation
          )
        `)
        .in("project_id", projectIds)
        .order("end_date", { ascending: true });

      if (error) throw error;
      setTasks(data || []);
    } catch (err) {
      console.error("DeadlineMonitor fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getDaysRemaining = (endDate) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  };

  const getUrgency = (task) => {
    if (["completed", "rejected"].includes(task.status)) return "done";
    const days = getDaysRemaining(task.end_date);
    if (days === null) return "unknown";
    if (days < 0) return "overdue";
    if (days <= 3) return "critical";
    if (days <= 7) return "at_risk";
    return "on_track";
  };

  const urgencyConfig = {
    overdue: { label: "Overdue", bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700 border-red-300", text: "text-red-700" },
    critical: { label: "Critical", bg: "bg-orange-50", border: "border-orange-200", badge: "bg-orange-100 text-orange-700 border-orange-300", text: "text-orange-700" },
    at_risk: { label: "At Risk", bg: "bg-yellow-50", border: "border-yellow-200", badge: "bg-yellow-100 text-yellow-700 border-yellow-300", text: "text-yellow-700" },
    on_track: { label: "On Track", bg: "bg-green-50", border: "border-green-200", badge: "bg-green-100 text-green-700 border-green-300", text: "text-green-700" },
    done: { label: "Done", bg: "bg-gray-50", border: "border-gray-200", badge: "bg-gray-100 text-gray-600 border-gray-300", text: "text-gray-500" },
    unknown: { label: "No Date", bg: "bg-gray-50", border: "border-gray-200", badge: "bg-gray-100 text-gray-500 border-gray-200", text: "text-gray-400" },
  };

  const statusLabel = {
    pending: "Pending",
    in_progress: "In Progress",
    awaiting_approval: "Awaiting Review",
    completed: "Completed",
    rejected: "Rejected",
  };

  const statusBadge = {
    pending: "bg-gray-100 text-gray-600 border-gray-200",
    in_progress: "bg-blue-100 text-blue-700 border-blue-200",
    awaiting_approval: "bg-yellow-100 text-yellow-700 border-yellow-200",
    completed: "bg-green-100 text-green-700 border-green-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
  };

  const formatDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const filteredTasks = tasks.filter((task) => {
    const urgency = getUrgency(task);
    const matchesFilter =
      filter === "all" ||
      (filter === "overdue" && urgency === "overdue") ||
      (filter === "at_risk" && (urgency === "critical" || urgency === "at_risk")) ||
      (filter === "on_track" && urgency === "on_track");

    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      task.task_title?.toLowerCase().includes(q) ||
      task.developers?.name?.toLowerCase().includes(q) ||
      task.projects?.name?.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });

  // Stats
  const stats = {
    total: tasks.filter(t => !["completed"].includes(t.status)).length,
    overdue: tasks.filter(t => getUrgency(t) === "overdue").length,
    critical: tasks.filter(t => getUrgency(t) === "critical").length,
    at_risk: tasks.filter(t => getUrgency(t) === "at_risk").length,
    completed: tasks.filter(t => t.status === "completed").length,
  };

  // Group tasks
  const groupTasks = () => {
    const groups = {};
    filteredTasks.forEach((task) => {
      let key;
      if (groupBy === "project") key = task.projects?.name || "Unknown Project";
      else if (groupBy === "developer") key = task.developers?.name || "Unknown Developer";
      else key = statusLabel[task.status] || task.status;

      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    });
    return groups;
  };

  const grouped = groupTasks();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#009578]"></div>
        <span className="ml-3 text-gray-600">Loading deadline data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Deadline Monitor</h2>
          <p className="text-gray-500 text-sm mt-1">Track all developer task deadlines across your projects</p>
        </div>
        <button
          onClick={fetchAllTasks}
          className="px-4 py-2 bg-[#009578] text-white rounded-lg hover:bg-[#007a63] text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-gray-800">{stats.total}</div>
          <div className="text-sm text-gray-500 mt-1">Active Tasks</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-red-600">{stats.overdue}</div>
          <div className="text-sm text-red-700 mt-1">Overdue</div>
        </div>
        <div className="bg-orange-50 rounded-xl border border-orange-200 p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-orange-600">{stats.critical}</div>
          <div className="text-sm text-orange-700 mt-1">Due in ≤3 days</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-sm text-green-700 mt-1">Completed</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Filter tabs */}
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
          {[
            { key: "all", label: "All" },
            { key: "overdue", label: `Overdue (${stats.overdue})` },
            { key: "at_risk", label: `At Risk (${stats.at_risk + stats.critical})` },
            { key: "on_track", label: "On Track" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-white text-[#009578] shadow-sm"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks, developers..."
            className="px-3 py-1.5 border rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#009578]"
          />
          {/* Group by */}
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#009578]"
          >
            <option value="project">Group by Project</option>
            <option value="developer">Group by Developer</option>
            <option value="status">Group by Status</option>
          </select>
        </div>
      </div>

      {/* Task Groups */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 text-gray-500">No tasks match the current filter.</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([groupName, groupTasks]) => (
            <div key={groupName} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">{groupName}</h3>
                <span className="text-sm text-gray-500">{groupTasks.length} task{groupTasks.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Task</th>
                      {groupBy !== "developer" && <th className="px-4 py-2 text-left font-medium text-gray-500">Developer</th>}
                      {groupBy !== "project" && <th className="px-4 py-2 text-left font-medium text-gray-500">Project</th>}
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Deadline</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Remaining</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Urgency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupTasks.map((task) => {
                      const urgency = getUrgency(task);
                      const cfg = urgencyConfig[urgency];
                      const daysLeft = getDaysRemaining(task.end_date);
                      return (
                        <tr
                          key={task.id}
                          className={`${cfg.bg} hover:brightness-95 transition-all`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800">{task.task_title}</div>
                          </td>
                          {groupBy !== "developer" && (
                            <td className="px-4 py-3 text-gray-600">{task.developers?.name || "—"}</td>
                          )}
                          {groupBy !== "project" && (
                            <td className="px-4 py-3 text-gray-600">{task.projects?.name || "—"}</td>
                          )}
                          <td className="px-4 py-3 text-gray-600">{formatDate(task.end_date)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium border ${statusBadge[task.status] || statusBadge.pending}`}>
                              {statusLabel[task.status] || task.status}
                            </span>
                          </td>
                          <td className={`px-4 py-3 font-semibold ${cfg.text}`}>
                            {task.status === "completed"
                              ? "Done"
                              : daysLeft === null
                              ? "—"
                              : daysLeft < 0
                              ? `${Math.abs(daysLeft)}d overdue`
                              : daysLeft === 0
                              ? "Due today"
                              : `${daysLeft}d remaining`}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium border ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
