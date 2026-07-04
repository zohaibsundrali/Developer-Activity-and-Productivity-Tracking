import {
  Camera,
  BarChart3,
  Star,
  Globe,
  MousePointer,
  Monitor,
  Clock,
  FileText,
  Users,
  Activity,
  CheckCircle,
  TrendingUp,
  Shield,
  Zap,
  PieChart
} from 'lucide-react';

export default function EmployeeMonitoringSection() {
  const monitoringItems = [
    { icon: Camera, label: 'Screenshots', color: 'blue' },
    { icon: BarChart3, label: 'App Logs', color: 'purple' },
    { icon: Star, label: 'Activity Score', color: 'yellow' },
    { icon: Globe, label: 'Browser Tracking', color: 'green' }
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
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-8 py-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-xl">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Complete Activity Tracking</h3>
            <p className="text-gray-600 text-sm font-light">
              Real-time monitoring & analytics for your development team
            </p>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left Column */}
          <div>
            <p className="text-gray-600 mb-8 font-light leading-relaxed">
              Monitor everything from screenshots and application usage to visited URLs
              and activity scores. Get comprehensive reports with detailed insights.
            </p>

            {/* Monitoring Items Grid */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              {monitoringItems.map((item, index) => {
                const IconComponent = item.icon;
                const colorClasses = {
                  blue: 'bg-blue-50 text-blue-600 border-blue-200',
                  purple: 'bg-purple-50 text-purple-600 border-purple-200',
                  yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
                  green: 'bg-green-50 text-green-600 border-green-200'
                };
                return (
                  <div 
                    key={index} 
                    className={`${colorClasses[item.color]} p-4 rounded-xl border text-center transition-all hover:scale-[1.02] hover:shadow-md`}
                  >
                    <div className="flex justify-center mb-2">
                      <IconComponent className="w-8 h-8" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat, index) => {
                const IconComponent = stat.icon;
                return (
                  <div key={index} className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100">
                    <IconComponent className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                    <div className="text-lg font-bold text-gray-900">{stat.value}</div>
                    <div className="text-xs text-gray-500">{stat.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column */}
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="p-1.5 bg-green-100 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <h4 className="text-xl font-bold text-gray-900">Key Monitoring Features</h4>
            </div>
            
            <div className="space-y-3">
              {features.map((feature, index) => (
                <div 
                  key={index} 
                  className="flex items-start p-3 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-5 h-5 text-green-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="text-gray-700 ml-3 text-sm leading-relaxed">{feature}</span>
                </div>
              ))}
            </div>

            {/* Feature Highlight */}
            <div className="mt-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h5 className="font-bold text-gray-900 text-sm">AI-Powered Insights</h5>
                  <p className="text-gray-600 text-xs mt-1">
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