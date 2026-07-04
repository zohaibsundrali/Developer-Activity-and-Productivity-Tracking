import { Globe, Laptop } from 'lucide-react';

export default function PlatformCards() {
  const platforms = [
    {
      icon: Globe,
      title: 'Web Dashboard',
      description: 'summary',
      features: [
        'Real-time activity monitoring',
        'Interactive reports & analytics',
        'Project Management System'
      ],
      color: 'green'
    },
    {
      icon: Laptop,
      title: 'Desktop Application',
      description: 'Lightweight desktop app for automatic developer tracking',
      features: [
        'One-click activity tracking',
        'AI productivity scoring',
        'Screenshot & app usage tracking'
      ],
      color: 'blue'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {platforms.map((platform, index) => {
        const IconComponent = platform.icon;
        return (
          <div key={index} className="bg-white rounded-xl p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
            <div className="flex justify-center mb-6">
              <IconComponent 
                className={`w-16 h-16 text-${platform.color}-500`}
                strokeWidth={1.5}
              />
            </div>
            <h3 className="text-2xl font-bold text-black mb-4 text-center">{platform.title}</h3>
            <p className="text-gray-600 mb-6 font-light text-center">
              {platform.description}
            </p>
            <ul className="space-y-3">
              {platform.features.map((feature, idx) => (
                <li key={idx} className="flex items-center">
                  <svg className={`w-5 h-5 text-${platform.color}-500 mr-3 flex-shrink-0`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}