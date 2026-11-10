import { useEffect, useRef, useState } from 'react';
import { workflowPhaseSchema, type WorkflowDocument, type WorkflowScope, type WorkflowPhase } from '../../shared/types/workflowEditor';
import { workflowPhases } from '../../shared/utils/workflowGraph';
import {
  workflowJsonObjectSchema, workflowTestLaunchSchema,
  type WorkflowTestAgent, type WorkflowTestLaunch, type WorkflowTestRun,
} from '../../shared/types/workflowTestRun';
import { workflowTestApi } from '../data/workflowTestApi';

const fieldClass = 'w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100';
const buttonClass = 'rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40';
type MockEditor = { mode: 'real' | 'mock'; kind: 'output' | 'error'; output: string; error: string; delayMs: string };
const mockDefaults = (): MockEditor => ({ mode: 'mock', kind: 'output', output: '{}', error: 'Simulated agent failure', delayMs: '0' });
type Version = { id: string; number: number; document: WorkflowDocument };
type RunSummary = Pick<WorkflowTestRun, 'id' | 'status' | 'versionNumber' | 'createdAt'>;

export function WorkflowTestPanel({ scope, version }: { scope: WorkflowScope; version: Version }) {
  const [input, setInput] = useState('{\n  "request": "Describe the expected outcome"\n}');
  const [settings, setSettings] = useState<Record<string, MockEditor>>(() =>
    Object.fromEntries(version.document.nodes.filter((node) => node.kind === 'agent').map((node) => [node.id, mockDefaults()])));
  const [providers, setProviders] = useState<string[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [phase, setPhase] = useState<WorkflowPhase>(workflowPhases(scope)[0]);
  const [run, setRun] = useState<WorkflowTestRun | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyId, setHistoryId] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([workflowTestApi.options(scope, controller.signal), workflowTestApi.list(scope, controller.signal)])
      .then(([options, items]) => { if (!controller.signal.aborted) { setProviders(options.realProviders); setHistory(items); } })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load test options.'); });
    return () => controller.abort();
  }, [scope, refresh]);
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled') setRefresh((value) => value + 1);
  }, [runStatus]);
  useEffect(() => {
    if (!runId || (runStatus !== 'running' && runStatus !== 'waiting')) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await workflowTestApi.get(scope, runId, controller.signal);
        if (!controller.signal.aborted) {
          setPollError('');
          if (!lock.current) setRun((current) => current && result.revision >= current.revision ? result : current);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setPollError(failure instanceof Error ? failure.message : 'Unable to refresh test run.');
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 750); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, runId, runStatus]);
  const act = async (action: () => Promise<WorkflowTestRun>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      const result = await action();
      if (mounted.current) { setRun(result); setHistoryId(result.id); setRefresh((value) => value + 1); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Workflow test request failed.');
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  let configuration: WorkflowTestLaunch | undefined;
  let validationError = '';
  try {
    const agents: Record<string, WorkflowTestAgent> = {};
    for (const [nodeId, setting] of Object.entries(settings)) {
      agents[nodeId] = setting.mode === 'real' ? { mode: 'real' } : {
        mode: 'mock', delayMs: Number(setting.delayMs),
        response: setting.kind === 'error' ? { kind: 'error', error: setting.error }
          : { kind: 'output', output: workflowJsonObjectSchema.parse(JSON.parse(setting.output)) },
      };
    }
    configuration = workflowTestLaunchSchema.parse({ versionId: version.id, input: JSON.parse(input), agents, authorizeRealAgents: authorized,
      ...(version.document.execution ? { phase } : {}) });
  } catch (failure) { validationError = failure instanceof Error ? failure.message : 'Invalid JSON test configuration.'; }
  const realNodes = version.document.nodes.filter((node) => settings[node.id]?.mode === 'real');
  const unsupported = realNodes.some((node) => {
    const agent = version.document.agents.find((item) => item.id === node.referenceId)!;
    return !providers.includes(agent.provider === 'inherit' ? 'copilot' : agent.provider);
  });
  const update = (nodeId: string, value: Partial<MockEditor>) =>
    setSettings((current) => ({ ...current, [nodeId]: { ...current[nodeId], ...value } }));
  const active = run?.status === 'running' || run?.status === 'waiting';

  return <section aria-label="Workflow test runner" className="space-y-4 rounded-xl border border-indigo-700 bg-indigo-950/20 p-4">
    <h2 className="font-semibold">Test run · published v{version.number}</h2>
    <p className="text-sm text-slate-300">Preview only. Agents can be real or mocked independently. No ticket saves, scripts, repository writes or release operations.
      Nodes run sequentially in dependency order; joins wait for all predecessors. Approvals pause the preview.
      Hooks run at their graph position; lifecycle-event metadata does not reschedule them.</p>
    <p className="text-xs text-slate-400">Real preview providers: {providers.join(', ') || 'none configured'}. Inherit means Copilot.
      Real agents receive the role, prompt, selected skill text, input variables and direct predecessor outputs, but no tools, workspace access or delegation.
      Production autonomy, allowed tools and iteration settings do not grant capabilities here.</p>
    {error && <div role="alert" className="text-sm text-rose-300">{error}</div>}
    {pollError && <div role="alert" className="text-sm text-amber-300">Refresh failed: {pollError}. Displayed results may be stale.</div>}
    <fieldset disabled={pending} className="space-y-3">
      {version.document.execution && <label className="block text-xs">Preview phase
        <select aria-label="Preview phase" className={fieldClass} value={phase} onChange={(event) => setPhase(workflowPhaseSchema.parse(event.target.value))}>
          {workflowPhases(scope).map((phase) => <option key={phase} value={phase}>{phase}</option>)}
        </select>
      </label>}
      <label className="block text-xs">Test input variables (JSON object)
        <textarea aria-label="Test input variables (JSON object)" className={`${fieldClass} mt-1 font-mono`} rows={5} value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      <p className="text-xs text-slate-400">Declare every prompt variable as an input key. Each step receives {"{ variables, upstream: { predecessorNodeId: output } }"}.
        Mock JSON is returned exactly as configured; no template substitution is performed inside it.</p>
      {version.document.nodes.filter((node) => node.kind === 'agent').map((node) => {
        const setting = settings[node.id];
        const agent = version.document.agents.find((item) => item.id === node.referenceId)!;
        return <fieldset key={node.id} className="space-y-2 rounded border border-slate-700 p-3" aria-label={`Test agent ${node.label}`}>
          <legend className="px-1 text-sm font-medium">{node.label} · {agent.provider}{agent.model ? ` / ${agent.model}` : ''}</legend>
          <label className="block text-xs">Agent execution
            <select aria-label="Agent execution" className={fieldClass} value={setting.mode} onChange={(event) => update(node.id, { mode: event.target.value === 'real' ? 'real' : 'mock' })}>
              <option value="mock">Mock agent (no AI call)</option><option value="real">Real agent (may incur AI charges)</option>
            </select>
          </label>
          {setting.mode === 'mock' ? <>
            <label className="block text-xs">Mock response
              <select aria-label="Mock response" className={fieldClass} value={setting.kind} onChange={(event) => update(node.id, { kind: event.target.value === 'error' ? 'error' : 'output' })}>
                <option value="output">JSON output</option><option value="error">Simulated error</option>
              </select>
            </label>
            {setting.kind === 'output' ? <label className="block text-xs">Mock JSON output
              <textarea aria-label="Mock JSON output" rows={5} className={`${fieldClass} font-mono`} value={setting.output} onChange={(event) => update(node.id, { output: event.target.value })} />
            </label> : <label className="block text-xs">Simulated error message
              <input aria-label="Simulated error message" className={fieldClass} value={setting.error} onChange={(event) => update(node.id, { error: event.target.value })} />
            </label>}
            <label className="block text-xs">Mock delay (ms, 0–30000)
              <input aria-label="Mock delay (ms, 0–30000)" className={fieldClass} type="number" min={0} max={30000} value={setting.delayMs} onChange={(event) => update(node.id, { delayMs: event.target.value })} />
            </label>
          </> : <p className="text-xs text-amber-300">This step makes a real inference request. Unsupported providers fail explicitly; no mock or provider fallback.</p>}
        </fieldset>;
      })}
      {!!realNodes.length && <label className="flex items-start gap-2 text-sm text-amber-200">
        <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
        I authorize real-agent calls for this test run and accept possible AI charges.
      </label>}
      {validationError && <p role="status" className="max-h-24 overflow-auto text-xs text-rose-300">Invalid test configuration: {validationError}</p>}
      {unsupported && <p className="text-xs text-rose-300">A selected real provider is unavailable for previews. Change the published design or mock that step.</p>}
      <button className={buttonClass} disabled={!configuration || active || unsupported || (!!realNodes.length && !authorized)} onClick={() => {
        if (!configuration) return;
        const launch = configuration;
        void act(() => workflowTestApi.launch(scope, launch));
        setAuthorized(false);
      }}>Start test run</button>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs">Recent test runs
          <select aria-label="Recent test runs" className={fieldClass} value={historyId} onChange={(event) => setHistoryId(event.target.value)}>
            <option value="">Choose a run</option>
            {history.map((item) => <option key={item.id} value={item.id}>v{item.versionNumber} · {item.status} · {item.createdAt}</option>)}
          </select>
        </label>
        <button className={buttonClass} disabled={!historyId || active} onClick={() => void act(() => workflowTestApi.get(scope, historyId))}>Inspect run</button>
        <button className={buttonClass} onClick={() => setRefresh((value) => value + 1)}>Refresh test history</button>
      </div>
    </fieldset>
    {run && <section aria-label="Test run results" className="space-y-3">
      <h3 className="font-semibold">Run status: {run.status} · pinned v{run.versionNumber}</h3>
      <p className="break-all font-mono text-xs">{run.id}</p>
      {run.error && <p role="alert" className="text-rose-300">{run.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={pending} onClick={() => void act(() => workflowTestApi.get(scope, run.id))}>Refresh run</button>
        {active && <button className={buttonClass} disabled={pending} onClick={() => void act(() => workflowTestApi.cancel(scope, run.id, run.revision))}>Cancel test run</button>}
        {!active && run.versionId === version.id && <button className={buttonClass} disabled={pending} onClick={() => {
          setInput(JSON.stringify(run.configuration.input, null, 2));
          const restored: Record<string, MockEditor> = {};
          for (const [nodeId, value] of Object.entries(run.configuration.agents)) restored[nodeId] = value.mode === 'real'
            ? { ...mockDefaults(), mode: 'real' }
            : { ...mockDefaults(), delayMs: String(value.delayMs), kind: value.response.kind,
              ...(value.response.kind === 'output' ? { output: JSON.stringify(value.response.output, null, 2) } : { error: value.response.error }) };
          setSettings(restored); setAuthorized(false);
        }}>Reuse test inputs and mocks</button>}
      </div>
      {run.steps.map((step) => <article key={step.nodeId} className="space-y-2 rounded border border-slate-700 p-3" aria-label={`Result ${step.nodeId}`}>
        <h4 className="text-sm font-semibold">{run.document.nodes.find((node) => node.id === step.nodeId)?.label} · {step.mode} · {step.status}</h4>
        {step.note && <p className="text-xs text-slate-300">{step.note}</p>}
        {step.error && <p className="text-xs text-rose-300">{step.error}</p>}
        {step.status === 'waiting' && <button className={buttonClass} disabled={pending}
          onClick={() => void act(() => workflowTestApi.approve(scope, run.id, run.revision, step.nodeId))}>Approve preview step</button>}
        <details><summary className="text-xs">Step input / output</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-2 text-xs">
            {JSON.stringify({ input: step.input, output: step.output }, null, 2)}
          </pre>
        </details>
      </article>)}
    </section>}
  </section>;
}
