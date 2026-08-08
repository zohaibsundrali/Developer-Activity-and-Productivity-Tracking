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
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          Smart time management
        </h3>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          Our AI automatically tracks work hours, categorizes activities, and provides 
          intelligent time insights. Use the desktop app for comprehensive time management.
        </p>
        
        <div className="mt-8 space-y-6">
          {features.map((feature, index) => (
            <div key={index} className="flex items-start gap-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div>
                <h4 className="text-sm font-medium text-foreground">{feature.title}</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card sm:p-12">
        <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Clock className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="text-4xl font-semibold tracking-tight text-foreground">summary</p>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Average time saved on manual tracking and reporting
        </p>
      </div>
    </div>
  );
}