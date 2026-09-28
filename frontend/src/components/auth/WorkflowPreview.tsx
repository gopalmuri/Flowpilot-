import React from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  GitBranch,
  Radio,
  ArrowRight,
} from 'lucide-react';
import { WorkflowNode } from './WorkflowNode';
import { StatusBadge } from './StatusBadge';

export const WorkflowPreview: React.FC = () => {
  return (
    <div className="w-full rounded-xl bg-[#0E1315] border border-[#20292C] p-4 select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#1C2528] text-[11px]">
        <span className="font-mono text-slate-300 font-semibold tracking-wide">
          WORKFLOW EXECUTION MODEL
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          Deterministic
        </span>
      </div>

      {/* Miniature Workflow Sequence */}
      <div className="space-y-1.5">
        {/* Step 1: Incoming Request (Trigger - Teal) */}
        <WorkflowNode
          icon={<Radio className="w-3.5 h-3.5" />}
          iconBg="bg-[#132824]"
          iconBorder="border-[#18B89A]/30"
          iconColor="text-[#18B89A]"
          title="Incoming Request"
          description="Event received via API or webhook"
          badgeVariant="trigger"
        />

        {/* Connector 1 */}
        <div className="flex justify-center -my-0.5">
          <div className="w-px h-2.5 bg-[#242D30]" />
        </div>

        {/* Step 2: Validate Request (Neutral Gray) */}
        <WorkflowNode
          icon={<Check className="w-3.5 h-3.5" />}
          iconBg="bg-[#182023]"
          iconBorder="border-[#2A3438]"
          iconColor="text-slate-300"
          title="Validate Request"
          description="Schema validation & tenant isolation"
          badgeVariant="validate"
        />

        {/* Connector 2 */}
        <div className="flex justify-center -my-0.5">
          <div className="w-px h-2.5 bg-[#242D30]" />
        </div>

        {/* Step 3: AI Classification (Subtle Violet) */}
        <WorkflowNode
          icon={<Cpu className="w-3.5 h-3.5" />}
          iconBg="bg-[#201830]"
          iconBorder="border-violet-800/40"
          iconColor="text-violet-300"
          title="AI Classification"
          description="Intent categorization & scoring"
          badgeVariant="ai"
        />

        {/* Connector 3 */}
        <div className="flex justify-center -my-0.5">
          <div className="w-px h-2.5 bg-[#242D30]" />
        </div>

        {/* Step 4: Business Rules & Conditional Routing (Amber) */}
        <div className="p-2 rounded-lg bg-[#12181A] border border-[#1F272A] space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md bg-[#2A2012] border border-amber-800/40 flex items-center justify-center text-amber-300 flex-shrink-0">
                <GitBranch className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 truncate">Business Rules</div>
                <div className="text-[10px] text-slate-400 truncate">Deterministic conditional branching</div>
              </div>
            </div>
            <StatusBadge variant="condition" className="flex-shrink-0" />
          </div>

          {/* Parallel Branch Split */}
          <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-[#1C2427]">
            <div className="p-1.5 rounded-md bg-[#161D20] border border-amber-800/30 flex items-center gap-2">
              <Clock className="w-3 h-3 text-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-amber-200 truncate">Human Approval</div>
                <div className="text-[9px] text-slate-400">Required review</div>
              </div>
            </div>
            <div className="p-1.5 rounded-md bg-[#161D20] border border-[#18B89A]/30 flex items-center gap-2">
              <ArrowRight className="w-3 h-3 text-[#18B89A] flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-slate-200 truncate">Auto Action</div>
                <div className="text-[9px] text-slate-400">CRM &amp; Slack dispatch</div>
              </div>
            </div>
          </div>
        </div>

        {/* Connector 4 */}
        <div className="flex justify-center -my-0.5">
          <div className="w-px h-2.5 bg-[#242D30]" />
        </div>

        {/* Step 5: Completed & Audited (Green) */}
        <WorkflowNode
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          iconBg="bg-[#132B20]"
          iconBorder="border-emerald-800/40"
          iconColor="text-emerald-400"
          title="Completed"
          description="Finalized with immutable audit trail"
          badgeVariant="success"
        />
      </div>

      {/* Footer Note */}
      <div className="mt-3 pt-2.5 border-t border-[#1C2528] flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <span>Human-in-the-loop</span>
        <span className="text-slate-500">&bull;</span>
        <span>Auditable workflow</span>
      </div>
    </div>
  );
};
