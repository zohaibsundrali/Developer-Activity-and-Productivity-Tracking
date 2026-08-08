'use client';

import { Activity, ArrowUp, Github, Linkedin, Mail, Twitter } from 'lucide-react';

const socials = [
  { href: '#', label: 'GitHub', icon: Github },
  { href: '#', label: 'Twitter', icon: Twitter },
  { href: '#', label: 'LinkedIn', icon: Linkedin },
  { href: '#', label: 'Email', icon: Mail },
];

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="border-t border-border bg-muted/30 py-12 text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="text-center md:text-left">
            <span className="inline-flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-base font-semibold tracking-tight text-foreground">
                DevTrack
              </span>
            </span>
            <p className="mt-2 text-sm text-muted-foreground">
              Activity &amp; productivity tracking platform.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 md:items-end">
            <div className="flex items-center gap-1">
              {socials.map(({ href, label, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={label}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </a>
              ))}
              <button
                onClick={scrollToTop}
                className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Back to top"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              &copy; 2026 DevTrack. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
