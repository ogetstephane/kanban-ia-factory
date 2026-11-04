import { z } from 'zod';

export const archifyDiagramSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  generatedAt: z.string().nullable(),
  origin: z.enum(['manual', 'analysis']).optional(),
  revision: z.string().nullable().optional(),
});

export const archifyDiagramListSchema = z.object({ diagrams: z.array(archifyDiagramSchema) });

export type ArchifyDiagram = z.infer<typeof archifyDiagramSchema>;

export function archifyViewUrl(diagram: Pick<ArchifyDiagram, 'id' | 'generatedAt'>) {
  return `/api/board/archify/${encodeURIComponent(diagram.id)}/view?v=${encodeURIComponent(diagram.generatedAt ?? '')}`;
}
