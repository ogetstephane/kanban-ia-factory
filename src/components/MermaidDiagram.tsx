import React, { useEffect, useState } from 'react';

let counter = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      import('mermaid').then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
        try {
          const result = await mermaid.render(`mermaid-${++counter}`, code);
          if (!cancelled) { setSvg(result.svg); setError(null); }
        } catch (err) {
          document.getElementById(`dmermaid-${counter}`)?.remove();
          if (!cancelled) { setSvg(null); setError(err instanceof Error ? err.message : 'Invalid diagram'); }
        }
      }).catch(() => { if (!cancelled) setError('Mermaid could not be loaded'); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [code]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
        <p className="mb-2 text-xs font-medium text-rose-300">Mermaid: {error.split('\n')[0]}</p>
        <pre className="overflow-x-auto text-xs text-slate-300"><code>{code}</code></pre>
      </div>
    );
  }
  if (!svg) return <div className="my-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-500">Rendering diagram…</div>;
  return <div className="my-4 flex justify-center overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}
