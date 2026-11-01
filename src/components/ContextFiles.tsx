import { useId } from 'react';
import type { ContextFile } from '../types/contextFile';
import { useOperation } from '../data/useOperation';
import { downloadContextFile, readContextFiles } from '../data/contextFiles';

interface Props {
  files: ContextFile[];
  onChange: (files: ContextFile[]) => void;
  operation: ReturnType<typeof useOperation>;
  help?: string;
}

export function ContextFiles({ files, onChange, operation, help = 'Files are stored when you save the task and sent to Copilot in future sessions.' }: Props) {
  const inputId = useId();
  return <section aria-label="Context files" className="space-y-2">
    <label htmlFor={inputId} className="block text-xs font-semibold text-slate-300">Upload context files</label>
    <p id={`${inputId}-help`} className="text-xs text-slate-400">
      Any file type, including PDFs and images. Up to 10 files, 1 MiB each, 3 MiB total.
      {' '}{help}
    </p>
    <input
      id={inputId}
      type="file"
      multiple
      disabled={operation.pending}
      aria-describedby={`${inputId}-help`}
      className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-500/20 file:px-3 file:py-2 file:text-indigo-200"
      onChange={(event) => {
        const selected = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (selected.length) void operation.run(async () => onChange(await readContextFiles(selected, files)));
      }}
    />
    {operation.pending && <p role="status" className="text-xs text-indigo-300">Reading context files...</p>}
    {operation.error && <p role="alert" className="text-xs text-red-300">{operation.error}</p>}
    <ul className="space-y-2">
      {files.map((file) => <li key={file.id} className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-xs">
        <span className="min-w-0 flex-1 break-words">{file.name} ({Math.ceil(file.size / 1024)} KiB)</span>
        <button type="button" disabled={operation.pending} className="text-indigo-300 underline"
          aria-label={`Download ${file.name}`} onClick={() => { void operation.run(async () => downloadContextFile(file)); }}>Download</button>
        <button type="button" disabled={operation.pending} className="text-red-300 underline"
          aria-label={`Remove ${file.name}`} onClick={() => { operation.clearError(); onChange(files.filter((item) => item.id !== file.id)); }}>Remove</button>
      </li>)}
    </ul>
  </section>;
}
