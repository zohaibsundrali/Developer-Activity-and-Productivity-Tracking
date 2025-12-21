export default function TimeTrackingSection() {
  const features = [
    {
      title: 'One-Click Timer',
      description: 'Start/stop tracking with a single click'
    },
    {
      title: 'Customizable Timesheets',
      description: 'Tailor fields and visibility for your team'
    },
    {
      title: 'AI-Powered Detection',
      description: 'Automatic activity categorization'
    }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <h3 className="text-2xl font-bold text-black mb-6">Smart Time Management</h3>
        <p className="text-gray-600 mb-6 font-light leading-relaxed">
          Our AI automatically tracks work hours, categorizes activities, and provides 
          intelligent time insights. Use the desktop app's one-click timer or mobile 
          app's GPS tracking for comprehensive time management.
        </p>
        
        <div className="space-y-4">
          {features.map((feature, index) => (
            <div key={index} className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4 mt-1">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h4 className="font-bold text-black">{feature.title}</h4>
                <p className="text-gray-600 text-sm">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-blue-50 to-gray-50 rounded-2xl p-8">
        <div className="text-center">
          <div className="text-6xl mb-6">⏱️</div>
          <h4 className="text-2xl font-bold text-black mb-4">Save 40% Time</h4>
          <p className="text-gray-600 font-light">
            Average time saved on manual tracking and reporting
          </p>
        </div>
      </div>
    </div>
  );
}