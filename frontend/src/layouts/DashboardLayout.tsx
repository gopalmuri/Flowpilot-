import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { useAuth } from '../context/AuthContext';

export const DashboardLayout: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, activeRole } = useAuth();

  return (
    <div className="flex h-screen bg-warm-50 dark:bg-charcoal-950 text-warm-900 dark:text-charcoal-100 overflow-hidden font-sans transition-colors">
      {/* Sidebar: persistent on md+, slide-over drawer on mobile */}
      <Sidebar
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        profile={{ name: user?.full_name || 'Pilot Operator', role: activeRole || 'Member' }}
      />

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onOpenMobileMenu={() => setIsMobileMenuOpen(true)} isMobileMenuOpen={isMobileMenuOpen} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 bg-warm-50 dark:bg-charcoal-950">
          <div className="max-w-7xl mx-auto space-y-6 min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
