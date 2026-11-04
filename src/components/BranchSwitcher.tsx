import React, { useEffect, useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import type { Project } from '../../shared/types/kanban';
import { gitApi } from '../data/gitApi';
import { useOperation } from '../data/useOperation';

interface BranchSwitcherProps {
  project: Project;
  onSwitch: (branch: string) => Promise<void>;
}

/** Switches the branch checked out in the project's clone, independently of the project form. */
export const BranchSwitcher: React.FC<BranchSwitcherProps> = ({ project, onSwitch }) => {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(project.repositoryBranch ?? '');
  const [loadError, setLoadError] = useState('');
  const switching = useOperation();
  const current = project.repositoryBranch ?? '';

  useEffect(() => {
    let active = true;
    setBranches(null);
    setLoadError('');
    gitApi.projectBranches(project.id).then((result) => {
      if (active) { setBranches(result.branches); setSelected(result.current); }
    }).catch((cause: unknown) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : 'Unable to load branches');
    });
    return () => { active = false; };
  }, [project.id]);

  const handleSwitch = () => switching.run(() => onSwitch(selected));
  const error = loadError || switching.error;

  return (
    <fieldset className="space-y-2 p-3 rounded-lg border border-slate-700/80 bg-slate-900/40" disabled={switching.pending}>
      <legend className="px-1 text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Git branch
      </legend>
      <p className="text-[11px] text-slate-400 truncate" title={project.repositoryUrl}>{project.repositoryUrl}</p>
      {branches && branches.length === 0 ? (
        <p className="text-[11px] text-slate-500">The repository has no commits yet: there is no branch to switch to.</p>
      ) : (
        <div className="flex gap-1.5">
          <label htmlFor="project-branch-switch" className="sr-only">Branch</label>
          <select
            id="project-branch-switch" value={selected} disabled={!branches}
            onChange={(e) => { setSelected(e.target.value); switching.clearError(); }}
            className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          >
            {!branches && <option value={selected}>{loadError ? selected : 'Loading branches…'}</option>}
            {branches?.map((branch) => (
              <option key={branch} value={branch}>{branch}{branch === current ? ' (current)' : ''}</option>
            ))}
          </select>
          <button
            type="button" onClick={() => { void handleSwitch(); }}
            disabled={!branches || !selected || selected === current || switching.pending}
            className="shrink-0 inline-flex items-center gap-1 px-3 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:hover:bg-indigo-600"
          >
            {switching.pending && <Loader2 className="w-3 h-3 animate-spin" />}
            Switch branch
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}
      <p className="text-[11px] text-slate-500">
        Switches the server's clone right away (separately from Save). Uses the branches fetched at clone time;
        refused if the clone has uncommitted changes.
      </p>
    </fieldset>
  );
};
