import React, { useEffect } from 'react';
import { LandingNavbar } from '../../components/landing/LandingNavbar';
import { LandingHero } from '../../components/landing/LandingHero';
import { ProblemSection } from '../../components/landing/ProblemSection';
import { ExamplesSection } from '../../components/landing/ExamplesSection';
import { OrchestrationSection } from '../../components/landing/OrchestrationSection';
import { ArchitectureSection } from '../../components/landing/ArchitectureSection';
import { ObservabilitySection } from '../../components/landing/ObservabilitySection';
import { LandingCTASection } from '../../components/landing/LandingCTASection';
import { LandingFooter } from '../../components/landing/LandingFooter';
import '../../components/landing/landing.css';

const PAGE_TITLE = 'FlowPilot | Turn business requests into controlled execution';
const PAGE_DESCRIPTION =
  'FlowPilot turns business requests into governed workflows with AI-assisted decisions, deterministic rules, human approvals, and end-to-end execution visibility.';

export const LandingPage: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = PAGE_TITLE;

    let metaDesc = document.querySelector('meta[name="description"]');
    const created = !metaDesc;
    const prevDesc = metaDesc ? metaDesc.getAttribute('content') : null;
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', PAGE_DESCRIPTION);

    // Scroll to top on mount unless the URL targets an anchor.
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }

    return () => {
      document.title = prevTitle;
      if (created) metaDesc?.remove();
      else if (prevDesc !== null) metaDesc?.setAttribute('content', prevDesc);
    };
  }, []);

  return (
    <div className="lp min-h-screen flex flex-col">
      <a href="#main-content" className="lp-skip">
        Skip to content
      </a>
      <LandingNavbar />
      <main id="main-content" className="flex-1 w-full">
        <LandingHero />
        <ProblemSection />
        <ExamplesSection />
        <OrchestrationSection />
        <ArchitectureSection />
        <ObservabilitySection />
        <LandingCTASection />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
