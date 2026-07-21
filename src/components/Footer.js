import { Sparkles, Github, Twitter, Linkedin, Mail, ArrowUp } from 'lucide-react';

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-card text-foreground py-12 border-t border-border">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <div className="p-1.5 bg-primary rounded-lg">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <h2 className="text-lg font-bold text-foreground">
                DevTrack
              </h2>
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              Activity & Productivity Tracking Platform
            </p>

          </div>

          <div className="text-center md:text-right">
            <div className="flex items-center gap-4 justify-center md:justify-end mb-3">
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors duration-300"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors duration-300"
                aria-label="Twitter"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors duration-300"
                aria-label="LinkedIn"
              >
                <Linkedin className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors duration-300"
                aria-label="Email"
              >
                <Mail className="w-5 h-5" />
              </a>
              <button
                onClick={scrollToTop}
                className="text-muted-foreground hover:text-primary transition-colors duration-300 p-1.5 bg-muted hover:bg-primary/10 rounded-full"
                aria-label="Scroll to top"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
            <p className="text-muted-foreground text-sm">
              © 2026 All rights reserved.
            </p>
          </div>
        </div>

    
      </div>
    </footer>
  );
}