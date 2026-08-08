import {
  Camera,
  BarChart3,
  Star,
  Globe,
  Users,
  Activity,
  CheckCircle,
  TrendingUp,
  Shield,
  Zap
} from 'lucide-react';

export default function EmployeeMonitoringSection() {
  const monitoringItems = [
    { icon: Camera, label: 'Screenshots' },
    { icon: BarChart3, label: 'App Logs' },
    { icon: Star, label: 'Activity Score' },
    { icon: Globe, label: 'Browser Tracking' }
  ];

  const features = [
    'Track mouse clicks, keyboard activity & screen time',
    'Monitor apps & websites used by developers',
    'Automatic screenshot capture',
    'Real-time reports with charts & graphs',
    'Project task assignment & progress tracking',
    'Secure login & data encryption'
  ];

  const stats = [
    { value: '99.9%', label: 'Uptime', icon: Shield },
    { value: '4.8★', label: 'User Rating', icon: Star },
    { value: '10K+', label: 'Active Users', icon: Users },
    { value: '40%', label: 'Productivity Boost', icon: TrendingUp }
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Header */}
      <div className="border-b border-border bg-muted/50 px-5 py-5 sm:px-8 sm:py-6">
        <div className="flex items-center gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              Complete activity tracking
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Real-time monitoring &amp; analytics for your development team
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-12">
          {/* Left Column */}
          <div>
            <p className="mb-8 leading-relaxed text-muted-foreground">
              Monitor everything from screenshots and application usage to visited URLs
              and activity scores. Get comprehensive reports with detailed insights.
            </p>

            {/* Monitoring Items Grid */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              {monitoringItems.map((item, index) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-muted/40 p-4 text-center transition-colors duration-150 hover:bg-muted"
                  >
                    <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <IconComponent className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat, index) => {
                const IconComponent = stat.icon;
                return (
                  <div key={index} className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
                    <IconComponent className="mx-auto mb-1.5 h-4 w-4 text-primary" aria-hidden="true" />
                    <div className="text-lg font-semibold tracking-tight text-foreground">{stat.value}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column */}
          <div>
            <h4 className="mb-5 text-base font-semibold tracking-tight text-foreground">
              Key monitoring features
            </h4>

            <ul className="space-y-1">
              {features.map((feature, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 rounded-lg p-2.5 transition-colors duration-150 hover:bg-muted"
                >
                  <CheckCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            {/* Feature Highlight */}
            <div className="mt-8 rounded-xl border border-border bg-muted/40 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Zap className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h5 className="text-sm font-medium text-foreground">AI-powered insights</h5>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Intelligent recommendations to improve team productivity and identify
                    bottlenecks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}