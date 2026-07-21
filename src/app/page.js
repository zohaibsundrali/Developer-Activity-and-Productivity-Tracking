'use client';

import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import PlatformCards from '@/components/PlatformCards';
import TimeTrackingSection from '@/components/TimeTrackingSection';
import EmployeeMonitoringSection from '@/components/EmployeeMonitoringSection';
import ProjectManagementSection from '@/components/ProjectManagementSection';

import Footer from '@/components/Footer';

export default function ProductTourPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Navbar />

      <main className="pt-20">
        {/* Hero Section for Product Tour */}
        <HeroSection />

        {/* Product Tour Content */}
        <section id="product-tour" className="py-16 px-6 bg-background">
          <div className="container mx-auto max-w-6xl">

            {/* Platforms Section */}
            <div id="platforms" className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">
                  Website and Desktop App
                </h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto font-light">
                  Boost productivity across all platforms with our integrated suite
                </p>
              </div>

              <PlatformCards />
            </div>

            {/* Automated Time Tracking */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">Automated Time Tracking</h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto font-light">
                  Easily track time using our intelligent platform across all devices
                </p>
              </div>

              <TimeTrackingSection />
            </div>

            {/* Employee Monitoring */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">Employee Monitoring</h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto font-light">
                  Collect and analyze activity data with comprehensive insights
                </p>
              </div>

              <EmployeeMonitoringSection />
            </div>

            {/* Project Management & Reports */}
            <div className="mb-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">Project Management & Reports</h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto font-light">
                  Create project plans and generate reports
                </p>
              </div>

              <ProjectManagementSection />
            </div>

            {/* CTA Section */}

          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}