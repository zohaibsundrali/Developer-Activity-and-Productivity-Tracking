"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import EChart from "@/components/charts/EChart";
import {
  PALETTE,
  SEMANTIC,
  textStyle,
  baseGrid,
  baseTooltip,
  baseLegend,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";
import {
  BarChart3,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  Field,
  Section,
  Skeleton,
  SkeletonTable,
  Tabs,
} from "@/components/ui";

// Status slices read left-to-right as good → bad, so the colours are semantic
// rather than a rotation through the categorical palette.
const STATUS_COLORS = [SEMANTIC.success, SEMANTIC.danger, SEMANTIC.muted];

export default function ProductivityDashboard({ currentAdmin }) {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("overall"); // overall, developer, project
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [developers, setDevelopers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [productivityData, setProductivityData] = useState(null);
  // Presentation only: the fetch below already knew when it failed, it just
  // had nowhere to say so.
  const [loadError, setLoadError] = useState("");

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
      setLoadError("");

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

      const response = await authFetch(url);
      const data = await response.json();

      if (data.success) {
        setProductivityData(data);
      } else {
        setLoadError(data?.error || "The productivity service returned no data.");
      }
    } catch (error) {
      console.error("Fetch productivity error:", error);
      setLoadError(error?.message || "Could not reach the productivity service.");
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

    // Stroke colours come from Tailwind's token-backed `stroke-*` utilities,
    // so the dial follows the theme instead of three hard-coded hexes.
    const strokeClass =
      value >= 80 ? "stroke-success" : value >= 60 ? "stroke-warning" : "stroke-destructive";

    return (
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Productivity ${value} percent`}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-border"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={strokeClass}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-foreground">{value}%</span>
          <span className="text-sm text-muted-foreground">Productivity</span>
        </div>
      </div>
    );
  };

  const renderOverallView = () => {
    // Rendering `null` here left a blank panel between the tabs and the page
    // footer whenever the API returned nothing. Say so instead.
    if (!productivityData) {
      return (
        <EmptyState
          icon={BarChart3}
          title="No productivity data"
          description="Once developers complete tasks, their scores and rankings appear here."
        />
      );
    }

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

    const barNames = (barData || []).map((d) => d.name);

    const barOption = {
      color: [PALETTE[0]],
      textStyle,
      // Bottom padding sized for rotated names plus the axis title; without it
      // the labels were clipped by the panel rather than merely crowded.
      grid: { ...baseGrid, bottom: 46, top: 34 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => `${Number(v).toFixed(0)}%`,
        ...baseTooltip,
      },
      legend: { ...baseLegend, data: ["Productivity %"] },
      xAxis: {
        type: "category",
        name: "Developer",
        nameLocation: "middle",
        nameGap: 36,
        nameTextStyle: axisLabel,
        data: barNames,
        // Ten first names on one axis collided at every width below ~900px.
        // interval:0 keeps one tick per developer, the rotation and the fixed
        // truncation width stop them ever printing over each other, and
        // hideOverlap is the belt-and-braces guard on very narrow panels.
        axisLabel: {
          ...axisLabel,
          interval: 0,
          rotate: barNames.length > 5 ? 35 : 0,
          width: 64,
          overflow: "truncate",
          hideOverlap: true,
        },
        axisLine,
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: "Productivity",
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: axisLabel,
        max: 100,
        axisLabel: { ...axisLabel, formatter: "{value}%" },
        splitLine,
      },
      series: [
        {
          name: "Productivity %",
          type: "bar",
          barMaxWidth: 32,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: (barData || []).map((d) => d.productivity),
        },
      ],
    };

    const pieOption = {
      textStyle,
      tooltip: { trigger: "item", ...baseTooltip },
      legend: { ...baseLegend, bottom: 0, top: "auto", left: "center", right: "auto" },
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "46%"],
          padAngle: 3,
          minAngle: 4,
          avoidLabelOverlap: true,
          // Slice labels used to print "{b}: {c}" on top of one another when
          // two slices were thin. The legend carries the names; the tooltip
          // carries the counts.
          label: { show: false },
          labelLine: { show: false },
          data: pieData.map((entry, index) => ({
            value: entry.value,
            name: entry.name,
            itemStyle: { color: STATUS_COLORS[index % STATUS_COLORS.length] },
          })),
        },
      ],
    };

    const hasBarData = (barData || []).length > 0;
    const hasPieData = pieData.some((d) => Number(d.value) > 0);

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
            <p className="text-3xl font-bold tabular-nums text-primary">{totalProjects}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">Tasks Completed</p>
            <p className="text-3xl font-bold tabular-nums text-warning">
              {totalCompleted}/{totalTasks}
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Bar Chart */}
          <Section
            title="Developer productivity"
            description="Top ten developers, scored out of 100."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            {hasBarData ? (
              <EChart option={barOption} height={320} />
            ) : (
              <div className="flex h-[320px] items-center">
                <EmptyState
                  className="w-full"
                  icon={Users}
                  title="No developers to compare"
                  description="Scores appear once developers have tasks with deadlines."
                />
              </div>
            )}
          </Section>

          {/* Pie Chart */}
          <Section
            title="Task status distribution"
            description="On-time, late and still-pending tasks across the organization."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            {hasPieData ? (
              <EChart option={pieOption} height={320} />
            ) : (
              <div className="flex h-[320px] items-center">
                <EmptyState
                  className="w-full"
                  icon={BarChart3}
                  title="No tasks yet"
                  description="This breakdown fills in as tasks are created and completed."
                />
              </div>
            )}
          </Section>
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Developer
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Projects
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tasks
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    On Time
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Late
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Points
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Productivity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {developersBreakdown?.map((dev, index) => (
                  <tr key={dev.developerId} className="h-12 transition-colors duration-150 hover:bg-muted/40">
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
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                      {dev.totalProjects}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
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
    if (!selectedDeveloper) return null;
    if (!productivityData) {
      return (
        <EmptyState
          icon={BarChart3}
          title="No data for this developer"
          description="Nothing has been recorded for them in this organization yet."
        />
      );
    }

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
        <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{developerName}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Developer productivity report</p>
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
                    className="h-2 rounded-full bg-primary transition-all duration-150"
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
    if (!selectedProject) return null;
    if (!productivityData) {
      return (
        <EmptyState
          icon={BarChart3}
          title="No data for this project"
          description="Task-level productivity appears once this project has tasks with deadlines."
        />
      );
    }

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
        <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{projectName}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Project productivity analysis</p>
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
            <p className="text-2xl font-bold tabular-nums text-primary">
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Task
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deadline
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    On Time?
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Weight
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contribution
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasksBreakdown?.map((task) => (
                  <tr key={task.id} className="h-12 transition-colors duration-150 hover:bg-muted/40">
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
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
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
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
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

  const selectClass =
    "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Header */}
      <div className="border-b border-border p-4 sm:p-5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Productivity</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          How the team is tracking against task deadlines.
        </p>
      </div>

      {/* View mode + filters */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/40 p-4 sm:p-5">
        <Tabs
          tabs={[
            { id: "overall", label: "Overall" },
            { id: "developer", label: "By developer" },
            { id: "project", label: "By project" },
          ]}
          active={viewMode}
          onChange={(id) => {
            if (id === "overall") {
              setViewMode("overall");
              setSelectedDeveloper("");
              setSelectedProject("");
              return;
            }
            setViewMode(id);
          }}
          aria-label="Productivity view"
        />

        {/* Developer Select */}
        {(viewMode === "developer" || viewMode === "project") && (
          <Field label="Developer" htmlFor="productivity-developer">
            <select
              id="productivity-developer"
              value={selectedDeveloper}
              onChange={(e) => setSelectedDeveloper(e.target.value)}
              className={selectClass}
            >
              <option value="">Select developer</option>
              {developers.map((dev) => (
                <option key={dev.id} value={dev.id}>
                  {dev.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Project Select */}
        {viewMode === "project" && (
          <Field label="Project" htmlFor="productivity-project">
            <select
              id="productivity-project"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className={selectClass}
            >
              <option value="">Select project</option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <button
          type="button"
          onClick={fetchProductivityData}
          aria-label="Refresh productivity data"
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {loading ? (
          // Skeleton shaped like the overall view: four tiles, two charts, a table.
          <div className="space-y-6" aria-busy="true">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Skeleton className="h-[320px] w-full rounded-xl" />
              <Skeleton className="h-[320px] w-full rounded-xl" />
            </div>
            <div className="rounded-xl border border-border p-4">
              <SkeletonTable rows={5} cols={6} />
            </div>
          </div>
        ) : loadError ? (
          <ErrorState
            title="Couldn't load productivity data"
            description={loadError}
            onRetry={fetchProductivityData}
          />
        ) : viewMode === "overall" ? (
          renderOverallView()
        ) : viewMode === "developer" && selectedDeveloper ? (
          renderDeveloperView()
        ) : viewMode === "project" && selectedProject ? (
          renderProjectView()
        ) : (
          <EmptyState
            icon={viewMode === "developer" ? Users : BarChart3}
            title={`Pick a ${viewMode === "developer" ? "developer" : "project"}`}
            description={`Choose a ${
              viewMode === "developer" ? "developer" : "project"
            } above to see their productivity breakdown.`}
          />
        )}
      </div>
    </div>
  );
}
