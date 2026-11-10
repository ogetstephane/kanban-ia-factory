import { useEffect, useState } from 'react';
import { agentApi } from '../data/agentApi';
import type { AgentOptions } from '../../shared/types/agent';
import type { Task } from '../../shared/types/kanban';
import { agentProviderSchema } from '../../shared/types/agentProvider';

export default function TaskAgentSelect({ provider, model, onProviderChange, onModelChange }: {
  provider: NonNullable<Task['agentProvider']>; model: string;
  onProviderChange: (provider: NonNullable<Task['agentProvider']>) => void;
  onModelChange: (model: string) => void;
}) {
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void agentApi.agentOptions(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setOptions(value); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Unable to load agent models');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [attempt]);
  const selected = options?.providers.find((item) => item.id === provider);
  const defaultUnavailable = !!selected?.defaultModel && !selected.models.some((item) => item.id === selected.defaultModel);
  const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-slate-100 disabled:opacity-60';
  return <fieldset className="space-y-2 rounded-xl border border-slate-700 p-3">
    <legend className="px-1 text-xs font-semibold text-slate-300">Ticket agent</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="task-agent-provider" className="block text-xs text-slate-300">Agent provider</label>
        <select id="task-agent-provider" value={provider} className={fieldClass}
          disabled={loading || !!error}
          onChange={(event) => { onProviderChange(agentProviderSchema.parse(event.target.value)); onModelChange(''); }}>
          {!options?.providers.some((item) => item.id === provider) && <option value={provider}>{provider === 'copilot' ? 'GitHub Copilot' : provider} (saved selection)</option>}
          {options?.providers.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>
            {item.name}{item.experimental ? ' (experimental)' : ''}{!item.available ? ' - unavailable' : ''}
          </option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="task-agent-model" className="block text-xs text-slate-300">Model</label>
        <select id="task-agent-model" value={model} disabled={loading || !!error || selected?.available === false} className={fieldClass}
          onChange={(event) => onModelChange(event.target.value)}>
          <option value="">{loading ? 'Loading models...' : selected?.defaultModel ? `Server default (${selected.defaultModel}${defaultUnavailable ? ' - unavailable' : ''})` : provider === 'copilot' ? 'Copilot default' : 'Select a model (required)'}</option>
          {model && !selected?.models.some((item) => item.id === model) && <option value={model}>{model} (saved selection)</option>}
          {selected?.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
    </div>
    <p className="text-[11px] text-slate-500">Applies to planning, execution and AI review. Auto-Spec remains a separate Copilot assistant. Only integrated providers and their reported models are offered.</p>
    {selected?.issue && <p role="alert" className="text-xs text-amber-300">{selected.issue} <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry models</button></p>}
    {options && !selected && <p role="alert" className="text-xs text-amber-300">The saved provider is not registered on this server. Select an available provider before starting a new run.</p>}
    {selected?.experimental && <p className="text-xs text-amber-300">Experimental runtime: not production-qualified. Requests may incur charges; no strict billing cap is guaranteed.</p>}
    {defaultUnavailable && <p role="alert" className="text-xs text-amber-300">The server default model "{selected?.defaultModel}" is not offered by this runtime. Pick an available model or fix the provider-specific server default.</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error} Your saved choice is preserved; new tickets can still use the default. <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry models</button></p>}
  </fieldset>;
}
