import { z } from 'zod';

export const MAX_CONTEXT_FILES = 10;
export const MAX_CONTEXT_FILE_BYTES = 1024 * 1024;
export const MAX_CONTEXT_TOTAL_BYTES = 3 * 1024 * 1024;

export const contextFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).refine((name) => !/[/\\\u0000-\u001f\u007f]/.test(name), 'Invalid file name'),
  mimeType: z.string().max(200).regex(/^[\w.+-]+\/[\w.+-]+$/),
  size: z.number().int().nonnegative().max(MAX_CONTEXT_FILE_BYTES),
  data: z.string().max(4 * Math.ceil(MAX_CONTEXT_FILE_BYTES / 3))
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid base64 file data'),
}).superRefine((file, ctx) => {
  const padding = file.data.endsWith('==') ? 2 : file.data.endsWith('=') ? 1 : 0;
  if (file.data.length / 4 * 3 - padding !== file.size) {
    ctx.addIssue({ code: 'custom', message: 'File size does not match its contents' });
  }
});

export const contextFilesSchema = z.array(contextFileSchema).max(MAX_CONTEXT_FILES).superRefine((files, ctx) => {
  if (files.reduce((total, file) => total + file.size, 0) > MAX_CONTEXT_TOTAL_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Context files must total at most 3 MiB' });
  }
  if (new Set(files.map((file) => file.id)).size !== files.length) {
    ctx.addIssue({ code: 'custom', message: 'Context file IDs must be unique' });
  }
});

export type ContextFile = z.infer<typeof contextFileSchema>;
