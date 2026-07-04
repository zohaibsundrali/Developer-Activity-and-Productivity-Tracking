import { Clock, Check } from 'lucide-react';

export default function TimeTrackingSection() {
  const features = [
    {
      title: 'One-Click Timer',
      description: 'Start/stop tracking with a single click'
    },
    {
      title: 'Automated Tracking',
      description: 'Automatically tracks work hours and activities'
    },
    {
      title: 'AI-Powered Detection',
      description: 'Automatic activity categorization and insights'
    }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <h3 className="text-2xl font-bold text-black mb-6">Smart Time Management</h3>
        <p className="text-gray-600 mb-6 font-light leading-relaxed">
          Our AI automatically tracks work hours, categorizes activities, and provides 
          intelligent time insights. Use the desktop app for comprehensive time management.
        </p>
        
        <div className="space-y-4">
          {features.map((feature, index) => (
            <div key={index} className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4 mt-1">
                <Check className="w-4 h-4 text-blue-600" strokeWidth={2.5} />
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
          <div className="flex justify-center mb-6">
            <Clock className="w-20 h-20 text-blue-500" strokeWidth={1.5} />
          </div>
          <h4 className="text-2xl font-bold text-black mb-4">summary</h4>
          <p className="text-gray-600 font-light">
            Average time saved on manual tracking and reporting
          </p>
        </div>
      </div>
    </div>
  );
}