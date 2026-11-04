import { Loader2, Sparkles } from 'lucide-react';
import type { TaskAutoSpec } from '../data/useTaskAutoSpec';
import { MarkdownPreview } from './MarkdownPreview';

/** Progress of a running generation; it sits outside the fieldset the generation disables so Cancel stays clickable. */
export function TaskAutoSpecStatus({ spec }: { spec: Pick<TaskAutoSpec, 'generating' | 'cancel'> }) {
  if (!spec.generating) return null;
  return (
    <p role="status" className="text-xs text-indigo-300">
      Copilot is preparing the specification and checking available project context...{' '}
      <button type="button" className="underline" onClick={spec.cancel}>Cancel generation</button>
    </p>
  );
}

export function TaskAutoSpecButton({ spec, disabled, onGenerate }: {
  spec: Pick<TaskAutoSpec, 'generating'>;
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={spec.generating || disabled}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg border border-amber-500/30 transition-all disabled:opacity-50 cursor-pointer"
      title="Use Copilot and the ticket-graphify skill to analyze code impact and generate a specification"
    >
      {spec.generating ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
          <span>Generating spec...</span>
        </>
      ) : (
        <>
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Copilot Auto-Spec</span>
        </>
      )}
    </button>
  );
}

/** Outcome of the last generation: a dismissible notice and the code impact analysis to review before saving. */
export function TaskAutoSpecResult({ spec }: { spec: Pick<TaskAutoSpec, 'feedback' | 'impactAnalysis' | 'dismissFeedback'> }) {
  return (
    <>
      {spec.feedback && (
        <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-300 flex items-center justify-between">
          <span>{spec.feedback}</span>
          <button
            type="button"
            onClick={spec.dismissFeedback}
            className="text-xs text-indigo-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
      {spec.impactAnalysis && <details className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-indigo-300">Code impact analysis</summary>
        <div className="mt-3 max-h-80 overflow-auto"><MarkdownPreview source={spec.impactAnalysis} /></div>
      </details>}
    </>
  );
}
