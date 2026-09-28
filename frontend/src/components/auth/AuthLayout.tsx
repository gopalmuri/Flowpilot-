import React from 'react';
import { AppLogo } from '../ui/AppLogo';
import { Shield, Users, FileCheck2 } from 'lucide-react';

interface AuthLayoutProps {
  categoryTag?: string;
  headline: React.ReactNode;
  supportingText: string;
  showcase: React.ReactNode;
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  categoryTag = 'B2B WORKFLOW ORCHESTRATION',
  headline,
  supportingText,
  showcase,
  children,
}) => {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#0B0F10] text-slate-100 font-sans selection:bg-[#18B89A]/20 selection:text-[#18B89A] overflow-x-hidden">
      {/* LEFT COLUMN: Product Introduction & Workflow Concept (Desktop) */}
      <div className="hidden lg:flex lg:w-7/12 xl:w-7/12 flex-col justify-between p-10 xl:p-14 border-r border-[#20282B] bg-[#0E1315] relative overflow-hidden">
        {/* Very subtle dark atmospheric gradient (no neon/glowing blur) */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#121E20]/40 via-transparent to-transparent pointer-events-none" />

        {/* Top: Brand Header */}
        <div className="relative z-10">
          <AppLogo size="md" showBadge={false} />
        </div>

        {/* Middle: Product Introduction */}
        <div className="relative z-10 my-auto py-8 max-w-lg">
          <div className="text-[11px] font-mono font-medium text-slate-400 tracking-wider uppercase mb-3">
            {categoryTag}
          </div>

          <h1 className="text-3xl xl:text-4xl font-semibold text-white tracking-tight leading-tight">
            {headline}
          </h1>

          <p className="mt-3 text-sm text-slate-400 leading-relaxed max-w-md">
            {supportingText}
          </p>

          {/* Workflow Visualization or Capability Rows */}
          <div className="mt-7">
            {showcase}
          </div>
        </div>

        {/* Bottom: Factual Product Capabilities */}
        <div className="relative z-10 flex items-center gap-6 pt-5 text-xs text-slate-400 border-t border-[#1C2427]">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-[#18B89A]" />
            <span>Tenant Isolation</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-[#2A3539]" />
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>Role-Based Access</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-[#2A3539]" />
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Auditable Workflows</span>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Authentication Form Panel */}
      <div className="w-full lg:w-5/12 xl:w-5/12 flex items-center justify-center p-4 sm:p-10 lg:p-12 relative overflow-y-auto">
        <div className="w-full max-w-[420px] z-10 py-4 sm:py-6">
          {/* Mobile Header (Visible on smaller viewports) */}
          <div className="lg:hidden text-center mb-6">
            <div className="flex justify-center mb-2.5">
              <AppLogo size="lg" showBadge={false} />
            </div>
            <p className="text-xs text-slate-400">
              Workflow orchestration for business operations
            </p>
          </div>

          {/* Authentication Card */}
          <div className="p-5 sm:p-9 rounded-xl bg-[#12181A] border border-[#242D30] shadow-sm relative">
            {children}
          </div>

          {/* Factual Sub-Footer */}
          <div className="mt-5 text-center text-[11px] text-slate-500">
            FlowPilot Platform &bull; Tenant Workspace
          </div>
        </div>
      </div>
    </div>
  );
};
