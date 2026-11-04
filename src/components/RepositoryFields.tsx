import React, { useEffect, useState } from 'react';
import { FolderGit2, GitBranch, Loader2 } from 'lucide-react';
import { gitApi } from '../data/gitApi';
import { useOperation } from '../data/useOperation';

export interface RepositoryDraft { url: string; branch: string; token: string }
export const EMPTY_REPOSITORY: RepositoryDraft = { url: '', branch: '', token: '' };

interface RepositoryFieldsProps {
  value: RepositoryDraft;
  onChange: (value: RepositoryDraft) => void;
  disabled?: boolean;
}

const inputClass = 'w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60';

export const RepositoryFields: React.FC<RepositoryFieldsProps> = ({ value, onChange, disabled }) => {
  const [branches, setBranches] = useState<string[]>([]);
  const lookup = useOperation();
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const set = (patch: Partial<RepositoryDraft>) => onChange({ ...value, ...patch });

  useEffect(() => {
    let active = true;
    gitApi.listLocalRepositories()
      .then((local) => { if (active) setLocalFolders(local.folders); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const isLocal = /^(\/|file:\/\/)/.test(value.url.trim());
  const changeUrl = (url: string) => { onChange({ ...value, url, branch: '', token: '' }); setBranches([]); };

  const loadBranches = () => lookup.run(async () => {
    const remote = await gitApi.listBranches(value.url.trim(), value.token.trim());
    setBranches(remote.branches);
    if (!value.branch && remote.defaultBranch) set({ branch: remote.defaultBranch });
  });

  return (
    <fieldset className="space-y-2 p-3 rounded-lg border border-slate-700/80 bg-slate-900/40" disabled={disabled}>
      <legend className="px-1 text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Git repository (optional)
      </legend>
      {localFolders.length > 0 && (
        <div>
          <label htmlFor="project-repo-local" className="text-[11px] text-slate-400 mb-1 flex items-center gap-1">
            <FolderGit2 className="w-3 h-3" /> Local git folder
          </label>
          <select
            id="project-repo-local" value={localFolders.includes(value.url) ? value.url : ''}
            onChange={(e) => changeUrl(e.target.value)}
            className={inputClass}
          >
            <option value="">— Select a local repository —</option>
            {localFolders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="project-repo-url" className="text-[11px] text-slate-400 block mb-1">Repository URL or local folder</label>
        <input
          id="project-repo-url" type="text" value={value.url} autoComplete="off" spellCheck={false}
          onChange={(e) => { set({ url: e.target.value }); setBranches([]); }}
          placeholder="https://github.com/org/repo.git, git@github.com:org/repo.git or /path/to/repo"
          className={inputClass}
        />
      </div>
      {value.url.trim() && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!isLocal && <div>
            <label htmlFor="project-repo-token" className="text-[11px] text-slate-400 block mb-1">
              Access token (private HTTPS repos)
            </label>
            <input
              id="project-repo-token" type="password" value={value.token} autoComplete="off"
              onChange={(e) => set({ token: e.target.value })}
              placeholder="Used once for the clone, never stored"
              className={inputClass}
            />
          </div>}
          <div>
            <label htmlFor="project-repo-branch" className="text-[11px] text-slate-400 block mb-1">Branch</label>
            <div className="flex gap-1.5">
              <input
                id="project-repo-branch" type="text" list="project-repo-branches" value={value.branch}
                onChange={(e) => set({ branch: e.target.value })}
                placeholder="Default branch" autoComplete="off" spellCheck={false}
                className={inputClass}
              />
              <datalist id="project-repo-branches">
                {branches.map((branch) => <option key={branch} value={branch} />)}
              </datalist>
              <button
                type="button" onClick={() => { void loadBranches(); }} disabled={lookup.pending}
                className="shrink-0 inline-flex items-center gap-1 px-2 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-60"
              >
                {lookup.pending && <Loader2 className="w-3 h-3 animate-spin" />}
                {branches.length ? `${branches.length} branch${branches.length > 1 ? 'es' : ''}` : 'Load branches'}
              </button>
            </div>
          </div>
        </div>
      )}
      {lookup.error && <p role="alert" className="text-[11px] text-rose-300">{lookup.error}</p>}
      <p className="text-[11px] text-slate-500">
        SSH URLs use the server's SSH keys. Local folders must be inside the server's allowed folders;
        they are copied, never modified. Sources are cloned into the server's workspace folder.
      </p>
    </fieldset>
  );
};
