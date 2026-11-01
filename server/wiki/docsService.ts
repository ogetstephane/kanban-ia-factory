import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_DOCS_PATH, docsPathSchema } from '../../src/types/board';
import type { DocFile, DocSaveResult, DocStatus, DocSyncResult } from '../../src/types/wiki';
import { activityChanges, recordActivity } from '../db/activityLog';
import { EntityError } from '../db/entityStore';
import { RepositoryError, type RepositoryService } from '../git/repositoryService';

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const MAX_DEPTH = 8;
const EXTENSION = /\.(md|markdown|mdx)$/i;
const SEGMENT = /^[^\0/\\:*?"<>|]{1,120}$/;

const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const exists = (target: string) => lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

export function checkDocPath(raw: string) {
  const segments = raw.split('/');
  if (!raw || raw.length > 300 || segments.length > MAX_DEPTH + 1 || !EXTENSION.test(raw)
    || segments.some((part) => part.startsWith('.') || !SEGMENT.test(part))) {
    throw new RepositoryError(400, 'Use a relative Markdown file path (.md, .markdown or .mdx) without hidden or special folders');
  }
  return segments.join('/');
}

export class DocsService {
  constructor(private readonly db: PrismaClient, private readonly repositories: RepositoryService) {}

  private async target(projectId: string) {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new EntityError(404, 'Project not found');
    if (!project.repositoryUrl) throw new RepositoryError(400, 'This project has no git repository, so it has no wiki');
    const docsPath = docsPathSchema.parse(project.docsPath ?? DEFAULT_DOCS_PATH);
    const { cwd, branch } = await this.repositories.docsWorkspace(projectId);
    return { project, docsPath, cwd, branch, root: path.join(cwd, ...docsPath.split('/')) };
  }

  /** Every existing folder from the clone down to the target must be a real directory, never a symlink. */
  private async assertPlainPath(base: string, relative: string) {
    let current = base;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!info) return;
      if (info.isSymbolicLink()) throw new RepositoryError(400, 'Symbolic links are not allowed in the documentation folder');
    }
  }

  async list(projectId: string): Promise<{ docsPath: string; branch: string | null; files: DocFile[] }> {
    const { docsPath, branch, cwd, root } = await this.target(projectId);
    await this.assertPlainPath(cwd, docsPath);
    const files: DocFile[] = [];
    const walk = async (folder: string, prefix: string, depth: number) => {
      const entries = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= MAX_FILES || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH) await walk(path.join(folder, entry.name), relative, depth + 1);
        } else if (entry.isFile() && EXTENSION.test(entry.name) && SEGMENT.test(entry.name)) {
          const info = await lstat(path.join(folder, entry.name));
          files.push({ path: relative, size: info.size, modifiedAt: info.mtime.toISOString() });
        }
      }
    };
    await walk(root, '', 0);
    return { docsPath, branch, files };
  }

  async read(projectId: string, requested: string) {
    const file = checkDocPath(requested);
    const { docsPath, cwd, root } = await this.target(projectId);
    await this.assertPlainPath(cwd, `${docsPath}/${file}`);
    const location = path.join(root, ...file.split('/'));
    if (!await exists(location)) throw new RepositoryError(404, 'Document not found');
    const content = await this.readExisting(location);
    return { path: file, content, sha: sha(content) };
  }

  /** Pending documentation changes (relative to the docs folder) and commits not yet pushed. */
  async status(projectId: string): Promise<DocStatus> {
    const { docsPath } = await this.target(projectId);
    const { changes, ahead } = await this.repositories.docsChanges(projectId, docsPath);
    const pending = changes.filter((change) => change.path.startsWith(`${docsPath}/`))
      .map((change) => ({ path: change.path.slice(docsPath.length + 1), status: change.status }))
      .filter((change) => { try { checkDocPath(change.path); return true; } catch { return false; } });
    return { pending, ahead };
  }

  /** Writes a document to the working tree only. Nothing is committed until sync. */
  async save(projectId: string, requested: string, content: string, expectedSha: string | null): Promise<DocSaveResult> {
    const file = checkDocPath(requested);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new RepositoryError(413, 'Documents are limited to 1 MB');
    return this.repositories.withProjectLock(projectId, async () => {
      const { docsPath, cwd, root } = await this.target(projectId);
      const repoFile = `${docsPath}/${file}`;
      await this.assertPlainPath(cwd, repoFile);
      const location = path.join(root, ...file.split('/'));
      const previous = await exists(location) ? await this.readExisting(location) : null;
      if (previous === null && expectedSha !== null) throw new RepositoryError(409, 'This document was deleted or moved. Reload the wiki.');
      if (previous !== null && sha(previous) !== expectedSha) {
        throw new RepositoryError(409, 'This document changed since you opened it. Reload it before saving to avoid overwriting changes.');
      }
      if (previous === content) return { path: file, sha: sha(content), unchanged: true };

      await mkdir(path.dirname(location), { recursive: true });
      await this.assertPlainPath(cwd, repoFile);
      const temporary = path.join(path.dirname(location), `.wiki-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, location);
      } finally { await rm(temporary, { force: true }); }
      return { path: file, sha: sha(content), unchanged: false };
    });
  }

  /** Commits every pending documentation file on the project branch, then pushes best effort. */
  async sync(projectId: string): Promise<DocSyncResult> {
    return this.repositories.withProjectLock(projectId, async () => {
      const { docsPath, project } = await this.target(projectId);
      const { branch } = await this.repositories.assertDocsCommittable(projectId);
      const { pending, ahead } = await this.status(projectId);
      if (!pending.length && !ahead) return { branch, commit: null, files: 0, pushed: false };
      const files = pending.map((change) => `${docsPath}/${change.path}`);
      let commit: string | null = null;
      if (files.length) {
        const message = files.length === 1
          ? `docs: ${pending[0].status === 'added' ? 'add' : 'update'} ${pending[0].path}`
          : `docs: update ${files.length} documents`;
        try { commit = await this.repositories.commitDocs(projectId, files, message); }
        catch (error) { await this.repositories.unstageDocs(projectId, files); throw error; }
      }
      const push = await this.repositories.pushCheckedOutBranch(projectId);
      await this.db.$transaction((tx) => recordActivity(tx, {
        projectId, projectName: project.name, entityType: 'project', entityId: projectId, entityTitle: project.name,
        action: 'docs_saved', summary: `Documentation synced: ${files.length} ${files.length === 1 ? 'file' : 'files'}`,
        changes: activityChanges(null, { Branch: branch, Commit: commit?.slice(0, 7), Pushed: push.pushed ? 'yes' : 'no' }, [
          { key: 'Branch', label: 'Branch' }, { key: 'Commit', label: 'Commit' }, { key: 'Pushed', label: 'Pushed' },
        ]),
      })).catch((error: unknown) => console.error(`Unable to record documentation activity for ${projectId}:`, error));
      return { branch, commit, files: files.length, pushed: push.pushed, pushError: push.reason };
    });
  }

  private async readExisting(location: string) {
    const info = await lstat(location);
    if (!info.isFile()) throw new RepositoryError(400, 'Not a regular file');
    if (info.size > MAX_BYTES) throw new RepositoryError(413, 'This document is larger than 1 MB and cannot be edited here');
    return readFile(location, 'utf8');
  }
}
