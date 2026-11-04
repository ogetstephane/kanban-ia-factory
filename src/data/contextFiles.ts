import {
  contextFileSchema, contextFilesSchema, MAX_CONTEXT_FILE_BYTES, MAX_CONTEXT_FILES, MAX_CONTEXT_TOTAL_BYTES,
  type ContextFile,
} from '../../shared/types/contextFile';

export async function readContextFiles(files: File[], existing: ContextFile[]): Promise<ContextFile[]> {
  if (existing.length + files.length > MAX_CONTEXT_FILES) throw new Error('A task can have at most 10 context files.');
  if ([...existing, ...files].reduce((total, file) => total + file.size, 0) > MAX_CONTEXT_TOTAL_BYTES) {
    throw new Error('Context files must total at most 3 MiB.');
  }
  const uploaded = await Promise.all(files.map(async (file) => {
    if (file.size > MAX_CONTEXT_FILE_BYTES) throw new Error(`${file.name}: maximum file size is 1 MiB.`);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}. Try uploading it again.`));
      reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
      reader.onload = () => {
        if (typeof reader.result !== 'string' || !reader.result.includes(',')) {
          reject(new Error(`Unable to read ${file.name}.`));
        } else {
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        }
      };
      reader.readAsDataURL(file);
    });
    return contextFileSchema.parse({
      id: crypto.randomUUID(), name: file.name, size: file.size,
      mimeType: file.type || 'application/octet-stream', data,
    });
  }));
  return contextFilesSchema.parse([...existing, ...uploaded]);
}

export function downloadContextFile(file: ContextFile) {
  const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
