"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import EChart from "@/components/charts/EChart";
import {
  textStyle,
  baseGrid,
  baseTooltip,
  baseLegend,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";

const COLORS = ["#0c8f6e", "#0ea5e9", "#f59e0b", "#ef4444", "#0c8f6e", "#10b981"];

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
      const orgId = getOrgId();

      // Fetch developers
      let devQuery = supabase
        .from("developers")
        .select("id, name, email")
        .order("name");
      if (orgId) devQuery = devQuery.eq("organization_id", orgId);
      const { data: devs } = await devQuery;

      setDevelopers(devs || []);

      // Fetch projects
      let projQuery = supabase
        .from("projects")
        .select("id, name")
        .order("name");
      if (orgId) projQuery = projQuery.eq("organization_id", orgId);
      const { data: projs } = await projQuery;

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
            stroke="#e2e8f0"
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
          <span className="text-4xl font-bold text-foreground">{value}%</span>
          <span className="text-sm text-muted-foreground">Productivity</span>
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

    const barOption = {
      color: ["#0c8f6e"],
      textStyle,
      grid: baseGrid,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...baseTooltip },
      legend: { ...baseLegend, data: ["Productivity %"] },
      xAxis: {
        type: "category",
        data: (barData || []).map((d) => d.name),
        axisLabel,
        axisLine,
        axisTick: { show: false },
      },
      yAxis: { type: "value", max: 100, axisLabel, splitLine },
      series: [
        {
          name: "Productivity %",
          type: "bar",
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: (barData || []).map((d) => d.productivity),
        },
      ],
    };

    const pieOption = {
      textStyle,
      tooltip: { trigger: "item", ...baseTooltip },
      legend: { ...baseLegend, bottom: 0, top: "auto" },
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "50%"],
          padAngle: 5,
          label: { formatter: "{b}: {c}" },
          data: pieData.map((entry, index) => ({
            value: entry.value,
            name: entry.name,
            itemStyle: { color: COLORS[index % COLORS.length] },
          })),
        },
      ],
    };

    return (
      <div>
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">Avg Productivity</p>
            <p className="text-3xl font-bold text-primary">{averageProductivity}%</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">Total Developers</p>
            <p className="text-3xl font-bold text-info">{totalDevelopers}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">Total Projects</p>
            <p className="text-3xl font-bold" style={{ color: "#0c8f6e" }}>{totalProjects}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">Tasks Completed</p>
            <p className="text-3xl font-bold text-warning">
              {totalCompleted}/{totalTasks}
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Bar Chart */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Developer Productivity Comparison
            </h3>
            <EChart option={barOption} height={300} />
          </div>

          {/* Pie Chart */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold text-foreground mb-4">Task Status Distribution</h3>
            <EChart option={pieOption} height={300} />
          </div>
        </div>

        {/* Developer Ranking Table */}
        <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/50">
            <h3 className="text-lg font-semibold text-foreground">Developer Rankings</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Developer
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Projects
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Tasks
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    On Time
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Late
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Points
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Productivity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {developersBreakdown?.map((dev, index) => (
                  <tr key={dev.developerId} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold ${
                          index === 0
                            ? "bg-warning/10 text-warning"
                            : index === 1
                            ? "bg-muted text-muted-foreground"
                            : index === 2
                            ? "bg-warning/10 text-warning"
                            : "bg-muted/50 text-muted-foreground"
                        }`}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-foreground">
                          {dev.developerName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dev.developerEmail}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {dev.totalProjects}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {dev.completedTasks}/{dev.totalTasks}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-success font-medium">
                        {dev.onTimeTasks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-destructive font-medium">
                        {dev.lateTasks}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-bold ${
                          dev.productivityPoints >= 0
                            ? "text-success"
                            : "text-destructive"
                        }`}
                      >
                        {dev.productivityPoints >= 0 ? "+" : ""}
                        {dev.productivityPoints}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center">
                        <div className="w-20 bg-muted rounded-full h-2 mr-2">
                          <div
                            className={`h-2 rounded-full ${
                              parseFloat(dev.productivityPercentage) >= 80
                                ? "bg-success"
                                : parseFloat(dev.productivityPercentage) >= 60
                                ? "bg-warning"
                                : "bg-destructive"
                            }`}
                            style={{
                              width: `${dev.productivityPercentage}%`,
                            }}
                          />
                        </div>
                        <span className="font-medium text-foreground">
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
        <div className="bg-primary rounded-xl p-6 mb-6 text-primary-foreground">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{developerName}</h2>
              <p className="text-primary-foreground/80">Developer Productivity Report</p>
            </div>
            <ProductivityGauge percentage={productivityPercentage} size={150} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Projects</p>
            <p className="text-2xl font-bold text-foreground">{totalProjects}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Total Tasks</p>
            <p className="text-2xl font-bold text-foreground">{totalTasks}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Completed</p>
            <p className="text-2xl font-bold text-foreground">{totalCompleted}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">On Time</p>
            <p className="text-2xl font-bold text-success">
              {productivityData.totalOnTime}
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Points</p>
            <p
              className={`text-2xl font-bold ${
                productivityPoints >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {productivityPoints >= 0 ? "+" : ""}
              {productivityPoints}
            </p>
          </div>
        </div>

        {/* Timesheet-style productivity summary for admin view */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4 text-center shadow-card">
            <div className="text-3xl font-bold text-foreground">{totalTasks}</div>
            <div className="text-sm text-muted-foreground mt-1">Total Tasks</div>
          </div>
          <div className="bg-success/10 rounded-xl border border-success/20 p-4 text-center shadow-card">
            <div className="text-3xl font-bold text-success">{productivityData.totalOnTime}</div>
            <div className="text-sm text-success mt-1">On Time</div>
            <div className="text-xs text-success">+{productivityData.totalOnTime} pts</div>
          </div>
          <div className="bg-destructive/10 rounded-xl border border-destructive/20 p-4 text-center shadow-card">
            <div className="text-3xl font-bold text-destructive">{productivityData.totalLate}</div>
            <div className="text-sm text-destructive mt-1">Late</div>
            <div className="text-xs text-destructive">
              -{productivityData.totalLate} pts
            </div>
          </div>
          <div
            className={`rounded-xl border p-4 text-center shadow-card ${
              parseFloat(productivityPercentage) >= 80
                ? "bg-success/10 border-success/20"
                : parseFloat(productivityPercentage) >= 50
                ? "bg-warning/10 border-warning/20"
                : "bg-destructive/10 border-destructive/20"
            }`}
          >
            <div
              className={`text-3xl font-bold ${
                parseFloat(productivityPercentage) >= 80
                  ? "text-success"
                  : parseFloat(productivityPercentage) >= 50
                  ? "text-warning"
                  : "text-destructive"
              }`}
            >
              {productivityPercentage}%
            </div>
            <div className="text-sm text-muted-foreground mt-1">Productivity</div>
            <div className="text-xs text-muted-foreground">
              Points: {productivityPoints >= 0 ? `+${productivityPoints}` : productivityPoints}
            </div>
          </div>
        </div>

        {/* Projects Breakdown */}
        <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/50">
            <h3 className="text-lg font-semibold text-foreground">Projects Breakdown</h3>
          </div>
          <div className="divide-y divide-border">
            {projectsBreakdown?.map((proj) => (
              <div key={proj.projectId} className="p-4 hover:bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-foreground">
                    {proj.projectName}
                  </h4>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      parseFloat(proj.productivityPercentage) >= 80
                        ? "bg-success/10 text-success"
                        : parseFloat(proj.productivityPercentage) >= 60
                        ? "bg-warning/10 text-warning"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {proj.productivityPercentage}%
                  </span>
                </div>
                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                  <span>Tasks: {proj.totalTasks}</span>
                  <span>Completed: {proj.completed}</span>
                  <span className="text-success">On Time: {proj.onTime}</span>
                  <span className="text-destructive">Late: {proj.late}</span>
                  <span>Pending: {proj.pending}</span>
                </div>
                <div className="mt-2 w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
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
        <div className="mt-6 bg-info/10 border border-info/20 rounded-lg p-4 text-sm text-info">
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
        <div className="rounded-xl p-6 mb-6 text-white" style={{ background: "linear-gradient(to right, #0c8f6e, #0a7457)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{projectName}</h2>
              <p className="text-white/80">Project Productivity Analysis</p>
            </div>
            <ProductivityGauge percentage={productivityPercentage} size={150} />
          </div>
        </div>

        {/* Formula Explanation */}
        <div className="bg-info/10 border border-info/20 rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-info mb-2">
            Productivity Formula
          </h4>
          <p className="text-info">{formula?.description}</p>
          <p className="text-info mt-1 font-mono text-sm">
            {formula?.calculation}
          </p>
          <p className="text-info/80 text-sm mt-1">{formula?.example}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Total Tasks</p>
            <p className="text-2xl font-bold text-foreground">{totalTasks}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Task Weight</p>
            <p className="text-2xl font-bold text-foreground">{taskWeight}%</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Completed</p>
            <p className="text-2xl font-bold text-info">
              {summary?.completed}
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">On Time</p>
            <p className="text-2xl font-bold text-success">
              {summary?.onTime}
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Late</p>
            <p className="text-2xl font-bold text-destructive">{summary?.late}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <p className="text-muted-foreground text-sm">Progress</p>
            <p className="text-2xl font-bold" style={{ color: "#0c8f6e" }}>
              {completionProgress}%
            </p>
          </div>
        </div>

        {/* Tasks Breakdown Table */}
        <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/50">
            <h3 className="text-lg font-semibold text-foreground">Task-by-Task Analysis</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Task
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Deadline
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    On Time?
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Weight
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Contribution
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasksBreakdown?.map((task) => (
                  <tr key={task.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{task.title}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          task.status === "completed"
                            ? "bg-success/10 text-success"
                            : task.status === "rejected"
                            ? "bg-destructive/10 text-destructive"
                            : task.status === "awaiting_approval"
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {task.endDate
                        ? new Date(task.endDate).toLocaleDateString()
                        : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === "completed" ? (
                        task.isOnTime ? (
                          <span className="text-success">✓ Yes</span>
                        ) : (
                          <span className="text-destructive">✗ No</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {task.weight}%
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-bold ${
                          task.contribution > 0
                            ? "text-success"
                            : task.contribution < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
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
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      {/* Header */}
      <div className="bg-primary p-6">
        <h2 className="text-2xl font-bold text-primary-foreground mb-2">
          Productivity Dashboard
        </h2>
        <p className="text-primary-foreground/80">
          Monitor and analyze developer productivity metrics
        </p>
      </div>

      {/* View Mode Tabs */}
      <div className="border-b border-border px-6 py-3 bg-muted/50 flex flex-wrap gap-3 items-center">
        <button
          onClick={() => {
            setViewMode("overall");
            setSelectedDeveloper("");
            setSelectedProject("");
          }}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            viewMode === "overall"
              ? "bg-primary text-primary-foreground shadow-card"
              : "bg-card text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          Overall View
        </button>
        <button
          onClick={() => setViewMode("developer")}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            viewMode === "developer"
              ? "bg-primary text-primary-foreground shadow-card"
              : "bg-card text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          By Developer
        </button>
        <button
          onClick={() => setViewMode("project")}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            viewMode === "project"
              ? "bg-primary text-primary-foreground shadow-card"
              : "bg-card text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          By Project
        </button>

        {/* Developer Select */}
        {(viewMode === "developer" || viewMode === "project") && (
          <select
            value={selectedDeveloper}
            onChange={(e) => setSelectedDeveloper(e.target.value)}
            className="px-3 py-2 border border-input bg-background rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/30"
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
            className="px-3 py-2 border border-input bg-background rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/30"
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
          className="ml-auto inline-flex items-center justify-center px-4 py-2 bg-card text-muted-foreground rounded-lg border border-border hover:bg-muted transition-all"
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading productivity data...</p>
          </div>
        ) : viewMode === "overall" ? (
          renderOverallView()
        ) : viewMode === "developer" && selectedDeveloper ? (
          renderDeveloperView()
        ) : viewMode === "project" && selectedProject ? (
          renderProjectView()
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <svg
              className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4"
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
