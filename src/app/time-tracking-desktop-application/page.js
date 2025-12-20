'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function DesktopAppPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState('timer');

  const navItems = [
    { name: 'Overview', href: '/' },
    { name: 'Product Tour', href: '/product-tour' },
    { name: 'Desktop', href: '/time-tracking-desktop-application' },
    { name: 'Help', href: '/help' },
  ];

  const features = [
    {
      id: 'timer',
      title: 'One-Click Timer',
      description: 'Start tracking with one click. Automatic pause/resume based on activity.',
      icon: '⏱️'
    },
    {
      id: 'activity',
      title: 'Activity Monitoring',
      description: 'Track mouse, keyboard, apps, and URLs automatically.',
      icon: '📊'
    },
    {
      id: 'timeline',
      title: 'Interactive Timeline',
      description: 'Visual timeline for editing and managing time entries.',
      icon: '📅'
    },
    {
      id: 'screenshots',
      title: 'Screenshot Capture',
      description: 'Automatic screenshots with privacy controls.',
      icon: '📸'
    },
    {
      id: 'analytics',
      title: 'Daily Analytics',
      description: 'Productive vs unproductive time analysis with alerts.',
      icon: '📈'
    }
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
                    className={`font-medium transition-colors duration-200 text-sm tracking-wide ${
                      item.name === 'Desktop' 
                        ? 'text-blue-600 font-bold' 
                        : 'text-gray-700 hover:text-blue-600'
                    }`}
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
                    className={`block px-4 py-2 hover:bg-gray-50 text-sm font-medium ${
                      item.name === 'Desktop' 
                        ? 'text-blue-600 font-bold' 
                        : 'text-gray-700 hover:text-blue-600'
                    }`}
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

      {/* Main Content */}
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 px-6 bg-gradient-to-b from-blue-50 to-white">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-black mb-6">
                Desktop Application
              </h1>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto font-light">
                Automated time tracking based on AI-powered activity monitoring
              </p>
            </div>

            {/* Download CTA */}
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200 max-w-3xl mx-auto mb-16">
              <div className="text-center">
                <div className="text-5xl mb-6">💻</div>
                <h2 className="text-2xl font-bold text-black mb-4">Free Download</h2>
                <p className="text-gray-600 mb-8 font-light">
                  Download our lightweight desktop app for Windows, macOS, and Linux
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download for Windows
                  </button>
                  <button className="px-8 py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50 transition-all">
                    View All Downloads
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Overview */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              Key Features
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-12">
              {features.map((feature) => (
                <button
                  key={feature.id}
                  onClick={() => setActiveFeature(feature.id)}
                  className={`p-4 rounded-xl transition-all ${
                    activeFeature === feature.id
                      ? 'bg-blue-600 text-white shadow-lg transform -translate-y-1'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="text-2xl mb-2">{feature.icon}</div>
                  <h3 className="font-bold text-sm">{feature.title}</h3>
                </button>
              ))}
            </div>

            {/* Feature Details */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 mb-16">
              {activeFeature === 'timer' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                  <div>
                    <h3 className="text-2xl font-bold text-black mb-6">One-Click Timer</h3>
                    <p className="text-gray-600 mb-6 font-light leading-relaxed">
                      Start tracking with a single click. The timer automatically pauses when you're 
                      away or inactive, and resumes when you return to work.
                    </p>
                    <ul className="space-y-4">
                      <li className="flex items-center">
                        <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Automatic pause/resume based on activity detection</span>
                      </li>
                      <li className="flex items-center">
                        <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Minimal system resource usage</span>
                      </li>
                      <li className="flex items-center">
                        <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Tray icon for quick access and control</span>
                      </li>
                    </ul>
                  </div>
                  <div className="bg-gray-900 rounded-xl p-6">
                    <div className="text-white font-mono text-sm space-y-4">
                      <div className="flex items-center space-x-2 mb-4">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      </div>
                      <div className="bg-gray-800 p-4 rounded-lg">
                        <div className="text-green-400">Timer Status: <span className="text-white">ACTIVE</span></div>
                        <div className="text-gray-400 text-xs mt-1">Tracking since: 8:58 AM</div>
                      </div>
                      <div className="bg-gray-800 p-4 rounded-lg">
                        <div className="text-blue-400">Current Session: <span className="text-white">2h 45m</span></div>
                        <div className="text-gray-400 text-xs mt-1">Productivity Score: 87%</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeFeature === 'activity' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div>
                    <h3 className="text-2xl font-bold text-black mb-6">Activity Monitoring</h3>
                    <p className="text-gray-600 mb-6 font-light">
                      Track user activity timeline, used applications, visited URLs, and take 
                      automatic screenshots for comprehensive monitoring.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="text-lg mb-2">📱</div>
                        <h4 className="font-bold text-black">App Usage</h4>
                        <p className="text-gray-600 text-sm">Track all running applications</p>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg">
                        <div className="text-lg mb-2">🌐</div>
                        <h4 className="font-bold text-black">URL Tracking</h4>
                        <p className="text-gray-600 text-sm">Monitor visited websites</p>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="text-lg mb-2">🖱️</div>
                        <h4 className="font-bold text-black">Mouse Activity</h4>
                        <p className="text-gray-600 text-sm">Track clicks and movements</p>
                      </div>
                      <div className="bg-orange-50 p-4 rounded-lg">
                        <div className="text-lg mb-2">⌨️</div>
                        <h4 className="font-bold text-black">Keyboard Input</h4>
                        <p className="text-gray-600 text-sm">Monitor typing patterns</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 rounded-xl p-6">
                    <h4 className="text-xl font-bold text-black mb-4">Activity Statistics</h4>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-700">VS Code</span>
                          <span className="font-bold">3h 22m</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: '80%' }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-700">Chrome</span>
                          <span className="font-bold">2h 45m</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: '65%' }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-700">Terminal</span>
                          <span className="font-bold">1h 30m</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-full" style={{ width: '35%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeFeature === 'timeline' && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-bold text-black">Interactive Timeline</h3>
                  
                  <div className="bg-gray-900 rounded-xl p-6">
                    <div className="text-white font-mono text-sm">
                      <div className="flex items-center space-x-2 mb-6">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      </div>
                      
                      {/* Timeline Visualization */}
                      <div className="space-y-4">
                        <div className="flex items-center">
                          <div className="w-24 text-gray-400">08:00</div>
                          <div className="flex-1 h-8 bg-blue-600 rounded-lg"></div>
                          <div className="ml-4 text-sm">Project Planning</div>
                        </div>
                        <div className="flex items-center">
                          <div className="w-24 text-gray-400">10:00</div>
                          <div className="flex-1 h-8 bg-green-600 rounded-lg"></div>
                          <div className="ml-4 text-sm">Development</div>
                        </div>
                        <div className="flex items-center">
                          <div className="w-24 text-gray-400">12:00</div>
                          <div className="flex-1 h-8 bg-gray-600 rounded-lg"></div>
                          <div className="ml-4 text-sm">Lunch Break</div>
                        </div>
                        <div className="flex items-center">
                          <div className="w-24 text-gray-400">13:00</div>
                          <div className="flex-1 h-8 bg-purple-600 rounded-lg"></div>
                          <div className="ml-4 text-sm">Code Review</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-gray-50 p-6 rounded-xl">
                      <h4 className="font-bold text-black mb-3">Manual Time Entry</h4>
                      <p className="text-gray-600 text-sm">
                        Select periods on timeline by dragging or enter times manually
                      </p>
                    </div>
                    <div className="bg-gray-50 p-6 rounded-xl">
                      <h4 className="font-bold text-black mb-3">Edit & Adjust</h4>
                      <p className="text-gray-600 text-sm">
                        Drag borders of time ranges to adjust recorded periods
                      </p>
                    </div>
                    <div className="bg-gray-50 p-6 rounded-xl">
                      <h4 className="font-bold text-black mb-3">Custom Fields</h4>
                      <p className="text-gray-600 text-sm">
                        Add or remove standard and custom fields in time entries
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeFeature === 'screenshots' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div>
                    <h3 className="text-2xl font-bold text-black mb-6">Smart Screenshot Capture</h3>
                    <p className="text-gray-600 mb-6 font-light">
                      Automatic screenshot capture with intelligent intervals and privacy controls. 
                      All screenshots are securely stored in the cloud.
                    </p>
                    
                    <div className="space-y-4">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                          <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-bold text-black">Random Intervals</h4>
                          <p className="text-gray-600 text-sm">Screenshots taken at varied intervals</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-4">
                          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-bold text-black">Privacy Protection</h4>
                          <p className="text-gray-600 text-sm">Blur sensitive information automatically</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                          <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-bold text-black">Cloud Storage</h4>
                          <p className="text-gray-600 text-sm">Secure cloud storage with encryption</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 rounded-xl p-8 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-6xl mb-6">📸</div>
                      <p className="text-gray-600 font-light">
                        Smart screenshot management with AI analysis
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeFeature === 'analytics' && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-bold text-black">Daily Analytics & Alerts</h3>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div>
                      <h4 className="text-xl font-bold text-black mb-6">Productivity Analysis</h4>
                      <p className="text-gray-600 mb-6 font-light">
                        Based on application usage patterns, the system automatically calculates 
                        productive vs unproductive time to provide accurate productivity scores.
                      </p>
                      
                      <div className="space-y-6">
                        <div>
                          <div className="flex justify-between mb-2">
                            <span className="text-gray-700">Productive Time</span>
                            <span className="font-bold text-green-600">6h 42m</span>
                          </div>
                          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: '75%' }}></div>
                          </div>
                        </div>
                        
                        <div>
                          <div className="flex justify-between mb-2">
                            <span className="text-gray-700">Unproductive Time</span>
                            <span className="font-bold text-red-600">1h 18m</span>
                          </div>
                          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full" style={{ width: '25%' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 rounded-xl p-8">
                      <h4 className="text-xl font-bold text-black mb-6">Smart Alerts</h4>
                      <div className="space-y-4">
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
                              <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div>
                              <p className="font-bold text-black">Missing Time Alert</p>
                              <p className="text-gray-600 text-sm">Get notified when hours are below target</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3">
                              <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div>
                              <p className="font-bold text-black">Planned Days Off</p>
                              <p className="text-gray-600 text-sm">Schedule and track planned time off</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Cloud Integration */}
        <section className="py-16 px-6 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div>
                  <h3 className="text-2xl font-bold text-black mb-6">Cloud Integration</h3>
                  <p className="text-gray-600 mb-6 font-light leading-relaxed">
                    Data collected by the desktop application is automatically synchronized with 
                    our secure cloud platform. Access comprehensive analytics, reports, and 
                    team insights from anywhere.
                  </p>
                  
                  <ul className="space-y-4">
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Real-time data synchronization</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>End-to-end encryption for all data</span>
                    </li>
                    <li className="flex items-center">
                      <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Access from web dashboard and mobile app</span>
                    </li>
                  </ul>
                </div>
                
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-8">
                  <div className="text-center">
                    <div className="text-6xl mb-6">☁️</div>
                    <h4 className="text-2xl font-bold text-black mb-4">Secure Cloud Processing</h4>
                    <p className="text-gray-600 font-light">
                      All collected data is processed securely in the cloud for advanced analytics
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* System Requirements */}
        <section className="py-16 px-6 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-black mb-12">
              System Requirements
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-gray-50 rounded-xl p-8 text-center">
                <div className="text-4xl mb-6">🪟</div>
                <h3 className="text-xl font-bold text-black mb-4">Windows</h3>
                <p className="text-gray-600 mb-4 font-light">Windows 10 or later</p>
                <p className="text-sm text-gray-500">2GB RAM, 100MB disk space</p>
              </div>
              
              <div className="bg-gray-50 rounded-xl p-8 text-center">
                <div className="text-4xl mb-6">🍎</div>
                <h3 className="text-xl font-bold text-black mb-4">macOS</h3>
                <p className="text-gray-600 mb-4 font-light">macOS 10.14 or later</p>
                <p className="text-sm text-gray-500">2GB RAM, 100MB disk space</p>
              </div>
              
              <div className="bg-gray-50 rounded-xl p-8 text-center">
                <div className="text-4xl mb-6">🐧</div>
                <h3 className="text-xl font-bold text-black mb-4">Linux</h3>
                <p className="text-gray-600 mb-4 font-light">Ubuntu 18.04 or later</p>
                <p className="text-sm text-gray-500">2GB RAM, 100MB disk space</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 px-6 bg-gradient-to-b from-white to-blue-50">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold text-black mb-6">
              Ready to Start Tracking?
            </h2>
            <p className="text-gray-600 text-lg mb-8 font-light">
              Download our desktop app and boost your team's productivity today
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-8 py-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Desktop App
              </button>
              <Link
                href="/admin/registration"
                className="px-8 py-4 border-2 border-blue-600 text-blue-600 font-bold rounded-lg hover:bg-blue-50 transition-all"
              >
                Create Account
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
              <Link href="/product-tour" className="text-gray-300 hover:text-white text-sm font-medium">
                Product Tour
              </Link>
              <Link href="/time-tracking-desktop-application" className="text-white text-sm font-bold">
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