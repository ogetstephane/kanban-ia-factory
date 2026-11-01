import React, { useState } from 'react';
import { Layers, Plus, Sparkles, ChevronRight, ChevronDown, CheckCircle2, Clock, Trash2, Edit3 } from 'lucide-react';
import { Feature, Project, Task } from '../types/kanban';
import { calculateFeatureProgress } from '../utils/kanbanLogic';

interface FeatureBarProps {
  features: Feature[];
  tasks: Task[];
  projects?: Project[];
  activeFeatureId: string | 'All';
  onSelectFeature: (id: string | 'All') => void;
  onOpenNewFeatureModal: () => void;
  onOpenBreakdownModal: (featureId: string) => void;
  onDeleteFeature: (id: string) => void;
}

export const FeatureBar: React.FC<FeatureBarProps> = ({
  features,
  tasks,
  projects,
  activeFeatureId,
  onSelectFeature,
  onOpenNewFeatureModal,
  onOpenBreakdownModal,
  onDeleteFeature,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <section className="bg-slate-900 border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 py-3">
      <div className="w-full min-w-0">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            aria-expanded={isExpanded}
            aria-label="Toggle Features Overview"
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Active Features & Epics ({features.length})</span>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <div className="flex items-center gap-2">
            {activeFeatureId !== 'All' && (
              <button
                onClick={() => onSelectFeature('All')}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
              >
                Clear feature filter (Show All)
              </button>
            )}
            <button
              onClick={onOpenNewFeatureModal}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 px-2.5 py-1 rounded-md border border-slate-700 transition-colors cursor-pointer"
              aria-label="Create new feature"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>New Feature</span>
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {features.map((feature) => {
              const progress = calculateFeatureProgress(feature.id, tasks);
              const isSelected = activeFeatureId === feature.id;

              return (
                <div
                  key={feature.id}
                  className={`group relative p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-slate-800/90 border-indigo-500/80 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/50'
                      : 'bg-slate-800/40 hover:bg-slate-800/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => onSelectFeature(isSelected ? 'All' : feature.id)}
                      className="text-left flex-1 cursor-pointer"
                      aria-label={`Select feature ${feature.title}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-sm"
                          style={{ backgroundColor: feature.color || '#6366f1' }}
                        />
                        <h3 className="text-xs font-semibold text-slate-100 hover:text-indigo-300 line-clamp-1">
                          {feature.title}
                        </h3>
                      </div>
                      <span className="mb-1.5 inline-flex rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                        {feature.status}
                      </span>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                        {feature.description || 'No description provided.'}
                      </p>
                      {projects && <p className="mb-2 break-words text-xs text-indigo-300">
                        {projects.find((project) => project.id === feature.projectId)?.name ?? 'No project'}
                      </p>}
                    </button>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Split / Breakdown with Copilot */}
                      <button
                        onClick={() => onOpenBreakdownModal(feature.id)}
                        className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-400/10 transition-colors cursor-pointer"
                        title="Split feature into multiple tasks with Copilot"
                        aria-label={`Split feature ${feature.title} with Copilot`}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      </button>

                      {/* Delete feature */}
                      <button
                        onClick={() => onDeleteFeature(feature.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete feature"
                        aria-label={`Delete feature ${feature.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar & Stats */}
                  <div className="mt-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>{progress.done}/{progress.total} tasks done</span>
                      </span>
                      <span className="font-semibold text-slate-300">{progress.percentage}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progress.percentage}%`,
                          backgroundColor: feature.color || '#6366f1',
                        }}
                      />
                    </div>
                  </div>

                  {/* Footer metadata */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40 text-[10px] text-slate-400">
                    <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 font-medium">
                      {feature.category || 'General'}
                    </span>
                    {feature.targetDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> {feature.targetDate}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
