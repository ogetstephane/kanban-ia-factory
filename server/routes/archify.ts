import { Router, type NextFunction, type Request, type Response } from 'express';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ArchifyDiagram {
  id: string;
  title: string;
  type: string;
  generatedAt: string | null;
  origin: 'manual' | 'analysis';
  revision: string | null;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

// Archify pages are self-contained (inline scripts, styles and fonts). They run in an
// opaque-origin sandbox; downloads stay allowed for the viewer's PNG/SVG exports.
const VIEW_POLICY = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", 'img-src data: blob:', 'font-src data:',
  "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts allow-downloads',
].join('; ');

class NotFound extends Error {}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Lists hand-authored sources and sources produced by the local code analysis. */
export async function listArchifyDiagrams(directory: string): Promise<ArchifyDiagram[]> {
  const sources = new Map<string, { file: string; origin: ArchifyDiagram['origin'] }>();
  for (const [folder, origin] of [
    [directory, 'manual'],
    [path.join(directory, 'generated', 'sources'), 'analysis'],
  ] as const) {
    let files: string[];
    try { files = await readdir(folder); } catch (error) { if (missing(error)) continue; throw error; }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (!ID.test(id)) continue;
      if (sources.has(id)) throw new Error(`Duplicate Archify diagram source: ${id}`);
      sources.set(id, { file: path.join(folder, file), origin });
    }
  }
  return Promise.all([...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(async ([id, entry]) => {
    let title = id;
    let type = 'unknown';
    let revision: string | null = null;
    try {
      const spec = JSON.parse(await readFile(entry.file, 'utf8'));
      if (typeof spec?.meta?.title === 'string' && spec.meta.title.trim()) title = spec.meta.title;
      if (typeof spec?.diagram_type === 'string') type = spec.diagram_type;
      if (typeof spec?.meta?.repository?.revision === 'string') revision = spec.meta.repository.revision;
    } catch (error) {
      console.error(`Unable to read Archify source ${entry.file}:`, error);
    }
    let generatedAt: string | null = null;
    try { generatedAt = (await stat(path.join(directory, 'generated', `${id}.html`))).mtime.toISOString(); }
    catch (error) { if (!missing(error)) throw error; }
    return { id, title, type, generatedAt, origin: entry.origin, revision };
  }));
}

export function createArchifyRouter(directory: string) {
  const router = Router();
  router.use('/archify', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.get('/archify', async (_req, res, next) => {
    try { res.json({ diagrams: await listArchifyDiagrams(directory) }); } catch (error) { next(error); }
  });

  router.get('/archify/:id/view', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!ID.test(id)) throw new NotFound('Unknown diagram');
      let html: string;
      try { html = await readFile(path.join(directory, 'generated', `${id}.html`), 'utf8'); }
      catch (error) { if (missing(error)) throw new NotFound('This diagram has not been generated yet. Run `make archify`.'); throw error; }
      res.setHeader('Content-Security-Policy', VIEW_POLICY);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.type('html').send(html);
    } catch (error) { next(error); }
  });

  router.use('/archify', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof NotFound) res.status(404).json({ error: error.message });
    else {
      console.error('Archify request failed:', error);
      res.status(500).json({ error: 'Unable to load the Archify diagrams' });
    }
  });
  return router;
}
