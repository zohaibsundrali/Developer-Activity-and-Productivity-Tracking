import { ArrowRight, Play, Sparkles, Zap, Users, BarChart3 } from 'lucide-react';

export default function HeroSection() {
  return (
    <section className="relative pt-20 pb-16 px-6 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-gray-50">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-200/20 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-200/20 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-100/10 rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-emerald-50/90 backdrop-blur-sm px-4 py-2 rounded-full mb-6 border border-emerald-200/50">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">AI-Powered Productivity Suite</span>
          </div>

          {/* Main Heading with gradient */}
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-black mb-6 leading-[1.1]">
            <span className="text-gray-900">Smart Developer</span>
            <br />
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Activity Tracking
            </span>
          </h1>
          
          <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10 font-light leading-relaxed">
            Transform developer activity tracking into actionable insights with 
            <span className="font-semibold text-gray-800"> AI-powered analytics</span> and 
            <span className="font-semibold text-gray-800"> real-time monitoring</span> for maximum team productivity.
          </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <a
              href="#platforms"
              className="group px-8 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold rounded-xl hover:shadow-xl hover:scale-[1.02] transition-all duration-300 shadow-lg shadow-emerald-600/25 flex items-center gap-2"
            >
              Explore Features
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="/admin/registration"
              className="group px-8 py-3.5 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:border-emerald-600 hover:text-emerald-600 hover:bg-emerald-50/50 transition-all duration-300 flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Watch Demo
            </a>
          </div>

          {/* Stats / Social Proof */}
          <div className="flex flex-wrap justify-center items-center gap-8 pt-6 border-t border-gray-200/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="font-bold text-gray-900">10K+</div>
                <div className="text-xs text-gray-500">Active Users</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <div className="font-bold text-gray-900">40%</div>
                <div className="text-xs text-gray-500">Productivity Boost</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <Zap className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="font-bold text-gray-900">4.9★</div>
                <div className="text-xs text-gray-500">User Rating</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}