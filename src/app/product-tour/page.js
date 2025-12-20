'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ProductTour() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navItems = [
    { name: 'Overview', href: '/' },
    { name: 'Product Tour', href: '/product-tour' },
    { name: 'Desktop', href: '/desktop' },
    { name: 'Help', href: '/help' },
  ];

  return (
    <div className="min-h-screen bg-white text-black font-sans">
      {/* Navbar */}
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
                  <Link
                    key={item.name}
                    href={item.href}
                    className="text-gray-700 hover:text-blue-600 font-medium transition-colors duration-200 text-sm tracking-wide"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>

              {/* Sign In & Sign Up Buttons */}
              <div className="flex items-center space-x-4">
                <Link
                  href="/login"
                  className="px-5 py-2 text-gray-700 hover:text-blue-600 font-medium transition-colors text-sm border border-gray-300 rounded-lg hover:border-blue-500"
                >
                  Sign In
                </Link>
                <Link
                  href="/admin/registration"
                  className="px-5 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors text-sm rounded-lg shadow-sm"
                >
                  Sign Up
                </Link>
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
                  <Link
                    key={item.name}
                    href={item.href}
                    className="block px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {item.name}
                  </Link>
                ))}
                
                {/* Separator */}
                <div className="border-t border-gray-100 pt-2 mt-2 px-4">
                  
                  {/* Sign In */}
                  <Link
                    href="/login"
                    className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  
                  {/* Sign Up */}
                  <Link
                    href="/admin/registration"
                    className="block py-2 bg-blue-600 text-white text-center rounded-lg text-sm font-medium mt-2 hover:bg-blue-700"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign Up
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Product Tour Page Content */}
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 px-6 bg-gradient-to-b from-blue-50 to-white">
          <div className="container mx-auto max-w-6xl text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-black mb-6">
              Product Tour
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8 font-light">
              Discover how DevTrackAI transforms developer activity tracking into actionable insights
            </p>
          </div>
        </section>

        {/* Multi-Platform Support */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Web, Desktop, & Mobile Apps to Boost Productivity
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
              <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
                <div className="text-5xl mb-6 text-center">🌐</div>
                <h3 className="text-2xl font-bold text-black mb-4 text-center">Web Dashboard</h3>
                <p className="text-gray-600 text-center font-light mb-6">
                  Access comprehensive analytics from any browser
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Real-time team monitoring</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Customizable dashboards</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Interactive reports</span>
                  </li>
                </ul>
              </div>

              <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
                <div className="text-5xl mb-6 text-center">💻</div>
                <h3 className="text-2xl font-bold text-black mb-4 text-center">Desktop App</h3>
                <p className="text-gray-600 text-center font-light mb-6">
                  Automatic tracking with one-click timer
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>One-click time tracking</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Activity monitoring</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Screenshot capture</span>
                  </li>
                </ul>
              </div>

              <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
                <div className="text-5xl mb-6 text-center">📱</div>
                <h3 className="text-2xl font-bold text-black mb-4 text-center">Mobile App</h3>
                <p className="text-gray-600 text-center font-light mb-6">
                  Track offsite work with GPS features
                </p>
                <ul className="space-y-3">
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-purple-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>GPS route tracking</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-purple-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Mobile time tracking</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-purple-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Team insights</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Automated Time Tracking */}
        <section className="py-16 px-6 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Automated Time Tracking
            </h2>
            
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div>
                  <h3 className="text-2xl font-bold text-black mb-6">Efficient Time Management</h3>
                  <p className="text-gray-600 mb-6 font-light leading-relaxed">
                    Easily track time using customizable timesheets that include employee leave dates. 
                    Tailor fields to include, specifying which are mandatory and which should be visible only to managers.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                        <span className="text-blue-600 font-bold">1</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">Custom Fields</h4>
                        <p className="text-gray-600 text-sm">Add custom fields for specific needs</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                        <span className="text-blue-600 font-bold">2</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">Flexible Visibility</h4>
                        <p className="text-gray-600 text-sm">Control field visibility for managers</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                        <span className="text-blue-600 font-bold">3</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-black">Leave Integration</h4>
                        <p className="text-gray-600 text-sm">Include employee leave dates in timesheets</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-blue-50 rounded-xl p-8">
                  <h4 className="text-xl font-bold text-black mb-6">Key Benefits</h4>
                  <ul className="space-y-4">
                    <li className="flex items-start">
                      <svg className="w-6 h-6 text-green-500 mr-3 mt-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <span className="font-medium">Reduce manual effort</span>
                        <p className="text-gray-600 text-sm">Automate time tracking processes</p>
                      </div>
                    </li>
                    <li className="flex items-start">
                      <svg className="w-6 h-6 text-green-500 mr-3 mt-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <span className="font-medium">Improve accuracy</span>
                        <p className="text-gray-600 text-sm">Minimize human errors in time recording</p>
                      </div>
                    </li>
                    <li className="flex items-start">
                      <svg className="w-6 h-6 text-green-500 mr-3 mt-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <span className="font-medium">Save time</span>
                        <p className="text-gray-600 text-sm">40% average time saved on tracking</p>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Employee Monitoring */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Employee Monitoring
            </h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div>
                <h3 className="text-2xl font-bold text-black mb-6">Comprehensive Activity Tracking</h3>
                <p className="text-gray-600 mb-6 font-light">
                  Collect and analyze team activity data including time worked, screenshots, 
                  application usage logs, visited URLs, activity scores, and user activity timelines.
                </p>
                
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {[
                    { icon: '🖱️', title: 'Mouse Activity', desc: 'Track movements & clicks' },
                    { icon: '⌨️', title: 'Keyboard Input', desc: 'Monitor typing patterns' },
                    { icon: '📱', title: 'App Usage', desc: 'Track active applications' },
                    { icon: '🌐', title: 'Browser Activity', desc: 'Monitor visited URLs' }
                  ].map((item, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg">
                      <div className="text-2xl mb-2">{item.icon}</div>
                      <h4 className="font-bold text-black text-sm">{item.title}</h4>
                      <p className="text-gray-600 text-xs">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="text-2xl font-bold text-black mb-6">Advanced Features</h3>
                <div className="space-y-4">
                  <div className="bg-gray-50 p-5 rounded-xl">
                    <h4 className="font-bold text-black mb-2">GPS Location Tracking</h4>
                    <p className="text-gray-600 text-sm">
                      Monitor offsite team members like delivery agents or field staff
                    </p>
                  </div>
                  
                  <div className="bg-gray-50 p-5 rounded-xl">
                    <h4 className="font-bold text-black mb-2">Automated Reports</h4>
                    <p className="text-gray-600 text-sm">
                      Receive email reports with user activity, logged hours, wages, and vacation days
                    </p>
                  </div>
                  
                  <div className="bg-gray-50 p-5 rounded-xl">
                    <h4 className="font-bold text-black mb-2">Smart Notifications</h4>
                    <p className="text-gray-600 text-sm">
                      Get alerted when team members record fewer hours than required
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Leave Management */}
        <section className="py-16 px-6 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Leave Planner & Management
            </h2>
            
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="text-5xl mb-6">📅</div>
                  <h3 className="text-xl font-bold text-black mb-4">Leave Planning</h3>
                  <p className="text-gray-600 font-light">
                    Plan team leaves, create different leave types, and manage yearly allowances
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="text-5xl mb-6">✅</div>
                  <h3 className="text-xl font-bold text-black mb-4">Request/Approval</h3>
                  <p className="text-gray-600 font-light">
                    Streamlined leave request and approval workflow for team members
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="text-5xl mb-6">👥</div>
                  <h3 className="text-xl font-bold text-black mb-4">Team Calendar</h3>
                  <p className="text-gray-600 font-light">
                    Personal leave calendar to plan time off and view team availability
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Reports & Invoices */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Time Reports & Invoices
            </h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div>
                <h3 className="text-2xl font-bold text-black mb-6">Generate Reports</h3>
                <ul className="space-y-4">
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Generate time worked reports from timesheets</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Select fields to include in reports</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Group rows by client or project</span>
                  </li>
                </ul>
              </div>
              
              <div>
                <h3 className="text-2xl font-bold text-black mb-6">Manage Invoices</h3>
                <ul className="space-y-4">
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Create and send invoices to clients</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Track payments in multiple currencies</span>
                  </li>
                  <li className="flex items-center">
                    <svg className="w-5 h-5 text-blue-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Export reports to PDF or Excel</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Project Management */}
        <section className="py-16 px-6 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Project Management
            </h2>
            
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div>
                  <h3 className="text-2xl font-bold text-black mb-6">Project Planning</h3>
                  <ul className="space-y-4">
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>Create work breakdown structure (WBS)</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>Estimate tasks and total budget</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>Compare estimated vs actual time spent</span>
                    </li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-2xl font-bold text-black mb-6">Budget Tracking</h3>
                  <ul className="space-y-4">
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>Match estimated budget with actual spending</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>View daily time statistics</span>
                    </li>
                    <li className="flex items-start">
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span>Track project expenses and milestones</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Gamification */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Gamification
            </h2>
            
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-8 border border-blue-100">
              <div className="text-center mb-8">
                <div className="text-6xl mb-6">🎮</div>
                <h3 className="text-2xl font-bold text-black mb-4">Play the Time Tracking Game</h3>
                <p className="text-gray-600 text-lg font-light">
                  Let your team earn achievements with fun badges for reaching goals
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-white p-6 rounded-xl text-center">
                  <div className="text-4xl mb-4">🏆</div>
                  <h4 className="text-xl font-bold text-black mb-3">Achievements</h4>
                  <p className="text-gray-600 font-light">
                    Earn cool achievements and funny badges
                  </p>
                </div>
                
                <div className="bg-white p-6 rounded-xl text-center">
                  <div className="text-4xl mb-4">⚡</div>
                  <h4 className="text-xl font-bold text-black mb-3">Motivation</h4>
                  <p className="text-gray-600 font-light">
                    Grow team motivation and engagement
                  </p>
                </div>
                
                <div className="bg-white p-6 rounded-xl text-center">
                  <div className="text-4xl mb-4">🎁</div>
                  <h4 className="text-xl font-bold text-black mb-3">Rewards</h4>
                  <p className="text-gray-600 font-light">
                    Get perks for reaching karma points
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 px-6 bg-gradient-to-b from-white to-gray-50">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold text-black mb-6">
              Ready to Boost Your Team's Productivity?
            </h2>
            <p className="text-gray-600 text-lg mb-8 font-light">
              Join thousands of companies already using DevTrackAI
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/admin/registration"
                className="px-8 py-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all shadow-lg"
              >
                Start Free Trial
              </Link>
              <Link
                href="/login"
                className="px-8 py-4 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50 transition-all"
              >
                Sign In
              </Link>
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
              <Link href="/" className="text-gray-300 hover:text-white text-sm font-medium">
                Overview
              </Link>
              <Link href="/product-tour" className="text-white text-sm font-medium">
                Product Tour
              </Link>
              <Link href="/desktop" className="text-gray-300 hover:text-white text-sm font-medium">
                Desktop
              </Link>
              <Link href="/help" className="text-gray-300 hover:text-white text-sm font-medium">
                Help
              </Link>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-500 text-sm">
              &copy; 2025 DevTrackAI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}