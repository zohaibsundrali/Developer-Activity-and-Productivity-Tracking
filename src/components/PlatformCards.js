import { Globe, Laptop, Check } from 'lucide-react';

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
      color: '#0c8f6e'
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
      color: '#0c8f6e'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {platforms.map((platform, index) => {
        const IconComponent = platform.icon;
        return (
          <div key={index} className="bg-card rounded-xl p-8 shadow-card border border-border hover:shadow-elevated transition-shadow duration-300">
            <div className="flex justify-center mb-6">
             <IconComponent
  className="w-16 h-16 text-primary"
  strokeWidth={1.5}
/>
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-4 text-center">{platform.title}</h3>
            <p className="text-muted-foreground mb-6 font-light text-center">
              {platform.description}
            </p>
            <ul className="space-y-3">
              {platform.features.map((feature, idx) => (
                <li key={idx} className="flex items-center">
                  <Check className="w-5 h-5 text-primary mr-3 flex-shrink-0" strokeWidth={2.5} />
                  <span className="text-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}