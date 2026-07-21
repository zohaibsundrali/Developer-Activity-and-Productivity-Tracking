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
    { icon: Camera, label: 'Screenshots', color: '#0c8f6e' },
    { icon: BarChart3, label: 'App Logs', color: '#0c8f6e' },
    { icon: Star, label: 'Activity Score', color: '#0c8f6e' },
    { icon: Globe, label: 'Browser Tracking', color: '#0c8f6e' }
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
    <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 px-8 py-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-xl">
            <Activity className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-foreground">Complete Activity Tracking</h3>
            <p className="text-muted-foreground text-sm font-light">
              Real-time monitoring & analytics for your development team
            </p>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left Column */}
          <div>
            <p className="text-muted-foreground mb-8 font-light leading-relaxed">
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
  className="p-4 rounded-xl border border-primary/20 bg-primary/5 text-primary text-center transition-all hover:scale-[1.02] hover:shadow-card"
>
  <div className="flex justify-center mb-2">
    <IconComponent
      className="w-8 h-8 text-primary"
      strokeWidth={1.5}
    />
  </div>

  <p className="text-sm font-semibold">{item.label}</p>
</div>
                );
              })}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat, index) => {
                const IconComponent = stat.icon;
                return (
                  <div key={index} className="shadow-card rounded-xl p-4 text-center border border-border bg-card">
                    <IconComponent className="w-5 h-5 text-primary mx-auto mb-1" />
                    <div className="text-lg font-bold text-foreground">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column */}
          <div>
            <div className="flex items-center gap-2 mb-6">
              
              <h4 className="text-xl font-bold text-foreground">Key Monitoring Features</h4>
            </div>

            <div className="space-y-3">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="flex items-start p-3 rounded-lg hover:bg-muted transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="text-foreground ml-3 text-sm leading-relaxed">{feature}</span>
                </div>
              ))}
            </div>

            {/* Feature Highlight */}
            <div className="mt-8 bg-primary/5 rounded-xl p-5 border border-primary/20">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary rounded-lg">
                  <Zap className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h5 className="font-bold text-foreground text-sm">AI-Powered Insights</h5>
                  <p className="text-muted-foreground text-xs mt-1">
                    Get intelligent recommendations to improve team productivity and identify bottlenecks
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