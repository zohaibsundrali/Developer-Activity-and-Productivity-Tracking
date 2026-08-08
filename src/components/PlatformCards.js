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
      ]
    },
    {
      icon: Laptop,
      title: 'Desktop Application',
      description: 'Lightweight desktop app for automatic developer tracking',
      features: [
        'One-click activity tracking',
        'AI productivity scoring',
        'Screenshot & app usage tracking'
      ]
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {platforms.map((platform, index) => {
        const IconComponent = platform.icon;
        return (
          <div
            key={index}
            className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-8"
          >
            <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconComponent className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {platform.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {platform.description}
            </p>
            <ul className="mt-6 space-y-3 border-t border-border pt-6">
              {platform.features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}