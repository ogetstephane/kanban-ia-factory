import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  WORKFLOW_SCOPES, WORKFLOW_SCOPE_NAMES, workflowDocumentSchema, workflowAgentSchema, workflowHookSchema,
  workflowScopeSchema, type WorkflowDocument, type WorkflowEditorState, type WorkflowScope, type WorkflowNode,
} from '../../shared/types/workflowEditor';
import { workflowEditorApi } from '../data/workflowEditorApi';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowTestPanel } from './WorkflowTestPanel';
import './workflowStudio.css';

const inputClass = 'w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100';
const buttonClass = 'rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40';
type Library = 'agents' | 'prompts' | 'skills' | 'hooks';
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

function Field({ label, value, onChange, multiline = false }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean;
}) {
  const id = useId();
  return <div className="space-y-1 text-xs text-slate-300"><label htmlFor={id}>{label}</label>
    {multiline ? <textarea id={id} className={inputClass} rows={7} value={value} onChange={(event) => onChange(event.target.value)} />
      : <input id={id} className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} />}
  </div>;
}
function Select({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId();
  return <div className="space-y-1 text-xs text-slate-300"><label htmlFor={id}>{label}</label>
    <select id={id} className={inputClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </div>;
}

function ListField({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', '));
  const formatted = values.join(', ');
  useEffect(() => { setText(formatted); }, [formatted]);
  return <label className="block space-y-1 text-xs text-slate-300"><span>{label}</span>
    <input className={inputClass} value={text} onChange={(event) => setText(event.target.value)}
      onBlur={() => onChange(list(text))} />
  </label>;
}

export default function WorkflowEditorView({ immersive, onImmersiveChange }: {
  immersive: boolean; onImmersiveChange: (value: boolean) => void;
}) {
  const [scope, setScope] = useState<WorkflowScope>('ticket-authoring');
  const [state, setState] = useState<WorkflowEditorState | null>(null);
  const [draft, setDraft] = useState<WorkflowDocument | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [library, setLibrary] = useState<Library>('agents');
  const [resourceId, setResourceId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [versionId, setVersionId] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [dockOpen, setDockOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [connectionFrom, setConnectionFrom] = useState('');
  const lock = useRef(false);
  const inspector = useRef<HTMLElement>(null);
  const dirty = !!state && !!draft && JSON.stringify(state.draft) !== JSON.stringify(draft);

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (immersive) document.body.style.overflow = 'hidden';
    const exit = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (buildOpen || configureOpen || workflowOpen || dockOpen || nodeId || connectionFrom) {
        event.preventDefault();
        clearSelection();
      } else if (immersive) onImmersiveChange(false);
    };
    window.addEventListener('keydown', exit);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', exit); };
  }, [immersive, onImmersiveChange, buildOpen, configureOpen, workflowOpen, dockOpen, nodeId, connectionFrom]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setNotice(''); setState(null); setDraft(null); setSnapshot('');
    workflowEditorApi.get(scope, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result); setDraft(result.draft); setVersionId(result.selectedVersionId ?? '');
      setNodeId(''); setResourceId(''); setConfigureOpen(false); setBuildOpen(false); setConnectionFrom('');
      setFrom(''); setTo('');
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load workflows.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, attempt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => { inspector.current?.scrollTo(0, 0); }, [nodeId, resourceId, library]);
  useEffect(() => {
    if (configureOpen) inspector.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [configureOpen]);

  const accept = (result: WorkflowEditorState) => { setState(result); setDraft(result.draft); setVersionId(result.selectedVersionId ?? ''); };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to update workflow.'); }
    finally { lock.current = false; setPending(false); }
  };
  const confirmDiscard = () => !dirty || window.confirm('Discard the unsaved workflow changes?');
  const clearSelection = () => {
    setNodeId(''); setResourceId(''); setConfigureOpen(false); setBuildOpen(false);
    setWorkflowOpen(false); setDockOpen(false); setConnectionFrom(''); setNotice('');
  };
  const selectNode = (id: string, configure = true) => {
    setConfigureOpen(configure);
    setBuildOpen(false); setWorkflowOpen(false);
    setNodeId(id);
    const node = draft?.nodes.find((item) => item.id === id);
    if (node?.kind === 'agent' || node?.kind === 'hook') {
      setLibrary(node.kind === 'agent' ? 'agents' : 'hooks'); setResourceId(node.referenceId);
    } else setResourceId('');
  };
  const removeNode = (id: string) => {
    if (!draft || draft.nodes.length <= 1) return;
    setDraft({ ...draft, nodes: draft.nodes.filter((item) => item.id !== id),
      edges: draft.edges.filter((edge) => edge.from !== id && edge.to !== id) });
    clearSelection(); setFrom(''); setTo('');
  };
  const duplicateNode = (id: string) => {
    const source = draft?.nodes.find((item) => item.id === id);
    if (!draft || !source) return;
    const copy = { ...source, id: uid('step'), label: `${source.label} copy`,
      x: Math.min(2900, source.x + 40), y: Math.min(1900, source.y + 120) };
    // Definitions stay shared until the copy is assigned a different definition.
    setDraft({ ...draft, nodes: [...draft.nodes, copy], edges: [...draft.edges, { from: source.id, to: copy.id }] });
    selectNode(source.id);
    setNodeId(copy.id);
    setNotice('Step duplicated. Its definition is shared with the original.');
  };
  const clickNode = (id: string) => {
    if (!draft || !connectionFrom) { selectNode(id, false); return; }
    if (id === connectionFrom || draft.edges.some((edge) => edge.from === connectionFrom && edge.to === id)) {
      setError('Choose a different node without an existing connection from this source.'); return;
    }
    const reachesSource = (current: string, visited = new Set<string>()): boolean => {
      if (current === connectionFrom) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      return draft.edges.filter((edge) => edge.from === current).some((edge) => reachesSource(edge.to, visited));
    };
    if (reachesSource(id)) { setError('This connection would create a cycle. Choose another target.'); return; }
    setDraft({ ...draft, edges: [...draft.edges, { from: connectionFrom, to: id }] });
    setConnectionFrom(''); setError(''); setNodeId(''); setResourceId('');
  };
  const addNode = (kind: WorkflowNode['kind']) => {
    if (!draft) return;
    const id = uid('step');
    let updated = draft, referenceId = '', label = 'Human approval';
    if (kind === 'agent') {
      referenceId = uid('agent'); label = 'New agent';
      const promptId = uid('prompt');
      updated = { ...draft, prompts: [...draft.prompts, { id: promptId, name: 'New prompt', template: 'Process {{request}} within the approved scope.', variables: ['request'] }],
        agents: [...draft.agents, { id: referenceId, name: label, role: 'Describe the responsibility', promptId,
          skillIds: [], provider: 'inherit', model: '', autonomy: 'semi', tools: [], maxIterations: 5 }] };
    } else if (kind === 'hook') {
      referenceId = uid('hook'); label = 'New hook';
      updated = { ...draft, hooks: [...draft.hooks, { id: referenceId, name: label, event: 'after-agent',
        action: 'log', script: '', approvalRequired: true, timeoutMs: 5000 }] };
    }
    const previous = draft.nodes.at(-1);
    setDraft({ ...updated,
      nodes: [...draft.nodes, { id, kind, label, referenceId, x: Math.min(2800, 80 + draft.nodes.length * 270), y: 120 }],
      edges: previous ? [...draft.edges, { from: previous.id, to: id }] : draft.edges });
    setNodeId(id);
    setBuildOpen(false); setConfigureOpen(true); setWorkflowOpen(false);
    if (kind !== 'approval') { setLibrary(kind === 'agent' ? 'agents' : 'hooks'); setResourceId(referenceId); }
    else setResourceId('');
  };
  const addResource = () => {
    if (!draft) return;
    if (library === 'agents') { addNode('agent'); return; }
    if (library === 'hooks') { addNode('hook'); return; }
    const id = uid(library === 'skills' ? 'skill' : 'prompt');
    setDraft(library === 'skills'
      ? { ...draft, skills: [...draft.skills, { id, name: 'New skill', description: 'Describe when to use this skill', instructions: 'Describe the procedure.' }] }
      : { ...draft, prompts: [...draft.prompts, { id, name: 'New prompt', template: 'Process {{request}}.', variables: ['request'] }] });
    setResourceId(id);
    setConfigureOpen(true);
  };
  const update = <K extends Library>(key: K, id: string, value: Partial<WorkflowDocument[K][number]>) => {
    setDraft((current) => current && ({ ...current, [key]: current[key].map((item) => item.id === id ? { ...item, ...value } : item) }));
  };
  const node = draft?.nodes.find((item) => item.id === nodeId);
  const agent = library === 'agents' ? draft?.agents.find((item) => item.id === resourceId) : undefined;
  const prompt = library === 'prompts' ? draft?.prompts.find((item) => item.id === resourceId) : undefined;
  const skill = library === 'skills' ? draft?.skills.find((item) => item.id === resourceId) : undefined;
  const hook = library === 'hooks' ? draft?.hooks.find((item) => item.id === resourceId) : undefined;
  const selectedResource = agent ?? prompt ?? skill ?? hook;
  const used = !!draft && (library === 'prompts' ? draft.agents.some((item) => item.promptId === resourceId)
    : library === 'skills' ? draft.agents.some((item) => item.skillIds.includes(resourceId))
      : draft.nodes.some((item) => item.kind === (library === 'agents' ? 'agent' : 'hook') && item.referenceId === resourceId));
  const validation = draft ? workflowDocumentSchema.safeParse(draft) : null;
  const publishedVersion = state?.versions.find((version) => version.id === versionId);

  return <section className={`workflow-studio studio-compose-first text-slate-100 ${immersive ? 'studio-immersive' : ''}`} aria-label="Agent workflow editor">
    <div className="studio-canvas-toolbar">
      <button className={buttonClass} aria-label="Workflow menu" aria-expanded={workflowOpen} aria-controls="studio-workflow-panel"
        onClick={() => { clearSelection(); setWorkflowOpen(!workflowOpen); }}>☰</button>
      <button className={`${buttonClass} studio-test-button`} aria-expanded={buildOpen} aria-controls="studio-build-panel"
        onClick={() => { setBuildOpen(!buildOpen); setConfigureOpen(false); setWorkflowOpen(false); setNodeId(''); setConnectionFrom(''); }}>+ Add element</button>
    </div>
    <div id="studio-workflow-panel" hidden={!workflowOpen} className="studio-workflow-panel" role="region" aria-label="Workflow controls">
    <header className="studio-header">
    <div><p className="studio-eyebrow">ORCHESTRATION LAB / WORKSPACE</p><h1 className="text-xl font-semibold tracking-tight">Agent workflow studio</h1>
      <p className="mt-1 text-xs text-slate-400">Design intelligence. Connect capabilities. Test every step.</p></div>
    <div className="studio-scope">
      <Select label="Application scope" value={scope} disabled={pending} onChange={(value) => {
        if (confirmDiscard()) setScope(workflowScopeSchema.parse(value));
      }}>{WORKFLOW_SCOPES.map((value) => <option key={value} value={value}>{WORKFLOW_SCOPE_NAMES[value]}</option>)}</Select>
      <button className={buttonClass} disabled={pending || loading} onClick={() => { if (confirmDiscard()) setAttempt((value) => value + 1); }}>Reload</button>
      <button className={buttonClass} onClick={() => onImmersiveChange(!immersive)}>{immersive ? 'Exit fullscreen' : 'Enter fullscreen'}</button>
    </div>
    </header>
    <details className="studio-safety">
      <summary>Preview environment · production isolated · global configuration</summary>
      <p className="pt-2">
      Published selections do not replace current production runtimes. Test runs are preview-only: mock agents make no AI calls;
      real agents require explicit authorization. Scripts and production writes are disabled.
      A future launch must pin an immutable version; running sessions must never change when a default is restored.
      Configurations are independent of the selected project.</p>
    </details>
    {draft && state && <fieldset disabled={pending || loading}>
      <div className="studio-metadata">
        <Field label="Workflow name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <span className={`studio-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved changes' : 'Saved draft'} · revision {state.revision}</span>
      </div>
      <div className="studio-description">
        <Field label="Workflow description" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} multiline />
      </div>
      <div className="studio-actions">
        <button className={buttonClass} disabled={!validation?.success || (!dirty && state.revision > 0)} onClick={() => void run(async () => {
          accept(await workflowEditorApi.save(scope, state.revision, draft)); setNotice('Draft saved.');
        })}>Save draft</button>
        <button className={buttonClass} disabled={dirty || !state.revision || !validation?.success} onClick={() => void run(async () => {
          accept(await workflowEditorApi.publish(scope, state.revision)); setNotice('Immutable version published and selected. Runtime remains unchanged.');
        })}>Publish saved draft</button>
        <button className={`${buttonClass} studio-test-button`} onClick={() => { setDockOpen((open) => !open); setWorkflowOpen(false); }}
          aria-expanded={dockOpen} aria-controls="workflow-test-dock">Test & results</button>
      </div>
      <section aria-label="Workflow validation" className={`studio-validation ${validation?.success ? 'is-valid' : 'is-invalid'}`}>
        <h2>{validation?.success ? 'Design is structurally valid' : 'Fix workflow validation errors'}</h2>
        {validation && !validation.success && <ul className="mt-2 list-disc pl-5 text-rose-300">
          {validation.error.issues.map((issue, index) => <li key={index}>{issue.path.join('.')}: {issue.message}</li>)}</ul>}
        <p>References, template variables, connectivity and cycles only. Not a runtime approval.</p>
      </section>
      <section aria-label="Workflow versions" className="studio-versions space-y-3">
        <h2 className="font-semibold">Versions and launch selection</h2>
        <Select label="Published version" value={versionId} onChange={setVersionId}><option value="">Choose a version</option>
          {state.versions.map((version) => <option key={version.id} value={version.id}>
            v{version.number} · {version.document.name}{state.selectedVersionId === version.id ? ' · selected default' : ''}
          </option>)}</Select>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={!versionId || versionId === state.selectedVersionId} onClick={() => void run(async () => {
            const result = await workflowEditorApi.select(scope, state.revision, versionId);
            setState(result); setNotice('Default version restored. Unsaved draft and existing snapshots are unchanged.');
          })}>Select as default</button>
          <button className={buttonClass} disabled={!versionId} onClick={() => {
            if (!confirmDiscard()) return;
            const version = state.versions.find((item) => item.id === versionId);
            if (version) {
              setDraft(version.document); setNodeId(''); setResourceId(''); setFrom(''); setTo(''); setSnapshot(''); setConnectionFrom('');
              setNotice('Version copied to draft. Save and publish to create a new version.');
            }
          }}>Copy version to draft</button>
          <button className={buttonClass} disabled={!versionId} onClick={() => void run(async () => {
            const resolved = await workflowEditorApi.resolve(scope, versionId);
            setSnapshot(JSON.stringify(resolved, null, 2));
            setNotice('Launch snapshot preview only. No execution started.');
          })}>Preview launch snapshot</button>
        </div>
        {snapshot && <details open><summary className="text-sm">Pinned launch snapshot (read-only)</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs">{snapshot}</pre></details>}
      </section>
    </fieldset>}
    </div>
    {loading && <p className="studio-feedback" role="status">Loading workflow...</p>}
    {error && <p role="alert" className="studio-feedback rounded bg-slate-950 p-3 text-rose-300">{error} Your local edits are not discarded.
      <button className={buttonClass} aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></p>}
    {notice && <p role="status" className="studio-feedback bg-slate-950 p-3 text-emerald-300"><span>{notice}</span>
      <button className={buttonClass} aria-label="Dismiss notification" onClick={() => setNotice('')}>Dismiss</button></p>}
    {connectionFrom && <p className="studio-connection-banner" role="status">
      Connect from {draft?.nodes.find((item) => item.id === connectionFrom)?.label}: click a target node.
      <button className={buttonClass} onClick={() => setConnectionFrom('')}>Cancel connection</button>
    </p>}
    {draft && state && <fieldset disabled={pending || loading} className="studio-layout">
      <aside id="studio-build-panel" hidden={!buildOpen} className="studio-palette" aria-label="Workflow palette">
        <div className="studio-panel-heading"><span className="studio-eyebrow">01 / BUILD</span><h2>Add an element</h2>
          <button className={buttonClass} aria-label="Close add element" onClick={() => setBuildOpen(false)}>Close</button></div>
        <div className="studio-node-palette">
          <button onClick={() => addNode('agent')}><span className="studio-node-icon agent">AI</span><span>Add agent step<small>Reason, draft, review</small></span><span>+</span></button>
          <button onClick={() => addNode('hook')}><span className="studio-node-icon hook">HK</span><span>Add hook step<small>Checkpoints & lifecycle</small></span><span>+</span></button>
          <button onClick={() => addNode('approval')}><span className="studio-node-icon approval">OK</span><span>Add approval step<small>Human-in-the-loop</small></span><span>+</span></button>
        </div>
        <div className="studio-library">
          <button className={buttonClass} onClick={() => {
            setBuildOpen(false); setConfigureOpen(true); setNodeId(''); setResourceId('');
          }}>Manage definitions</button>
          <p className="mt-2 text-xs text-slate-400">Browse agents, prompts, skills and hooks.</p>
        </div>
      </aside>
      <div className="studio-stage">
        <WorkflowCanvas document={draft} selected={nodeId} disabled={pending} connecting={!!connectionFrom}
          onSelect={clickNode} onDeselect={clearSelection} onConfigure={selectNode} onDuplicate={duplicateNode} onDelete={removeNode}
          onConnect={(id) => { setConnectionFrom(id); setBuildOpen(false); setConfigureOpen(false); setWorkflowOpen(false); }}
          onMove={(id, x, y) => setDraft((current) => current && ({ ...current, nodes: current.nodes.map((item) => item.id === id ? { ...item, x, y } : item) }))} />
      </div>
      <aside id="studio-configure-panel" hidden={!configureOpen} ref={inspector} className="studio-inspector" aria-label="Node inspector">
        <div className="studio-panel-heading"><span className="studio-eyebrow">03 / CONFIGURE</span><h2>{node?.label || selectedResource?.name || 'Select a node'}</h2>
          <button className={buttonClass} aria-label="Close configuration" onClick={clearSelection}>Close</button></div>
        <section className="space-y-3 rounded-xl border border-slate-700 p-3" aria-label="Step and connections">
          <h2 className="font-semibold">Step and connections</h2>
          <Select label="Selected step" value={nodeId} onChange={selectNode}>
            <option value="">Choose a step</option>{draft.nodes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
          {node && <>
            <Field label="Step label" value={node.label} onChange={(label) => setDraft({ ...draft, nodes: draft.nodes.map((item) => item.id === node.id ? { ...item, label } : item) })} />
            {node.kind !== 'approval' && <Select label="Step definition" value={node.referenceId}
              onChange={(referenceId) => {
                setDraft({ ...draft, nodes: draft.nodes.map((item) => item.id === node.id ? { ...item, referenceId } : item) });
                setLibrary(node.kind === 'agent' ? 'agents' : 'hooks'); setResourceId(referenceId);
              }}>
              {(node.kind === 'agent' ? draft.agents : draft.hooks).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>}
            <button className={buttonClass} disabled={draft.nodes.length <= 1} onClick={() => removeNode(node.id)}>Remove step</button>
          </>}
          <details className="space-y-3">
          <summary className="cursor-pointer text-xs text-cyan-200">Connections ({draft.edges.length})</summary>
          <Select label="Connect from" value={from} onChange={setFrom}><option value="">Choose source</option>
            {draft.nodes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          <Select label="Connect to" value={to} onChange={setTo}><option value="">Choose target</option>
            {draft.nodes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          <button className={buttonClass} disabled={!from || !to || from === to || draft.edges.some((edge) => edge.from === from && edge.to === to)}
            onClick={() => setDraft({ ...draft, edges: [...draft.edges, { from, to }] })}>Connect steps</button>
          <ul className="space-y-1 text-xs">{draft.edges.map((edge, index) => <li key={`${edge.from}:${edge.to}`}>
            {draft.nodes.find((item) => item.id === edge.from)?.label} → {draft.nodes.find((item) => item.id === edge.to)?.label}{' '}
            <button className="underline" aria-label={`Remove connection ${index + 1}`}
              onClick={() => setDraft({ ...draft, edges: draft.edges.filter((_, i) => i !== index) })}>Remove</button>
          </li>)}</ul>
          </details>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-700 p-3" aria-label="Definition inspector">
          <h2 className="font-semibold">Definition inspector</h2>
          <Select label="Definition type" value={library} onChange={(value) => {
            if (value === 'agents' || value === 'skills' || value === 'prompts' || value === 'hooks') { setLibrary(value); setResourceId(''); }
          }}>{(['agents', 'prompts', 'skills', 'hooks'] as const).map((value) => <option key={value} value={value}>{value}</option>)}</Select>
          <Select label="Definition" value={resourceId} onChange={setResourceId}><option value="">Choose definition</option>
            {draft[library].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <button className={buttonClass} onClick={addResource}>Add definition</button>
          <p className="text-xs text-slate-400">Skills are editable copies, not changes to bundled server files.</p>
          {selectedResource && <><p className="font-mono text-xs text-slate-400">{selectedResource.id}</p>
            <Field label="Definition name" value={selectedResource.name} onChange={(name) => update(library, selectedResource.id, { name })} />
          </>}
          {agent && <>
            <Field label="Agent role" value={agent.role} onChange={(role) => update('agents', agent.id, { role })} multiline />
            <Select label="Agent prompt" value={agent.promptId} onChange={(promptId) => update('agents', agent.id, { promptId })}>
              {draft.prompts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            <button className={buttonClass} onClick={() => { setLibrary('prompts'); setResourceId(agent.promptId); }}>Edit linked prompt</button>
            <fieldset className="space-y-1"><legend className="text-xs">Agent skills</legend>{draft.skills.map((item) => <label key={item.id} className="block text-xs">
              <input type="checkbox" checked={agent.skillIds.includes(item.id)} onChange={(event) => update('agents', agent.id, {
                skillIds: event.target.checked ? [...agent.skillIds, item.id] : agent.skillIds.filter((id) => id !== item.id),
              })} /> {item.name}</label>)}</fieldset>
            <Select label="Runtime provider" value={agent.provider} onChange={(value) => update('agents', agent.id, { provider: workflowAgentSchema.shape.provider.parse(value) })}>
              {workflowAgentSchema.shape.provider.options.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
            <Field label="Model (empty inherits runtime default)" value={agent.model} onChange={(model) => update('agents', agent.id, { model })} />
            <Select label="Autonomy" value={agent.autonomy} onChange={(value) => update('agents', agent.id, { autonomy: workflowAgentSchema.shape.autonomy.parse(value) })}>
              {workflowAgentSchema.shape.autonomy.options.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
            <ListField key={agent.id} label="Allowed tools (comma separated)" values={agent.tools} onChange={(tools) => update('agents', agent.id, { tools })} />
            <label className="block text-xs">Maximum iterations<input className={inputClass} type="number" min={1} max={100}
              value={agent.maxIterations} onChange={(event) => update('agents', agent.id, { maxIterations: Number(event.target.value) })} /></label>
            <p className="text-xs text-amber-200">Provider availability and permissions are not granted by this design.</p>
          </>}
          {prompt && <>
            <Field label="Prompt template" value={prompt.template} onChange={(template) => update('prompts', prompt.id, { template })} multiline />
            <ListField key={prompt.id} label="Template variables (comma separated)" values={prompt.variables} onChange={(variables) => update('prompts', prompt.id, { variables })} />
          </>}
          {skill && <>
            <Field label="Skill description" value={skill.description} onChange={(description) => update('skills', skill.id, { description })} />
            <Field label="Skill instructions (Markdown)" value={skill.instructions} onChange={(instructions) => update('skills', skill.id, { instructions })} multiline />
          </>}
          {hook && <>
            <Select label="Hook event" value={hook.event} onChange={(value) => update('hooks', hook.id, { event: workflowHookSchema.shape.event.parse(value) })}>
              {workflowHookSchema.shape.event.options.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
            <Select label="Hook action" value={hook.action} onChange={(value) => update('hooks', hook.id, { action: workflowHookSchema.shape.action.parse(value), script: '' })}>
              {workflowHookSchema.shape.action.options.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
            {hook.action === 'script' && <Field label="Hook script (inactive)" value={hook.script} onChange={(script) => update('hooks', hook.id, { script })} multiline />}
            <label className="block text-xs">Hook timeout (ms)<input className={inputClass} type="number" min={100} max={60000}
              value={hook.timeoutMs} onChange={(event) => update('hooks', hook.id, { timeoutMs: Number(event.target.value) })} /></label>
            <p className="text-xs text-amber-200">Explicit server-side authorization is required for scripts. No script runner is connected; saving or publishing never authorizes execution.</p>
          </>}
          {selectedResource && <><button className={buttonClass} disabled={used} onClick={() => {
            setDraft({ ...draft, [library]: draft[library].filter((item) => item.id !== resourceId) }); setResourceId('');
          }}>Delete definition</button>{used && <p className="text-xs text-slate-400">Referenced definitions cannot be deleted. Remove or change their references first.</p>}</>}
        </section>
      </aside>
    </fieldset>}
    <div className="studio-dock" hidden={!dockOpen}>
      <button className="studio-dock-toggle" aria-expanded={dockOpen} aria-controls="workflow-test-dock"
        onClick={() => setDockOpen((open) => !open)}><span className="studio-eyebrow">04 / SIMULATE</span><span>Test console & results</span><span>{dockOpen ? 'Collapse -' : 'Expand +'}</span></button>
      <div id="workflow-test-dock" hidden={!dockOpen} className="studio-dock-content">
        {publishedVersion ? <WorkflowTestPanel key={`${scope}:${versionId}`} scope={scope} version={publishedVersion} />
          : <p className="p-4 text-sm text-slate-400">Save and publish a version, then select it to configure real or mock test agents.</p>}
      </div>
    </div>
  </section>;
}
