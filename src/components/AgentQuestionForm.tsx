import { useState } from 'react';
import type { z } from 'zod';
import { agentQuestionSchema } from '../../shared/types/agent';

type Question = z.infer<typeof agentQuestionSchema>;

export default function AgentQuestionForm({ question, pending, onAnswer }: {
  question: Question;
  pending: boolean;
  onAnswer: (answer: string) => Promise<unknown>;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <form className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/5 space-y-3"
      onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void onAnswer(answer.trim()); }}>
      <p className="font-semibold text-amber-200">The agent needs your answer</p>
      <p className="whitespace-pre-wrap">{question.question}</p>
      {question.choices.length > 0 && <div className="flex flex-wrap gap-2">
        {question.choices.map((choice, index) => <button key={index} type="button" disabled={pending}
          aria-pressed={answer === choice} onClick={() => setAnswer(choice)}
          className={`px-3 py-2 rounded-lg border ${answer === choice ? 'border-indigo-400 bg-indigo-600/30' : 'border-slate-600 bg-slate-800'}`}>{choice}</button>)}
      </div>}
      {question.allowFreeform && <label className="block">
        <span className="block text-slate-400 mb-1">Your answer</span>
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={pending} maxLength={20_000} rows={3}
          className="w-full bg-slate-900 rounded-lg border border-slate-600 p-2" />
      </label>}
      <button type="submit" disabled={pending || !answer.trim()}
        className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Send answer & resume</button>
    </form>
  );
}
