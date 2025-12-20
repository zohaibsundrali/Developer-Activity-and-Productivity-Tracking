'use client';

import Navbar from '@/components/Navbar';
import { useState } from 'react';

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navItems = [
    { name: 'Overview', href: '/' },
    { name: 'Product Tour', href: '/product-tour' },
    { name: 'Desktop', href: '/time-tracking-desktop-application' },
    { name: 'Help', href: '#help' },
  ];

  return (
    <div className="min-h-screen bg-white text-black font-sans">
      {/* Navbar */}
      <Navbar/>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            
            {/* Left Side: Brand Name */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">DA</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-black">
                  DevTrack<span className="text-blue-600">AI</span>
                </h1>
                <p className="text-xs text-gray-500 font-light">
                  Developer Activity & Productivity Tracking
                </p>
              </div>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-12">
              
              {/* Navigation Menu */}
              <div className="flex items-center space-x-8">
                {navItems.map((item) => (
                  <a
                    key={item.name}
                    href={item.href}
                    className="text-gray-700 hover:text-blue-600 font-medium transition-colors duration-200 text-sm tracking-wide"
                  >
                    {item.name}
                  </a>
                ))}
              </div>

              {/* Sign In & Sign Up Buttons */}
              <div className="flex items-center space-x-4">
                <a
                  href="/login"
                  className="px-5 py-2 text-gray-700 hover:text-blue-600 font-medium transition-colors text-sm border border-gray-300 rounded-lg hover:border-blue-500"
                >
                  Sign In
                </a>
                <a
                  href="/admin/registration"
                  className="px-5 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors text-sm rounded-lg shadow-sm"
                >
                  Sign Up
                </a>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-md text-gray-700 hover:text-blue-600"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          {isMenuOpen && (
            <div className="md:hidden bg-white border-t border-gray-100 mt-4">
              <div className="py-3 space-y-1">
                
                {/* Navigation Items */}
                {navItems.map((item) => (
                  <a
                    key={item.name}
                    href={item.href}
                    className="block px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {item.name}
                  </a>
                ))}
                
                {/* Separator */}
                <div className="border-t border-gray-100 pt-2 mt-2 px-4">
                  
                  {/* Sign In */}
                  <a
                    href="/login"
                    className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign In
                  </a>
                  
                  {/* Sign Up */}
                  <a
                    href="/admin/registration"
                    className="block py-2 bg-blue-600 text-white text-center rounded-lg text-sm font-medium mt-2 hover:bg-blue-700"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign Up
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content - Product Tour Page */}
      <main className="pt-20">
        {/* Hero Section for Product Tour */}
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

        {/* Product Tour Content */}
        <section id="product-tour" className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            
            {/* Platforms Section */}
            <div id="platforms" className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-black mb-4">
                  Web, Desktop, & Mobile Apps
                </h2>
                <p className="text-gray-600 text-lg max-w-3xl mx-auto font-light">
                  Boost productivity across all platforms with our integrated suite
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Web App */}
                <div className="bg-white rounded-xl p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
                  <div className="text-5xl mb-6 text-center">🌐</div>
                  <h3 className="text-2xl font-bold text-black mb-4 text-center">Web Dashboard</h3>
                  <p className="text-gray-600 mb-6 font-light text-center">
                    Access real-time insights and analytics from any browser
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Real-time activity monitoring</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Interactive reports & analytics</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Team management dashboard</span>
                    </li>
                  </ul>
                </div>
                
                {/* Desktop App */}
                <div className="bg-white rounded-xl p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
                  <div className="text-5xl mb-6 text-center">💻</div>
                  <h3 className="text-2xl font-bold text-black mb-4 text-center">Desktop Application</h3>
                  <p className="text-gray-600 mb-6 font-light text-center">
                    Lightweight desktop app for automatic developer tracking
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">One-click activity tracking</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">AI productivity scoring</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Screenshot & app usage tracking</span>
                    </li>
                  </ul>
                </div>
                
                {/* Mobile App */}
                <div className="bg-white rounded-xl p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
                  <div className="text-5xl mb-6 text-center">📱</div>
                  <h3 className="text-2xl font-bold text-black mb-4 text-center">Mobile Application</h3>
                  <p className="text-gray-600 mb-6 font-light text-center">
                    Track offsite activities with GPS and mobile features
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-purple-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">GPS location tracking</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-purple-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Mobile time tracking</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-purple-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700">Team activity insights</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Automated Time Tracking */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-black mb-4">Automated Time Tracking</h2>
                <p className="text-gray-600 text-lg max-w-3xl mx-auto font-light">
                  Easily track time using our intelligent platform across all devices
                </p>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div>
                  <h3 className="text-2xl font-bold text-black mb-6">Smart Time Management</h3>
                  <p className="text-gray-600 mb-6 font-light leading-relaxed">
                    Our AI automatically tracks work hours, categorizes activities, and provides 
                    intelligent time insights. Use the desktop app's one-click timer or mobile 
                    app's GPS tracking for comprehensive time management.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4 mt-1">
                        <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">One-Click Timer</h4>
                        <p className="text-gray-600 text-sm">Start/stop tracking with a single click</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4 mt-1">
                        <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">Customizable Timesheets</h4>
                        <p className="text-gray-600 text-sm">Tailor fields and visibility for your team</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4 mt-1">
                        <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">AI-Powered Detection</h4>
                        <p className="text-gray-600 text-sm">Automatic activity categorization</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gradient-to-br from-blue-50 to-gray-50 rounded-2xl p-8">
                  <div className="text-center">
                    <div className="text-6xl mb-6">⏱️</div>
                    <h4 className="text-2xl font-bold text-black mb-4">Save 40% Time</h4>
                    <p className="text-gray-600 font-light">
                      Average time saved on manual tracking and reporting
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Employee Monitoring */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-black mb-4">Employee Monitoring</h2>
                <p className="text-gray-600 text-lg max-w-3xl mx-auto font-light">
                  Collect and analyze team activity data with comprehensive insights
                </p>
              </div>
              
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div>
                    <h3 className="text-2xl font-bold text-black mb-6">Complete Activity Tracking</h3>
                    <p className="text-gray-600 mb-6 font-light leading-relaxed">
                      Monitor everything from screenshots and application usage to visited URLs 
                      and activity scores. Get comprehensive reports via email with detailed insights.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-4 mb-8">
                      {[
                        { icon: '📸', label: 'Screenshots' },
                        { icon: '📊', label: 'App Logs' },
                        { icon: '⭐', label: 'Activity Score' },
                        { icon: '🔗', label: 'URL Tracking' }
                      ].map((item, index) => (
                        <div key={index} className="bg-gray-50 p-4 rounded-lg text-center">
                          <div className="text-2xl mb-2">{item.icon}</div>
                          <p className="text-sm font-medium text-gray-800">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-xl font-bold text-black mb-6">Key Monitoring Features</h4>
                    <div className="space-y-4">
                      {[
                        'Real-time activity timelines and user behavior analysis',
                        'GPS location tracking for offsite team members',
                        'Automated email reports with detailed insights',
                        'Notifications for low activity or missed hours'
                      ].map((feature, index) => (
                        <div key={index} className="flex items-start">
                          <svg className="w-5 h-5 text-green-500 mr-3 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-700">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Project Management & Reports */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-black mb-4">Project Management & Reports</h2>
                <p className="text-gray-600 text-lg max-w-3xl mx-auto font-light">
                  Create project plans, generate reports, and track expenses efficiently
                </p>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
                  <h3 className="text-2xl font-bold text-black mb-6">Project Planning</h3>
                  <p className="text-gray-600 mb-6 font-light">
                    Create work breakdown structures, estimate tasks, and track actual vs. 
                    estimated time and budget.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <span className="text-gray-700">Task Estimation</span>
                      <span className="font-bold text-green-600">✓ Included</span>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <span className="text-gray-700">Budget Tracking</span>
                      <span className="font-bold text-green-600">✓ Included</span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <span className="text-gray-700">Time vs Estimate Analysis</span>
                      <span className="font-bold text-green-600">✓ Included</span>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
                  <h3 className="text-2xl font-bold text-black mb-6">Reports & Invoices</h3>
                  <p className="text-gray-600 mb-6 font-light">
                    Generate professional reports and invoices with multiple export options.
                  </p>
                  
                  <div className="space-y-4">
                    {[
                      'Customizable time reports with grouping options',
                      'Invoice generation with payment tracking',
                      'Export to PDF/Excel with custom formatting',
                      'Multi-currency support for global teams'
                    ].map((item, index) => (
                      <div key={index} className="flex items-center">
                        <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span className="text-gray-700">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* CTA Section */}
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
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-8 md:mb-0">
              <h2 className="text-2xl font-bold mb-2">
                DevTrack<span className="text-blue-400">AI</span>
              </h2>
              <p className="text-gray-400 text-sm">
                Developer Activity & Productivity Tracking with AI
              </p>
            </div>
            
            <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-8">
              <a href="#platforms" className="text-gray-300 hover:text-white text-sm font-medium">Platforms</a>
              <a href="#features" className="text-gray-300 hover:text-white text-sm font-medium">Features</a>
              <a href="#monitoring" className="text-gray-300 hover:text-white text-sm font-medium">Monitoring</a>
              <a href="#reports" className="text-gray-300 hover:text-white text-sm font-medium">Reports</a>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-500 text-sm">
              &copy; 2025 DevTrackAI. All rights reserved.
            </p>
            <p className="text-gray-600 text-xs mt-2 font-light">
              Developer Activity & Productivity Tracking with AI
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}