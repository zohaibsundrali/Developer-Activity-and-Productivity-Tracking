export default function CTASection() {
  return (
    <div className="text-center mt-20">
      <div className="inline-block bg-gradient-to-r from-blue-50 to-purple-50 p-12 rounded-3xl shadow-xl border border-blue-100 max-w-4xl">
        <h3 className="text-3xl font-bold text-black mb-6">Ready to Transform Your Development Process?</h3>
        <p className="text-gray-600 mb-8 text-lg font-light">
          Join thousands of development teams using our AI-powered platform to boost productivity
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="/admin/registration"
            className="px-10 py-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-1"
          >
            Start 14-Day Free Trial
          </a>
          <a
            href="/login"
            className="px-10 py-4 bg-white text-blue-600 font-bold rounded-lg border-2 border-blue-600 hover:bg-blue-50 transition-all"
          >
            Sign In to Dashboard
          </a>
        </div>
        <p className="text-gray-500 text-sm mt-8 font-light">
          No credit card required • Full feature access • Cancel anytime
        </p>
      </div>
    </div>
  );
}