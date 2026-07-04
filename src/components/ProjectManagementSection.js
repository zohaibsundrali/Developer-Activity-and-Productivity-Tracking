import {
  ClipboardList,
  Clock,
  TrendingUp,
  BarChart3,
  Calendar,
  FileText,
  Download,
  Filter,
  CheckCircle,
  AlertCircle,
  PieChart,
  Users,
  Target,
  Rocket,
  Award,
  Eye,
  FileCheck,
  Printer,
  Mail,
  Settings
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
            green: 'bg-green-50 text-green-600 border-green-200',
            blue: 'bg-blue-50 text-blue-600 border-blue-200',
            yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
            purple: 'bg-purple-50 text-purple-600 border-purple-200'
          };
          return (
            <div 
              key={index} 
              className={`${colorClasses[stat.color]} rounded-xl p-4 border text-center transition-all hover:scale-[1.02] hover:shadow-md`}
            >
              <IconComponent className="w-6 h-6 mx-auto mb-2" />
              <div className="text-xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-600">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Project Planning Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden hover:shadow-2xl transition-shadow duration-300">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-xl">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Project Planning</h3>
                <p className="text-gray-600 text-sm font-light">
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
                    className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                        <IconComponent className="w-4 h-4 text-blue-600" />
                      </div>
                      <span className="text-gray-700 font-medium">{feature.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="text-xs font-semibold text-green-600">Included</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Progress Bar */}
            <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">Overall Progress</span>
                <span className="text-sm font-bold text-blue-600">72%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full w-[72%]"></div>
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>Started: 8 tasks</span>
                <span>Completed: 18 tasks</span>
                <span>Remaining: 7 tasks</span>
              </div>
            </div>
          </div>
        </div>

        {/* Reports & Invoices Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden hover:shadow-2xl transition-shadow duration-300">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 rounded-xl">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Reports & Invoices</h3>
                <p className="text-gray-600 text-sm font-light">
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
                  className="flex items-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-5 h-5 text-purple-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="text-gray-700 ml-3 text-sm leading-relaxed">{item}</span>
                </div>
              ))}
            </div>

            {/* Export Options */}
            <div className="mt-6">
              <h5 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export Options
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {exportOptions.map((option, index) => {
                  const IconComponent = option.icon;
                  const colorClasses = {
                    red: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100',
                    green: 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100',
                    blue: 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100',
                    purple: 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'
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
            <div className="mt-6 pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Recent Activity
                </h5>
                <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                  View All
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Report generated for Q4 2024</span>
                  <span className="text-gray-400">2 min ago</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Invoice #INV-2024-042 sent</span>
                  <span className="text-gray-400">1 hour ago</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Weekly productivity report</span>
                  <span className="text-gray-400">3 hours ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}