'use client';

import { ArrowRight } from 'lucide-react';

import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import PlatformCards from '@/components/PlatformCards';
import TimeTrackingSection from '@/components/TimeTrackingSection';
import EmployeeMonitoringSection from '@/components/EmployeeMonitoringSection';
import ProjectManagementSection from '@/components/ProjectManagementSection';

import Footer from '@/components/Footer';

function SectionIntro({ eyebrow, title, description }) {
  return (
    <div className="mx-auto mb-14 max-w-2xl text-center">
      {eyebrow ? (
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export default function ProductTourPage() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Navbar />

      <main id="main" className="pt-16">
        <HeroSection />

        {/* Platforms */}
        <section id="platforms" className="border-t border-border bg-background py-20 lg:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Platforms"
              title="Website and desktop app"
              description="One account, two surfaces. Track from the desktop agent, review and report from the browser."
            />
            <PlatformCards />
          </div>
        </section>

        {/* Automated time tracking */}
        <section id="time-tracking" className="border-t border-border bg-muted/30 py-20 lg:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Time tracking"
              title="Automated time tracking"
              description="Hours are captured as work happens, so nobody spends Friday afternoon reconstructing a timesheet."
            />
            <TimeTrackingSection />
          </div>
        </section>

        {/* Employee monitoring */}
        <section id="monitoring" className="border-t border-border bg-background py-20 lg:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Monitoring"
              title="Employee monitoring"
              description="Activity, applications and screenshots collected into insights you can act on."
            />
            <EmployeeMonitoringSection />
          </div>
        </section>

        {/* Project management & reports */}
        <section id="projects" className="border-t border-border bg-muted/30 py-20 lg:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Delivery"
              title="Project management &amp; reports"
              description="Plan the work, estimate it, then compare estimates against what actually happened."
            />
            <ProjectManagementSection />
          </div>
        </section>

        {/* Closing call to action */}
        <section className="border-t border-border bg-background py-20 lg:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-card sm:px-12">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                Start tracking in an afternoon
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Create your workspace, invite the team, and have your first productivity report by
                the end of the week.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/admin/registration"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
                >
                  Create your workspace
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <a
                  href="/login"
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-background px-7 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
                >
                  Sign in
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
