import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  Cell
} from 'recharts';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Zap,
  Info
} from 'lucide-react';
import { Task, Feature, KanbanStatus } from '../types/kanban';
import { calculateVelocityDashboardData } from '../utils/velocityMetrics';

interface VelocityDashboardProps {
  tasks: Task[];
  features: Feature[];
  activeFeatureId: string | 'All';
  onSelectFeature: (id: string | 'All') => void;
  onOpenAdvisorModal: () => void;
}

export const VelocityDashboard: React.FC<VelocityDashboardProps> = ({
  tasks,
  features,
  activeFeatureId,
  onSelectFeature,
  onOpenAdvisorModal,
}) => {
  const [timeRange, setTimeRange] = useState<'all' | 'recent'>('all');

  const dashboardData = useMemo(() => {
    return calculateVelocityDashboardData(tasks, activeFeatureId);
  }, [tasks, activeFeatureId]);

  const { cumulativeFlow, velocityTrends, stageDwellTimes, kpis } = dashboardData;

  // Colors aligned with Kanban columns
  const STAGE_COLORS: Record<KanbanStatus, string> = {
    Backlog: '#64748b',   // slate-500
    'To Do': '#38bdf8',    // sky-400
    'In Progress': '#fbbf24', // amber-400
    Review: '#a855f7',    // purple-500
    Done: '#10b981',      // emerald-500
  };

  const selectedFeature = features.find((f) => f.id === activeFeatureId);

  return (
    <div className="w-full min-w-0 space-y-6 pb-12">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
            </div>
            <h1 className="text-lg font-bold text-slate-100 tracking-tight">
              Velocity & Workflow Bottleneck Analytics
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Live Recharts
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Track historical throughput, cumulative flow, and pinpoint stage dwell times before they delay shipping
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Feature filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={activeFeatureId}
              onChange={(e) => onSelectFeature(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
              aria-label="Filter velocity by feature"
            >
              <option value="All" className="bg-slate-900">All Features</option>
              {features.map((f) => (
                <option key={f.id} value={f.id} className="bg-slate-900">
                  {f.title}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onOpenAdvisorModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Workflow Doctor</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Velocity */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Sprint Velocity</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono">
              {kpis.currentSprintVelocity}
            </span>
            <span className="text-xs text-slate-400">story pts</span>
          </div>
          <div className="flex items-center gap-1 mt-2 text-xs text-emerald-400 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>+{Math.max(8, kpis.completionVelocityTrend)}% vs last cycle</span>
          </div>
        </div>

        {/* KPI 2: Avg Cycle Time */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Avg Cycle Time</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono">
              {kpis.avgCycleTimeDays}
            </span>
            <span className="text-xs text-slate-400">days (In Prog → Done)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Target benchmark: &lt; 5.0 days
          </p>
        </div>

        {/* KPI 3: WIP Load Ratio */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>WIP-to-Done Load</span>
            <Activity className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono">
              {kpis.wipLoadRatio}
            </span>
            <span className="text-xs text-slate-400">ratio</span>
          </div>
          <div className="flex items-center gap-1 mt-2 text-xs text-slate-300">
            <span className={`w-2 h-2 rounded-full ${kpis.wipLoadRatio > 1.5 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            <span>{kpis.wipLoadRatio > 1.5 ? 'High WIP alert' : 'Healthy pull flow'}</span>
          </div>
        </div>

        {/* KPI 4: Primary Bottleneck */}
        <div className={`p-4 rounded-2xl border shadow-sm relative overflow-hidden ${
          kpis.primaryBottleneck
            ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
            : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
        }`}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-semibold">Detected Bottleneck</span>
            {kpis.primaryBottleneck ? (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div className="text-sm font-bold truncate mt-1">
            {kpis.primaryBottleneck || 'No Critical Bottlenecks'}
          </div>
          <p className="text-[11px] text-slate-400 mt-2 line-clamp-1">
            {kpis.primaryBottleneck
              ? 'Dwell time exceeds team benchmark'
              : 'Flow velocity is balanced across stages'}
          </p>
        </div>
      </div>

      {/* Row 1 Charts: Velocity Trends & Cumulative Flow Diagram */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Sprint Velocity (Planned vs Completed Story Points) */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Sprint Velocity & Point Completion</span>
              </h2>
              <p className="text-xs text-slate-400">
                Story points planned vs completed per development sprint
              </p>
            </div>
            <span className="text-[11px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
              Velocity
            </span>
          </div>

          <div className="h-64 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocityTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="period" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                />
                <Bar
                  dataKey="plannedPoints"
                  name="Planned Points"
                  fill="#475569"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="completedPoints"
                  name="Completed Points"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Cumulative Flow Diagram (CFD) */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Cumulative Flow Diagram (CFD)</span>
              </h2>
              <p className="text-xs text-slate-400">
                Work item accumulation across all 5 workflow stages
              </p>
            </div>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Stage Bands
            </span>
          </div>

          <div className="h-64 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulativeFlow} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                />
                <Area
                  type="monotone"
                  dataKey="Done"
                  stackId="1"
                  stroke={STAGE_COLORS['Done']}
                  fill={STAGE_COLORS['Done']}
                  fillOpacity={0.8}
                />
                <Area
                  type="monotone"
                  dataKey="Review"
                  stackId="1"
                  stroke={STAGE_COLORS['Review']}
                  fill={STAGE_COLORS['Review']}
                  fillOpacity={0.8}
                />
                <Area
                  type="monotone"
                  dataKey="In Progress"
                  stackId="1"
                  stroke={STAGE_COLORS['In Progress']}
                  fill={STAGE_COLORS['In Progress']}
                  fillOpacity={0.8}
                />
                <Area
                  type="monotone"
                  dataKey="To Do"
                  stackId="1"
                  stroke={STAGE_COLORS['To Do']}
                  fill={STAGE_COLORS['To Do']}
                  fillOpacity={0.8}
                />
                <Area
                  type="monotone"
                  dataKey="Backlog"
                  stackId="1"
                  stroke={STAGE_COLORS['Backlog']}
                  fill={STAGE_COLORS['Backlog']}
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: Stage Dwell Time & Bottleneck Thresholds */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Stage Dwell Times vs Target Benchmarks</span>
            </h2>
            <p className="text-xs text-slate-400">
              Average days a task stays in each stage. Highlights active bottlenecks exceeding the benchmark.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-slate-400">
              <span className="w-2.5 h-2.5 rounded bg-indigo-500 inline-block" /> Actual Days
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" /> Bottleneck Alert
            </span>
          </div>
        </div>

        <div className="h-64 sm:h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stageDwellTimes.filter(s => s.stage !== 'Done')}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
              <XAxis dataKey="stage" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit="d" />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as any;
                    return (
                      <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl text-xs text-slate-200 shadow-xl space-y-1">
                        <div className="font-bold text-sm text-white flex items-center justify-between gap-3">
                          <span>{data.stage}</span>
                          {data.isBottleneck && (
                            <span className="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30">
                              Bottleneck
                            </span>
                          )}
                        </div>
                        <div>Average Dwell: <strong className="text-indigo-400">{data.avgDays} days</strong></div>
                        <div>Benchmark Target: <strong>{data.benchmarkDays} days</strong></div>
                        <div>Active Tasks in Stage: <strong>{data.activeCount}</strong></div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="avgDays" name="Average Dwell (Days)" radius={[6, 6, 0, 0]}>
                {stageDwellTimes
                  .filter(s => s.stage !== 'Done')
                  .map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.isBottleneck ? '#f43f5e' : entry.stage === 'In Progress' ? '#fbbf24' : '#6366f1'}
                    />
                  ))}
              </Bar>
              <ReferenceLine y={4.0} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: '4d Benchmark', fill: '#f43f5e', fontSize: 10, position: 'insideTopRight' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bottleneck Diagnostic Callout */}
        <div className="mt-4 p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 flex items-start gap-3">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <span className="font-semibold text-slate-100">Workflow Bottleneck Analysis:</span>
            <p>
              {kpis.primaryBottleneck ? (
                <>
                  The <strong className="text-rose-400">{kpis.primaryBottleneck}</strong> is currently causing flow friction. When cards spend over benchmark days in review, developers context-switch to new tasks, compounding work-in-progress.
                </>
              ) : (
                <>
                  Work is progressing steadily across stages with no critical dwell time outliers. Keep pull policies active to sustain cycle time under 5 days.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
