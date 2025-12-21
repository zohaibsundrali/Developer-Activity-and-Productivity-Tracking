export default function HeroSection() {
  return (
    <section className="pt-16 pb-12 px-6 bg-gradient-to-b from-blue-50 to-white">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-black mb-6 leading-tight">
            Product Tour
          </h1>
          
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8 font-light leading-relaxed">
            Discover how our AI-powered platform transforms developer activity tracking 
            into actionable insights for maximum productivity.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#platforms"
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
            >
              Explore Features
            </a>
            <a
              href="/admin/registration"
              className="px-8 py-3 border-2 border-blue-600 text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition-all"
            >
              Try Free Demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}