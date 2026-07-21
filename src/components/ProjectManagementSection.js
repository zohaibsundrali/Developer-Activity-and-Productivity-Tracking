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
              className={`${colorClasses[stat.color]} rounded-xl p-4 border text-center transition-all hover:scale-[1.02] hover:shadow-card`}
            >
              <IconComponent className="w-6 h-6 mx-auto mb-2" />
              <div className="text-xl font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Project Planning Card */}
        <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden hover:shadow-elevated transition-shadow duration-300">
          <div className="bg-muted/50 px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary rounded-xl">
                <ClipboardList className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Project Planning</h3>
                <p className="text-muted-foreground text-sm font-light">
                  Create work breakdown structures, estimate tasks, and track actual vs. estimated time and budget.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="space-y-3">
              {projectFeatures.map((feature, index) => {
                const IconComponent = feature.icon;
                return (
                  <div 
                    key={index} 
                    className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                        <IconComponent className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-foreground font-medium">{feature.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-success" />
                      <span className="text-xs font-semibold text-success">Included</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Progress Bar */}
            <div className="mt-6 p-4 bg-muted/50 rounded-xl border border-border">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">Overall Progress</span>
                <span className="text-sm font-bold text-primary">72%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div className="bg-primary h-2.5 rounded-full w-[72%]"></div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>Started: 8 tasks</span>
                <span>Completed: 18 tasks</span>
                <span>Remaining: 7 tasks</span>
              </div>
            </div>
          </div>
        </div>

        {/* Reports & Invoices Card */}
        <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden hover:shadow-elevated transition-shadow duration-300">
          <div className="bg-muted/50 px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary rounded-xl">
                <FileText className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Reports & Invoices</h3>
                <p className="text-muted-foreground text-sm font-light">
                  Generate professional reports and invoices with multiple export options.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="space-y-3">
              {reportFeatures.map((item, index) => (
                <div 
                  key={index} 
                  className="flex items-center p-3 rounded-lg hover:bg-muted transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="text-foreground ml-3 text-sm leading-relaxed">{item}</span>
                </div>
              ))}
            </div>

            {/* Export Options */}
            <div className="mt-6">
              <h5 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export Options
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {exportOptions.map((option, index) => {
                  const IconComponent = option.icon;
                  const colorClasses = {
                    red: 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20',
                    green: 'bg-success/10 text-success border-success/20 hover:bg-success/20',
                    blue: 'bg-info/10 text-info border-info/20 hover:bg-info/20',
                    purple: 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
                  };
                  return (
                    <button 
                      key={index}
                      className={`${colorClasses[option.color]} p-3 rounded-lg border text-xs font-medium transition-all hover:scale-[1.02] flex items-center justify-center gap-2`}
                    >
                      <IconComponent className="w-4 h-4" />
                      {option.label}
                    </button>
                  );
                })}  
              </div>
            </div>

            {/* Recent Activity */}
            <div className="mt-6 pt-6 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Recent Activity
                </h5>
                <button className="text-xs text-primary hover:text-primary/80 font-medium">
                  View All
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Report generated for Q4 2024</span>
                  <span className="text-muted-foreground/70">2 min ago</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Invoice #INV-2024-042 sent</span>
                  <span className="text-muted-foreground/70">1 hour ago</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Weekly productivity report</span>
                  <span className="text-muted-foreground/70">3 hours ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}