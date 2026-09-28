import React, { useEffect } from 'react';
import { LandingNavbar } from '../../components/landing/LandingNavbar';
import { LandingHero } from '../../components/landing/LandingHero';
import { InteractiveDemoSection } from '../../components/landing/InteractiveDemoSection';
import { ProblemSection } from '../../components/landing/ProblemSection';
import { HowItWorksSection } from '../../components/landing/HowItWorksSection';
import { AIArchitectureSection } from '../../components/landing/AIArchitectureSection';
import { ObservabilityTrustSection } from '../../components/landing/ObservabilityTrustSection';
import { LandingCTASection } from '../../components/landing/LandingCTASection';
import { LandingFooter } from '../../components/landing/LandingFooter';

export const LandingPage: React.FC = () => {
  useEffect(() => {
    // SEO Document Title and Meta Description
    const prevTitle = document.title;
    document.title = 'FlowPilot — B2B Workflow Orchestration Control Plane';

    let metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc ? metaDesc.getAttribute('content') : '';

    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute(
      'content',
      'FlowPilot turns business requests into controlled, auditable business execution across validation, AI classification, deterministic rules, human approvals, and automated actions.'
    );

    // Scroll to top on mount if not targeting an anchor
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }

    return () => {
      document.title = prevTitle;
      if (metaDesc && prevDesc) {
        metaDesc.setAttribute('content', prevDesc);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col selection:bg-brand-500/20 selection:text-brand-600 dark:selection:text-brand-400">
      {/* 1. Sticky Navigation */}
      <LandingNavbar />

      {/* Main Content Sections */}
      <main id="main-content" className="flex-1 w-full overflow-x-hidden">
        {/* 2. Hero + Animated Live Workflow */}
        <LandingHero />

        {/* 3. Interactive Scenario Switcher Demo */}
        <InteractiveDemoSection />

        {/* 4. The Business Problem */}
        <ProblemSection />

        {/* 5. How FlowPilot Works (5-Stage Linear Flow) */}
        <HowItWorksSection />

        {/* 6. AI Layer vs Deterministic Control Layer */}
        <AIArchitectureSection />

        {/* 7. Observability & Enterprise Trust Primitives */}
        <ObservabilityTrustSection />

        {/* 8. Final Conversion CTA */}
        <LandingCTASection />
      </main>

      {/* 9. Public Marketing Footer */}
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
