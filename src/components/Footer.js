import { Sparkles, Heart, Github, Twitter, Linkedin, Mail, ArrowUp } from 'lucide-react';

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-white text-black py-12 border-t border-gray-200">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <div className="p-1.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                DevTrack
              </h2>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Activity & Productivity Tracking Platform
            </p>
          
          </div>

          <div className="text-center md:text-right">
            <div className="flex items-center gap-4 justify-center md:justify-end mb-3">
              <a 
                href="#" 
                className="text-gray-400 hover:text-blue-600 transition-colors duration-300"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
              <a 
                href="#" 
                className="text-gray-400 hover:text-blue-400 transition-colors duration-300"
                aria-label="Twitter"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a 
                href="#" 
                className="text-gray-400 hover:text-blue-700 transition-colors duration-300"
                aria-label="LinkedIn"
              >
                <Linkedin className="w-5 h-5" />
              </a>
              <a 
                href="#" 
                className="text-gray-400 hover:text-red-500 transition-colors duration-300"
                aria-label="Email"
              >
                <Mail className="w-5 h-5" />
              </a>
              <button
                onClick={scrollToTop}
                className="text-gray-400 hover:text-blue-600 transition-colors duration-300 p-1.5 bg-gray-100 hover:bg-blue-50 rounded-full"
                aria-label="Scroll to top"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
            <p className="text-gray-400 text-sm">
              © 2026 All rights reserved.
            </p>
          </div>
        </div>

    
      </div>
    </footer>
  );
}