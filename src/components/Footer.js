export default function Footer() {
  const footerLinks = [
    { name: 'Platforms', href: '#platforms' },
    { name: 'Features', href: '#features' },
    { name: 'Monitoring', href: '#monitoring' },
    { name: 'Reports', href: '#reports' }
  ];

  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-8 md:mb-0">
            <h2 className="text-2xl font-bold mb-2">
               Developer Activity & Productivity Tracking with AI
            </h2>
            <p className="text-gray-400 text-sm">
             
            </p>
          </div>
          
          <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-8">
            {footerLinks.map((link) => (
              <a key={link.name} href={link.href} className="text-gray-300 hover:text-white text-sm font-medium">
                {link.name}
              </a>
            ))}
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
  );
}