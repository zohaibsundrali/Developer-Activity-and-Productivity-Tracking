export default function EmployeeMonitoringSection() {
  const monitoringItems = [
    { icon: '📸', label: 'Screenshots' },
    { icon: '📊', label: 'App Logs' },
    { icon: '⭐', label: 'Activity Score' },
    { icon: '🔗', label: 'URL Tracking' }
  ];

  const features = [
    'Real-time activity timelines and user behavior analysis',
    'GPS location tracking for offsite team members',
    'Automated email reports with detailed insights',
    'Notifications for low activity or missed hours'
  ];

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div>
          <h3 className="text-2xl font-bold text-black mb-6">Complete Activity Tracking</h3>
          <p className="text-gray-600 mb-6 font-light leading-relaxed">
            Monitor everything from screenshots and application usage to visited URLs 
            and activity scores. Get comprehensive reports via email with detailed insights.
          </p>
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            {monitoringItems.map((item, index) => (
              <div key={index} className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-2xl mb-2">{item.icon}</div>
                <p className="text-sm font-medium text-gray-800">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
        
        <div>
          <h4 className="text-xl font-bold text-black mb-6">Key Monitoring Features</h4>
          <div className="space-y-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-3 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}