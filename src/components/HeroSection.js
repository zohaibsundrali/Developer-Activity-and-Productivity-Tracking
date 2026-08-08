import { ArrowRight, BarChart3, Sparkles, Users, Zap } from 'lucide-react';

const stats = [
  { icon: Users, value: '10K+', label: 'Active users' },
  { icon: BarChart3, value: '40%', label: 'Productivity boost' },
  { icon: Zap, value: '4.9★', label: 'Average rating' },
];

export default function HeroSection() {
  return (
    <section className="bg-muted/30 py-20 lg:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            AI-powered productivity suite
          </p>

          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
            Smart developer
            <br />
            <span className="text-primary">activity tracking</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Turn raw developer activity into decisions you can defend — automatic time capture,
            real-time monitoring and reports your team will actually read.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/admin/registration"
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
            >
              Start for free
              <ArrowRight
                className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden="true"
              />
            </a>
            <a
              href="#platforms"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-card px-7 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
            >
              See how it works
            </a>
          </div>
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {stats.map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex items-center gap-3 bg-card px-6 py-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-lg font-semibold tracking-tight text-foreground">
                  {value}
                </span>
                <span className="block text-xs text-muted-foreground">{label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
