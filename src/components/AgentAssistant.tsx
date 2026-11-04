import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { ContextFiles } from './ContextFiles';
import { MarkdownPreview } from './MarkdownPreview';
import { useOperation } from '../data/useOperation';
import type { ContextFile } from '../../shared/types/contextFile';

export interface AssistantInput { prompt: string; files: ContextFile[] }
export interface AssistantProposal { content: string; summary: string }
interface Props {
  content: string;
  disabled?: boolean;
  onGenerate: (input: AssistantInput, signal: AbortSignal) => Promise<AssistantProposal>;
  onApply: (content: string) => void;
}

export function AgentAssistant({ content, disabled = false, onGenerate, onApply }: Props) {
  const id = useId();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [proposal, setProposal] = useState<{ result: AssistantProposal; source: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const upload = useOperation();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const generate = async () => {
    if (!prompt.trim() || pending || upload.pending || disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError(''); setProposal(null);
    const source = content;
    try {
      const result = await onGenerate({ prompt: prompt.trim(), files }, controller.signal);
      if (!controller.signal.aborted) setProposal({ result, source });
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error('Agent assistant failed:', cause);
        setError(cause instanceof Error ? cause.message : 'Unable to generate content. Please retry.');
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  const stale = proposal !== null && proposal.source !== content;
  return <section aria-label="Agent assistant" className="space-y-3 rounded-xl border border-indigo-400/20 bg-indigo-400/5 p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-200"><Sparkles className="h-4 w-4" />Agent assistant</h2>
    <p className="text-xs text-slate-400">Create or improve this page with Copilot. Review the proposal before applying it. Save and Sync remain manual.</p>
    <fieldset disabled={disabled || pending} className="space-y-3">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-300">Assistant prompt</label>
      <textarea id={id} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={10000}
        placeholder="Describe the page to create, or how to improve the current content..."
        className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100" />
      <ContextFiles files={files} onChange={setFiles} operation={upload}
        help="Attachments are sent to Copilot for this proposal only, not saved with the wiki page. The wiki draft, prompt and files must total at most 100,000 bytes. Do not upload secrets." />
      <button type="button" disabled={!prompt.trim() || upload.pending} onClick={() => void generate()}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? 'Generating...' : 'Generate proposal'}
      </button>
    </fieldset>
    {pending && <div className="flex items-center gap-3 text-xs text-indigo-200" role="status">Copilot is preparing a proposal...
      <button type="button" className="underline" onClick={() => { active.current?.abort(); active.current = null; setPending(false); }}>Cancel generation</button>
    </div>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
    {proposal && <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-200">Proposed content</h3>
      <p className="whitespace-pre-wrap text-xs text-slate-300">{proposal.result.summary}</p>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-4"><MarkdownPreview source={proposal.result.content} /></div>
      {stale && <p role="alert" className="text-xs text-amber-200">The page changed after generation. Generate a fresh proposal before applying.</p>}
      <button type="button" disabled={disabled || stale || upload.pending} onClick={() => { onApply(proposal.result.content); setProposal(null); }}
        className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Apply to editor</button>
      <button type="button" className="ml-3 text-xs text-slate-300 underline" onClick={() => setProposal(null)}>Discard proposal</button>
    </div>}
  </section>;
}
