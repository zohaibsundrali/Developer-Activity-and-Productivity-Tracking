import {
  ClipboardList,
  Clock,
  TrendingUp,
  BarChart3,
  Calendar,
  FileText,
  Download,

  CheckCircle,

  Target,
  Rocket,
  Award,
  Eye,

  Printer,
  Mail,

} from 'lucide-react';

export default function ProjectManagementSection() {
  const projectFeatures = [
    { name: 'Task Time Estimation', included: true, icon: Clock },
    { name: 'Actual vs Estimated Analysis', included: true, icon: TrendingUp },
    { name: 'Progress Monitoring', included: true, icon: BarChart3 },
    { name: 'Project Timeline View', included: true, icon: Calendar }
  ];

  const reportFeatures = [
    'Daily & weekly productivity reports',
    'Time spent on apps & websites',
    'Task completion status charts',
    'Filter reports by date range'
  ];

  const quickStats = [
    { value: '85%', label: 'On-time Projects', icon: Target, color: 'green' },
    { value: '12', label: 'Active Projects', icon: Rocket, color: 'blue' },
    { value: '4.9★', label: 'Team Rating', icon: Award, color: 'yellow' },
    { value: '240', label: 'Tasks Completed', icon: CheckCircle, color: 'purple' }
  ];

  const exportOptions = [
    { label: 'PDF Report', icon: FileText, color: 'red' },
    { label: 'Excel Export', icon: Download, color: 'green' },
    { label: 'Print Report', icon: Printer, color: 'blue' },
    { label: 'Email Summary', icon: Mail, color: 'purple' }
  ];

  return (
    <div className="space-y-8">
      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {quickStats.map((stat, index) => {
          const IconComponent = stat.icon;
          const colorClasses = {
            green: 'bg-success/10 text-success border-success/20',
            blue: 'bg-info/10 text-info border-info/20',
            yellow: 'bg-warning/10 text-warning border-warning/20',
            purple: 'bg-primary/10 text-primary border-primary/20'
          };
          return (
            <div
              key={index}
              className="rounded-xl border border-border bg-card p-4 text-center shadow-card"
            >
              <span
                className={`${colorClasses[stat.color]} mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg border`}
              >
                <IconComponent className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="text-xl font-semibold tracking-tight text-foreground">{stat.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Project Planning Card */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="border-b border-border bg-muted/50 px-5 py-5 sm:px-6">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ClipboardList className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">Project planning</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Create work breakdown structures, estimate tasks, and track actual vs. estimated time and budget.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <div className="space-y-3">
              {projectFeatures.map((feature, index) => {
                const IconComponent = feature.icon;
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <IconComponent className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">{feature.name}</span>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
                      <CheckCircle className="h-3 w-3" aria-hidden="true" />
                      Included
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Progress Bar */}
            <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Overall progress</span>
                <span className="text-sm font-semibold text-primary">72%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-label="Overall progress"
                aria-valuenow={72}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-2 w-[72%] rounded-full bg-primary"></div>
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Started: 8 tasks</span>
                <span>Completed: 18 tasks</span>
                <span>Remaining: 7 tasks</span>
              </div>
            </div>
          </div>
        </div>

        {/* Reports & Invoices Card */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="border-b border-border bg-muted/50 px-5 py-5 sm:px-6">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">Reports &amp; invoices</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Generate professional reports and invoices with multiple export options.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <ul className="space-y-1">
              {reportFeatures.map((item, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 rounded-lg p-2.5 transition-colors duration-150 hover:bg-muted"
                >
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-sm leading-relaxed text-foreground">{item}</span>
                </li>
              ))}
            </ul>

            {/* Export Options */}
            <div className="mt-6">
              <h5 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export options
              </h5>
              {/* Illustrative, not interactive — these are a preview of the
                  in-app export bar, so they must not be focusable dead ends. */}
              <ul className="grid grid-cols-2 gap-2">
                {exportOptions.map((option, index) => {
                  const IconComponent = option.icon;
                  const colorClasses = {
                    red: 'text-destructive',
                    green: 'text-success',
                    blue: 'text-info',
                    purple: 'text-primary'
                  };
                  return (
                    <li
                      key={index}
                      className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs font-medium text-foreground"
                    >
                      <IconComponent
                        className={`${colorClasses[option.color]} h-4 w-4`}
                        aria-hidden="true"
                      />
                      {option.label}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Recent Activity */}
            <div className="mt-6 border-t border-border pt-6">
              <h5 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Recent activity
              </h5>
              <ul className="space-y-2.5">
                {[
                  ['Report generated for Q4 2024', '2 min ago'],
                  ['Invoice #INV-2024-042 sent', '1 hour ago'],
                  ['Weekly productivity report', '3 hours ago'],
                ].map(([label, when]) => (
                  <li key={label} className="flex items-baseline justify-between gap-4 text-xs">
                    <span className="truncate text-foreground">{label}</span>
                    <span className="shrink-0 text-muted-foreground">{when}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}