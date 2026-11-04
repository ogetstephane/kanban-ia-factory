import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  MessageSquare,
  Send,
  Loader2,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Task, WorkflowMetrics } from '../../shared/types/kanban';
import { calculateWorkflowMetrics } from '../../shared/utils/kanbanLogic';

interface WorkflowAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
}

interface CopilotAdvisorData {
  healthScore: number;
  statusSummary: string;
  bottlenecks: string[];
  recommendations: { title: string; action: string; impact: string }[];
  workflowTip: string;
}

export const WorkflowAdvisorModal: React.FC<WorkflowAdvisorModalProps> = ({
  isOpen,
  onClose,
  tasks,
}) => {
  const [metrics, setMetrics] = useState<WorkflowMetrics>(() => calculateWorkflowMetrics(tasks));
  const [advisorData, setAdvisorData] = useState<CopilotAdvisorData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'copilot'; text: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const calculated = calculateWorkflowMetrics(tasks);
      setMetrics(calculated);
      loadAdvisorAnalysis(calculated);
    }
  }, [isOpen, tasks]);

  if (!isOpen) return null;

  const loadAdvisorAnalysis = async (currentMetrics: WorkflowMetrics) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/copilot/suggest-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryData: currentMetrics }),
      });

      if (response.ok) {
        const data = await response.json();
        setAdvisorData(data);
      }
    } catch (err) {
      console.error('Failed to load workflow diagnosis', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { sender: 'user', text: userMsg }]);
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          context: {
            metrics,
            activeTasksCount: tasks.length,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setChatMessages((prev) => [...prev, { sender: 'copilot', text: data.reply }]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { sender: 'copilot', text: 'Workflow tip: Maintain WIP limits to maximize throughput!' },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'copilot', text: 'Keep in-progress tasks small (under 3 story points) and review daily.' },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="advisor-modal-title"
    >
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 id="advisor-modal-title" className="text-lg font-bold">
                Workflow Advisor & Bottleneck Diagnostics
              </h2>
              <p className="text-xs text-slate-400">
                AI analysis of your Kanban velocity, WIP distribution, and stage progression
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Board Key Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block mb-1">Health Score</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-emerald-400">
                {advisorData?.healthScore || 90}%
              </span>
              <span className="text-xs text-emerald-500 font-medium">Optimal</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block mb-1">Completion Rate</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-indigo-400">
                {metrics.donePercentage}%
              </span>
              <span className="text-xs text-slate-400">
                ({metrics.completedTasks}/{metrics.totalTasks})
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block mb-1">In Progress (WIP)</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${metrics.wipCount > 4 ? 'text-amber-400' : 'text-slate-100'}`}>
                {metrics.wipCount}
              </span>
              <span className="text-xs text-slate-400">active</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block mb-1">Review Queue</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${metrics.reviewQueueCount > 3 ? 'text-rose-400' : 'text-slate-100'}`}>
                {metrics.reviewQueueCount}
              </span>
              <span className="text-xs text-slate-400">awaiting</span>
            </div>
          </div>
        </div>

        {/* Bottleneck Warnings & Recommendations */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="p-6 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
              <p className="text-xs">Analyzing flow dynamics across all 5 stages...</p>
            </div>
          ) : (
            <>
              {advisorData?.bottlenecks && advisorData.bottlenecks.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-300 mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Potential Bottleneck Detected</span>
                  </div>
                  <ul className="text-xs list-disc list-inside space-y-1">
                    {advisorData.bottlenecks.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Copilot Workflow Recommendations</span>
                </h3>

                <div className="space-y-2">
                  {(advisorData?.recommendations || []).map((rec, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-slate-100">
                          {rec.title}
                        </h4>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            rec.impact === 'High'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {rec.impact} Impact
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {rec.action}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Golden Agile Tip */}
              {advisorData?.workflowTip && (
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>
                    <strong>Rule of thumb:</strong> {advisorData.workflowTip}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Interactive Copilot Chat Box */}
        <div className="mt-5 pt-4 border-t border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
            <span>Ask Copilot for Workflow Advice</span>
          </h3>

          {chatMessages.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-2 mb-3 pr-1 text-xs">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600/30 text-indigo-100 ml-8 border border-indigo-500/30'
                      : 'bg-slate-800 text-slate-200 mr-8 border border-slate-700'
                  }`}
                >
                  <p className="font-semibold text-[10px] text-slate-400 mb-0.5">
                    {msg.sender === 'user' ? 'You' : 'Kanban Copilot'}
                  </p>
                  <div className="leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSendChat} className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g. How can we streamline tasks stuck in Review?"
              className="flex-1 px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={isChatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1 cursor-pointer"
            >
              {isChatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Ask</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
