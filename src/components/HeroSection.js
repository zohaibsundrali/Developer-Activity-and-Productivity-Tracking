import { ArrowRight, Play, Sparkles, Zap, Users, BarChart3 } from 'lucide-react';

export default function HeroSection() {
  return (
    <section className="relative pt-20 pb-16 px-6 overflow-hidden bg-muted/50">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary/10 backdrop-blur-sm px-4 py-2 rounded-full mb-6 border border-primary/20">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">AI-Powered Productivity Suite</span>
          </div>

          {/* Main Heading */}
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-black mb-6 leading-[1.1] tracking-tight">
            <span className="text-foreground">Smart Developer</span>
            <br />
            <span className="text-primary">
              Activity Tracking
            </span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 font-light leading-relaxed">
            Transform developer activity tracking into actionable insights with
            <span className="font-semibold text-foreground"> AI-powered analytics</span> and
            <span className="font-semibold text-foreground"> real-time monitoring</span> for maximum team productivity.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <a
              href="#platforms"
              className="group inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 shadow-card"
            >
              Explore Features
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="/admin/registration"
              className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-8 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Play className="w-4 h-4" />
              Watch Demo
            </a>
          </div>

          {/* Stats / Social Proof */}
          <div className="flex flex-wrap justify-center items-center gap-8 pt-6 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-bold text-foreground">10K+</div>
                <div className="text-xs text-muted-foreground">Active Users</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-info/10 rounded-full flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-info" />
              </div>
              <div>
                <div className="font-bold text-foreground">40%</div>
                <div className="text-xs text-muted-foreground">Productivity Boost</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warning/10 rounded-full flex items-center justify-center">
                <Zap className="w-5 h-5 text-warning" />
              </div>
              <div>
                <div className="font-bold text-foreground">4.9★</div>
                <div className="text-xs text-muted-foreground">User Rating</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}