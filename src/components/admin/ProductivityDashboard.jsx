"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

const COLORS = ["#009578", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981"];

export default function ProductivityDashboard({ currentAdmin }) {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("overall"); // overall, developer, project
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [developers, setDevelopers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [productivityData, setProductivityData] = useState(null);

  // Fetch developers and projects on mount
  useEffect(() => {
    fetchDevelopersAndProjects();
  }, [currentAdmin]);

  // Fetch productivity data when view or selection changes
  useEffect(() => {
    fetchProductivityData();
  }, [viewMode, selectedDeveloper, selectedProject]);

  const fetchDevelopersAndProjects = async () => {
    try {
      // Fetch developers
      const { data: devs } = await supabase
        .from("developers")
        .select("id, name, email")
        .order("name");

      setDevelopers(devs || []);

      // Fetch projects
      const { data: projs } = await supabase
        .from("projects")
        .select("id, name")
        .order("name");

      setProjects(projs || []);
    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  const fetchProductivityData = async () => {
    try {
      setLoading(true);

      let url = "/api/productivity?";

      if (viewMode === "overall") {
        url += "type=overall";
      } else if (viewMode === "developer" && selectedDeveloper) {
        url += `type=developer&developerId=${selectedDeveloper}`;
      } else if (viewMode === "project" && selectedProject) {
        url += `type=project&projectId=${selectedProject}`;
        if (selectedDeveloper) {
          url += `&developerId=${selectedDeveloper}`;
        }
      } else {
        setLoading(false);
        return;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setProductivityData(data);
      }
    } catch (error) {
      console.error("Fetch productivity error:", error);
    } finally {
      setLoading(false);
    }
  };

  const ProductivityGauge = ({ percentage, size = 200 }) => {
    const value = parseFloat(percentage) || 0;
    const strokeWidth = 15;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;

    const getColor = (val) => {
      if (val >= 80) return "#10b981"; // green
      if (val >= 60) return "#f59e0b"; // yellow
      return "#ef4444"; // red
    };

    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={getColor(value)}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-gray-800">{value}%</span>
          <span className="text-sm text-gray-500">Productivity</span>
        </div>
      </div>
    );
  };

  const renderOverallView = () => {
    if (!productivityData) return null;

    const {
      totalDevelopers,
      totalProjects,
      totalTasks,
      totalCompleted,
      averageProductivity,
      developersBreakdown,
    } = productivityData;

    // Prepare chart data
    const barData = developersBreakdown?.slice(0, 10).map((dev) => ({
      name: dev.developerName?.split(" ")[0] || "Dev",
      productivity: parseFloat(dev.productivityPercentage),
      onTime: dev.onTimeTasks,
      late: dev.lateTasks,
    }));

    const pieData = [
      { name: "On Time", value: productivityData.totalOnTime || 0 },
      {
        name: "Late",
        value: (totalCompleted || 0) - (productivityData.totalOnTime || 0),
      },
      { name: "Pending", value: (totalTasks || 0) - (totalCompleted || 0) },
    ];

    return (
      <div>
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-[#009578] to-[#00b894] rounded-xl p-4 text-white">
            <p className="text-white/80 text-sm">Avg Productivity</p>
            <p className="text-3xl font-bold">{averageProductivity}%</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
            <p className="text-white/80 text-sm">Total Developers</p>
            <p className="text-3xl font-bold">{totalDevelopers}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
            <p className="text-white/80 text-sm">Total Projects</p>
            <p className="text-3xl font-bold">{totalProjects}</p>
          </div>
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl p-4 text-white">
            <p className="text-white/80 text-sm">Tasks Completed</p>
            <p className="text-3xl font-bold">
              {totalCompleted}/{totalTasks}
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Bar Chart */}
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-semibold mb-4">
              Developer Productivity Comparison
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="productivity"
                  name="Productivity %"
                  fill="#009578"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart */}
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-semibold mb-4">Task Status Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Developer Ranking Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="text-lg font-semibold">Developer Rankings</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    Developer
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Projects
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Tasks
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    On Time
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Late
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Points
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Productivity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {developersBreakdown?.map((dev, index) => (
                  <tr key={dev.developerId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold ${
                          index === 0
                            ? "bg-yellow-100 text-yellow-700"
                            : index === 1
                            ? "bg-gray-100 text-gray-600"
                            : index === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800">
                          {dev.developerName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {dev.developerEmail}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {dev.totalProjects}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {dev.completedTasks}/{dev.totalTasks}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-green-600 font-medium">
                        {dev.onTimeTasks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-red-600 font-medium">
                        {dev.lateTasks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-bold ${
                          dev.productivityPoints >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {dev.productivityPoints >= 0 ? "+" : ""}
                        {dev.productivityPoints}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2 mr-2">
                          <div
                            className={`h-2 rounded-full ${
                              parseFloat(dev.productivityPercentage) >= 80
                                ? "bg-green-500"
                                : parseFloat(dev.productivityPercentage) >= 60
                                ? "bg-yellow-500"
                                : "bg-red-500"
                            }`}
                            style={{
                              width: `${dev.productivityPercentage}%`,
                            }}
                          />
                        </div>
                        <span className="font-medium">
                          {dev.productivityPercentage}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderDeveloperView = () => {
    if (!productivityData || !selectedDeveloper) return null;

    const {
      developerName,
      totalProjects,
      totalTasks,
      totalCompleted,
      productivityPercentage,
      productivityPoints,
      projectsBreakdown,
    } = productivityData;

    return (
      <div>
        {/* Developer Header */}
        <div className="bg-gradient-to-r from-[#009578] to-[#00b894] rounded-xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{developerName}</h2>
              <p className="text-white/80">Developer Productivity Report</p>
            </div>
            <ProductivityGauge percentage={productivityPercentage} size={150} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Projects</p>
            <p className="text-2xl font-bold text-gray-800">{totalProjects}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Total Tasks</p>
            <p className="text-2xl font-bold text-gray-800">{totalTasks}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Completed</p>
            <p className="text-2xl font-bold text-gray-800">{totalCompleted}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">On Time</p>
            <p className="text-2xl font-bold text-green-600">
              {productivityData.totalOnTime}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Points</p>
            <p
              className={`text-2xl font-bold ${
                productivityPoints >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {productivityPoints >= 0 ? "+" : ""}
              {productivityPoints}
            </p>
          </div>
        </div>

        {/* Timesheet-style productivity summary for admin view */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
            <div className="text-3xl font-bold text-gray-800">{totalTasks}</div>
            <div className="text-sm text-gray-500 mt-1">Total Tasks</div>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center shadow-sm">
            <div className="text-3xl font-bold text-green-600">{productivityData.totalOnTime}</div>
            <div className="text-sm text-green-700 mt-1">On Time</div>
            <div className="text-xs text-green-600">+{productivityData.totalOnTime} pts</div>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center shadow-sm">
            <div className="text-3xl font-bold text-red-600">{productivityData.totalLate}</div>
            <div className="text-sm text-red-700 mt-1">Late</div>
            <div className="text-xs text-red-600">
              -{productivityData.totalLate} pts
            </div>
          </div>
          <div
            className={`rounded-xl border p-4 text-center shadow-sm ${
              parseFloat(productivityPercentage) >= 80
                ? "bg-green-50 border-green-200"
                : parseFloat(productivityPercentage) >= 50
                ? "bg-yellow-50 border-yellow-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div
              className={`text-3xl font-bold ${
                parseFloat(productivityPercentage) >= 80
                  ? "text-green-600"
                  : parseFloat(productivityPercentage) >= 50
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {productivityPercentage}%
            </div>
            <div className="text-sm text-gray-600 mt-1">Productivity</div>
            <div className="text-xs text-gray-500">
              Points: {productivityPoints >= 0 ? `+${productivityPoints}` : productivityPoints}
            </div>
          </div>
        </div>

        {/* Projects Breakdown */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="text-lg font-semibold">Projects Breakdown</h3>
          </div>
          <div className="divide-y">
            {projectsBreakdown?.map((proj) => (
              <div key={proj.projectId} className="p-4 hover:bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-800">
                    {proj.projectName}
                  </h4>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      parseFloat(proj.productivityPercentage) >= 80
                        ? "bg-green-100 text-green-700"
                        : parseFloat(proj.productivityPercentage) >= 60
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {proj.productivityPercentage}%
                  </span>
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span>Tasks: {proj.totalTasks}</span>
                  <span>Completed: {proj.completed}</span>
                  <span className="text-green-600">On Time: {proj.onTime}</span>
                  <span className="text-red-600">Late: {proj.late}</span>
                  <span>Pending: {proj.pending}</span>
                </div>
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-[#009578] h-2 rounded-full transition-all"
                    style={{
                      width: `${(proj.completed / proj.totalTasks) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Productivity formula note (same logic as developer timesheet) */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <strong>Productivity Formula:</strong>
          {" "}(On-time tasks − Late tasks) / Total tasks × 100
          {" "}+ 50% · On-time completion = +1 point · Late completion = −1 point
        </div>
      </div>
    );
  };

  const renderProjectView = () => {
    if (!productivityData || !selectedProject) return null;

    const {
      projectName,
      totalTasks,
      taskWeight,
      productivityPercentage,
      productivityPoints,
      completionProgress,
      summary,
      tasksBreakdown,
      formula,
    } = productivityData;

    return (
      <div>
        {/* Project Header */}
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{projectName}</h2>
              <p className="text-white/80">Project Productivity Analysis</p>
            </div>
            <ProductivityGauge percentage={productivityPercentage} size={150} />
          </div>
        </div>

        {/* Formula Explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-blue-800 mb-2">
            Productivity Formula
          </h4>
          <p className="text-blue-700">{formula?.description}</p>
          <p className="text-blue-600 mt-1 font-mono text-sm">
            {formula?.calculation}
          </p>
          <p className="text-blue-500 text-sm mt-1">{formula?.example}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Total Tasks</p>
            <p className="text-2xl font-bold text-gray-800">{totalTasks}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Task Weight</p>
            <p className="text-2xl font-bold text-gray-800">{taskWeight}%</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Completed</p>
            <p className="text-2xl font-bold text-blue-600">
              {summary?.completed}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">On Time</p>
            <p className="text-2xl font-bold text-green-600">
              {summary?.onTime}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Late</p>
            <p className="text-2xl font-bold text-red-600">{summary?.late}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <p className="text-gray-500 text-sm">Progress</p>
            <p className="text-2xl font-bold text-purple-600">
              {completionProgress}%
            </p>
          </div>
        </div>

        {/* Tasks Breakdown Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="text-lg font-semibold">Task-by-Task Analysis</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    Task
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Deadline
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    On Time?
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Weight
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Contribution
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasksBreakdown?.map((task) => (
                  <tr key={task.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{task.title}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          task.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : task.status === "rejected"
                            ? "bg-red-100 text-red-700"
                            : task.status === "awaiting_approval"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {task.endDate
                        ? new Date(task.endDate).toLocaleDateString()
                        : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === "completed" ? (
                        task.isOnTime ? (
                          <span className="text-green-600">✓ Yes</span>
                        ) : (
                          <span className="text-red-600">✗ No</span>
                        )
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {task.weight}%
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-bold ${
                          task.contribution > 0
                            ? "text-green-600"
                            : task.contribution < 0
                            ? "text-red-600"
                            : "text-gray-500"
                        }`}
                      >
                        {task.contributionLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#009578] to-[#00b894] p-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          Productivity Dashboard
        </h2>
        <p className="text-white/80">
          Monitor and analyze developer productivity metrics
        </p>
      </div>

      {/* View Mode Tabs */}
      <div className="border-b px-6 py-3 bg-gray-50 flex flex-wrap gap-3 items-center">
        <button
          onClick={() => {
            setViewMode("overall");
            setSelectedDeveloper("");
            setSelectedProject("");
          }}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            viewMode === "overall"
              ? "bg-[#009578] text-white shadow"
              : "bg-white text-gray-600 hover:bg-gray-100 border"
          }`}
        >
          Overall View
        </button>
        <button
          onClick={() => setViewMode("developer")}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            viewMode === "developer"
              ? "bg-[#009578] text-white shadow"
              : "bg-white text-gray-600 hover:bg-gray-100 border"
          }`}
        >
          By Developer
        </button>
        <button
          onClick={() => setViewMode("project")}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            viewMode === "project"
              ? "bg-[#009578] text-white shadow"
              : "bg-white text-gray-600 hover:bg-gray-100 border"
          }`}
        >
          By Project
        </button>

        {/* Developer Select */}
        {(viewMode === "developer" || viewMode === "project") && (
          <select
            value={selectedDeveloper}
            onChange={(e) => setSelectedDeveloper(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#009578] focus:border-[#009578]"
          >
            <option value="">Select Developer</option>
            {developers.map((dev) => (
              <option key={dev.id} value={dev.id}>
                {dev.name}
              </option>
            ))}
          </select>
        )}

        {/* Project Select */}
        {viewMode === "project" && (
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#009578] focus:border-[#009578]"
          >
            <option value="">Select Project</option>
            {projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={fetchProductivityData}
          className="ml-auto px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-all"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#009578] mx-auto"></div>
            <p className="mt-4 text-gray-500">Loading productivity data...</p>
          </div>
        ) : viewMode === "overall" ? (
          renderOverallView()
        ) : viewMode === "developer" && selectedDeveloper ? (
          renderDeveloperView()
        ) : viewMode === "project" && selectedProject ? (
          renderProjectView()
        ) : (
          <div className="text-center py-12 text-gray-500">
            <svg
              className="w-16 h-16 mx-auto text-gray-300 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p>
              Select a {viewMode === "developer" ? "developer" : "project"} to
              view productivity metrics
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
