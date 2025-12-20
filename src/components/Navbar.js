'use client';

import { useState } from 'react';

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navItems = [
    { name: 'Overview', href: '#overview' },
    { name: 'Product Tour', href: '#product-tour' },
    { name: 'Desktop', href: '#desktop' },
    { name: 'Help', href: '#help' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          
          {/* Left Side: Brand Name */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">DT</span>
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
  );
}