import { useEffect, useState } from 'react';
import type { Release } from '../types/release';
import { RELEASE_LABELS } from '../types/release';
import { boardApi } from '../data/boardApi';

export default function ReleaseSelect({ projectId, value, onChange, disabled = false, id = 'task-release' }: {
  projectId: string; value: string; onChange: (value: string) => void; disabled?: boolean; id?: string;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void boardApi.releases(projectId, controller.signal).then((rows) => {
      if (!controller.signal.aborted) { setReleases(rows); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Unable to load versions'); setLoading(false); }
    });
    return () => controller.abort();
  }, [projectId, attempt]);
  const current = releases.find((release) => release.id === value);
  const fixed = !!current && ((!!current.targetCommit && current.status !== 'cancelled') || current.publishing || current.status === 'published');
  return <div className="space-y-1">
    <label htmlFor={id} className="block text-xs font-semibold text-slate-300">Release version (required before delivery)</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading || !!error || fixed}
      className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs disabled:opacity-60">
      <option value="">{loading ? 'Loading versions...' : 'No version assigned'}</option>
      {value && !current && <option value={value}>Current version (reload to resolve)</option>}
      {releases.filter((release) => release.id === value || (!release.targetCommit && !release.publishing && ['upcoming', 'in_progress'].includes(release.status))).map((release) =>
        <option key={release.id} value={release.id}>{release.version} · {RELEASE_LABELS[release.status]}</option>)}
    </select>
    {error && <p role="alert" className="text-xs text-rose-300">{error} <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Retry versions</button></p>}
    {!loading && !error && !releases.length && <p className="text-xs text-amber-200">Create a version in Releases before delivery.</p>}
  </div>;
}
