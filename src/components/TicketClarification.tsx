import { useId } from 'react';
import type { TicketClarification as Clarification } from '../../shared/types/ticketClarification';

export function TicketClarification({ clarification, answers, onChange, onGenerate, onDiscard, disabled }: {
  clarification: Clarification;
  answers: string[];
  onChange: (index: number, answer: string) => void;
  onGenerate: () => void;
  onDiscard: () => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <section aria-label="Ticket clarification" className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300">
      <h3 className="font-semibold text-amber-200">Clarify the need before drafting</h3>
      <p>{clarification.reason}</p>
      <p>Answers are unsaved reference data. Do not include secrets. Generating from answers starts another AI request, not ticket execution.</p>
      {clarification.questions.map((question, index) => (
        <div key={index} className="space-y-1">
          <label htmlFor={`${id}-${index}`} className="block font-semibold">{question}</label>
          <textarea id={`${id}-${index}`} value={answers[index] ?? ''} maxLength={4000} rows={3}
            disabled={disabled} onChange={(event) => onChange(index, event.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-slate-100" />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="button" disabled={disabled || clarification.questions.some((_, index) => !answers[index]?.trim())}
          onClick={onGenerate} className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
          Generate from answers
        </button>
        <button type="button" disabled={disabled} onClick={onDiscard} className="underline">Discard questions</button>
      </div>
    </section>
  );
}
