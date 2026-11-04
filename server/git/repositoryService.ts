import { createGit } from './gitCommand';
import { GitOperationsService } from './gitOperationsService';
import { GitPublicationService } from './gitPublicationService';
import { WorkspaceService } from './workspaceService';

export { checkBranch, checkRepositoryUrl, RepositoryError } from './gitCommand';

/**
 * Wires the git services around one command runner:
 * - `workspaces` clones projects, switches their branch and manages ticket worktrees;
 * - `operations` reviews, commits, merges and tags inside those clones;
 * - `publication` pushes branches and tags to the origin remote.
 */
export class RepositoryService {
  readonly workspaces: WorkspaceService;
  readonly operations: GitOperationsService;
  readonly publication: GitPublicationService;

  constructor(root: string, options: { localRoots?: string[]; timeoutMs?: number } = {}) {
    const git = createGit(options.timeoutMs);
    this.workspaces = new WorkspaceService(root, git, options.localRoots);
    this.operations = new GitOperationsService(this.workspaces, git);
    this.publication = new GitPublicationService(this.workspaces, this.operations, git);
  }
}
