import { Eye, Sparkles } from 'lucide-react';

export default function ReviewActions({ title, onReview }: {
  title: string;
  onReview: (ai: boolean) => void;
}) {
  return <div className="my-2 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
    <button type="button" aria-label={`Manually review ${title}`} onClick={() => onReview(false)}
      className="inline-flex items-center gap-1 rounded-lg border border-purple-400/30 bg-purple-500/10 px-2 py-1.5 text-xs text-purple-200 hover:bg-purple-500/20">
      <Eye className="h-3.5 w-3.5" /> Manual review
    </button>
    <button type="button" aria-label={`AI review ${title}`} onClick={() => onReview(true)}
      className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/20">
      <Sparkles className="h-3.5 w-3.5" /> AI review
    </button>
  </div>;
}
