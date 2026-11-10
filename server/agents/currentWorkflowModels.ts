import {
  workflowDocumentSchema, WORKFLOW_SCOPE_NAMES, type RuntimeWorkflowScope, type WorkflowDocument,
} from '../../shared/types/workflowEditor';
import { assistantModeConfiguration, ASSISTANT_PLANNING_SKILL } from './assistantModes';
import { taskAuthoringInstructions, TICKET_AUTHORING_SKILLS } from './taskAssistant';
import { wikiAuthoringInstructions } from '../wiki/wikiAssistant';
import { ticketSessionInstructions } from './ticketSession';
import { GRAPHIFY_SKILL_INSTRUCTION } from './graphifySkill';
import { loadWorkflowSkills } from './workflowEditorDefaults';
import { prebuiltWorkflow } from './prebuiltWorkflows';

const readTools = ['ticket_list_files', 'ticket_read_file', 'ticket_search_files'];
const graphTools = ['ticket_graph_query', 'ticket_graph_explain', 'ticket_graph_path', 'ticket_graph_affected'];
type Category = NonNullable<WorkflowDocument['operations']>[number]['category'];

/** Reference graphs describe host transitions, including waits/re-entry, not executable DAGs. */
export async function currentWorkflowModel(scope: RuntimeWorkflowScope): Promise<WorkflowDocument> {
  const skills = await loadWorkflowSkills(scope === 'ticket-authoring'
    ? [ASSISTANT_PLANNING_SKILL, ...TICKET_AUTHORING_SKILLS, 'ticket-graphify']
    : scope === 'wiki' ? [ASSISTANT_PLANNING_SKILL] : ['ticket-graphify']);
  const doc: WorkflowDocument = {
    schemaVersion: 1, name: `${WORKFLOW_SCOPE_NAMES[scope]} · current orchestration`,
    description: 'Source-backed model of current orchestration. Host operations, permissions and lifecycle gates are locked. Prompt and skill edits are proposals only; production and preview execution are not connected to this reference graph.',
    runtimeReference: { scope, revision: 1, execution: 'reference-only' },
    operations: [], skills, prompts: [], agents: [], hooks: [], nodes: [], edges: [],
  };
  const host = (id: string, name: string, category: Category, responsibility: string, policy: string, sources: string[], x: number, y: number) => {
    doc.operations!.push({ id, name, category, responsibility, policy, sources });
    doc.nodes.push({ id, kind: 'host', label: name, referenceId: id, x, y });
  };
  const edge = (from: string, to: string, label: string) => doc.edges.push({ from, to, label });
  const agent = (id: string, name: string, role: string, template: string, tools: string[], x: number, y: number) => {
    doc.prompts.push({ id: `${id}-prompt`, name: `${name} system instructions`, template, variables: [] });
    doc.agents.push({ id, name, role, promptId: `${id}-prompt`, skillIds: skills.map((skill) => skill.id),
      provider: scope === 'ticket-processing' ? 'inherit' : 'copilot', model: '', autonomy: 'semi', tools,
      maxIterations: 'runtime-managed' });
    doc.nodes.push({ id, kind: 'agent', label: name, referenceId: id, x, y });
  };
  if (scope === 'ticket-authoring' || scope === 'wiki') {
    const authoring = scope === 'ticket-authoring';
    const source = authoring ? 'server/agents/taskAssistant.ts#TaskAssistant' : 'server/wiki/wikiAssistant.ts#WikiAssistant';
    host('request', authoring ? 'Ticket or breakdown request' : 'Wiki assistant request', 'trigger',
      authoring ? 'Single unsaved ticket or feature breakdown, mode, prior clarification answers, approved plan and attachments.'
        : 'Page path, Markdown, instruction, attachments, mode and optional approved plan.',
      'Request-scoped cancellation. No automatic save.', [authoring ? 'server/routes/taskAssistant.ts#createTaskAssistantRouter' : 'server/routes/wiki.ts#createWikiRouter'], 50, 180);
    host('context', 'Validate and prepare context', 'operation',
      authoring ? 'Validate input and project; prepare project docs workspace when configured, attachments and optional Graphify context.'
        : 'Validate path and document access; enforce the 100,000-byte assistant context budget and 1 MB document limit; prepare attachments.',
      authoring ? 'Read-only workspace tools only when a workspace exists; graph tools only when prepared. No writes or commands.'
        : 'No tools, filesystem, commands or network permissions in the assistant session.',
      [source, ...(authoring ? [] : ['shared/types/wiki.ts#wikiAssistantInputSchema'])], 350, 180);
    host('mode', 'Auto / Plan routing', 'decision',
      'Plan without approvedPlan selects the Plan agent. Auto or any approvedPlan selects Auto. Approved plans cannot produce another plan.',
      'Routing and output contracts are host-enforced, not editable prompt permissions.',
      ['server/agents/assistantModes.ts#assistantAgentName', 'server/agents/assistantModes.ts#parseAssistantOutput'], 650, 180);
    const base = authoring ? taskAuthoringInstructions(false) : wikiAuthoringInstructions();
    const modeAgents = assistantModeConfiguration({ mode: 'auto' }, authoring ? 'ticket specification' : 'wiki page',
      authoring ? TICKET_AUTHORING_SKILLS : []).customAgents;
    for (const [index, item] of modeAgents.entries()) {
      if (!item.description || !item.prompt) throw new Error('Current assistant mode is missing its description or prompt.');
      agent(index === 0 ? 'auto-agent' : 'plan-agent', item.displayName ?? item.name,
        item.description, [base, item.prompt].join('\n'), authoring ? ['skill', ...readTools, ...graphTools] : [],
        950, index === 0 ? 180 : 420);
    }
    if (authoring) {
      const breakdownModes = assistantModeConfiguration({ mode: 'auto' }, 'feature ticket breakdown', TICKET_AUTHORING_SKILLS).customAgents;
      for (const [index, mode] of breakdownModes.entries()) {
        const promptId = index === 0 ? 'auto-breakdown-prompt' : 'plan-breakdown-prompt';
        doc.prompts.push({ id: promptId, name: `${mode.displayName} · feature breakdown`,
          template: [taskAuthoringInstructions(true), mode.prompt].join('\n'), variables: [] });
        doc.agents[index].promptVariants = [{ when: 'Feature breakdown request', promptId }];
      }
    }
    host('output', 'Validate assistant response', 'decision',
      authoring ? 'Strict JSON/schema and requested-mode validation. Breakdown has 1–20 prerequisite-ordered tickets. Clarification is Auto-only, before approval and without previous answers.'
        : 'Strict JSON/schema and requested-mode validation. Proposed Markdown must not exceed 1 MB.',
      'Invalid responses fail explicitly; no invented fallback and no automatic writes.', [source, 'server/agents/assistantModes.ts#parseAssistantOutput'], 1250, 180);
    host('plan-approval', 'Review or edit plan', 'wait', 'The user explicitly approves or edits the proposed plan and submits a new generation request with approvedPlan.',
      'No execution or proposal application before resubmission.', [authoring ? 'src/data/useTaskAutoSpec.ts#useTaskAutoSpec' : 'src/components/AgentAssistant.tsx#AgentAssistant'], 1550, 420);
    host('proposal', authoring ? 'Review ticket proposal' : 'Review Markdown proposal', 'operation',
      authoring ? 'Apply proposal to the local unsaved draft, preserve clarification decisions and show deterministic quality/impact limitations. Breakdown waits for explicit atomic creation.'
        : 'Show the proposal for explicit application to the local editor. Reject application if the source page changed during generation. The assistant does not save it.',
      authoring ? 'Quality heuristics are not semantic approval. User owns acceptance and save.'
        : 'Stale proposals require regeneration. Apply, save and sync are separate explicit actions.',
      [authoring ? 'src/data/useTaskAutoSpec.ts#useTaskAutoSpec' : 'src/components/AgentAssistant.tsx#AgentAssistant',
        ...(authoring ? ['src/components/FeatureBreakdownModal.tsx#FeatureBreakdownModal'] : [])], 1550, 180);
    host('save', authoring ? 'Explicit ticket save / creation' : 'Explicit page save', 'result',
      authoring ? 'Existing ticket mutations or atomic feature breakdown creation run only on user save.'
        : 'Save Markdown with expectedSha concurrency protection inside the configured documentation folder.',
      authoring ? 'Existing entity revision and workflow checks remain authoritative.'
        : 'Path and symlink checks, project lock and SHA concurrency remain authoritative.',
      [authoring ? 'server/db/entityStore.ts#EntityStore' : 'server/wiki/docsService.ts#DocsService'], 1850, 180);
    host('failure', 'Failure / cancellation', 'result', 'Request abort stops the assistant. Authentication, model, input and response errors are surfaced without discarding the local draft.',
      'No replay or automatic persistence.', [source], 1250, 700);
    edge('request', 'context', 'Generation request'); edge('context', 'mode', 'Valid input');
    edge('mode', 'auto-agent', 'Auto or approvedPlan'); edge('mode', 'plan-agent', 'Plan without approvedPlan');
    edge('auto-agent', 'output', 'JSON response'); edge('plan-agent', 'output', 'JSON plan');
    edge('output', 'plan-approval', 'kind = plan'); edge('plan-approval', 'mode', 'Explicit resubmit with approvedPlan');
    edge('output', 'proposal', 'kind = proposal'); edge('proposal', 'save', 'Explicit user save');
    edge('context', 'failure', 'Invalid input / preparation error'); edge('mode', 'failure', 'Abort / provider failure');
    edge('output', 'failure', 'Invalid response');
    if (authoring) {
      host('clarification', 'Collect clarification answers', 'wait',
        'Render 1–5 structured questions; submit answers explicitly on a new request. Preserve decisions through plan approval; clear them when the need changes.',
        'No interactive provider question tool. After prior answers, expose remaining uncertainty as openQuestions instead of another clarification loop.',
        ['src/data/useTaskAutoSpec.ts#useTaskAutoSpec', 'src/components/FeatureBreakdownModal.tsx#FeatureBreakdownModal'], 1550, 660);
      edge('output', 'clarification', 'kind = clarification'); edge('clarification', 'request', 'Explicit answers / resubmit');
    } else {
      host('sync', 'Explicit documentation sync', 'result',
        'Separate user action commits pending documentation changes on the project branch and attempts push.',
        'No automatic commit/push from generation or page save; push errors remain visible.', ['server/wiki/docsService.ts#DocsService'], 2150, 180);
      edge('save', 'sync', 'Separate user sync');
    }
  } else if (scope === 'releases') {
    host('request', 'Explicit release publication', 'trigger',
      'A user requests publication after inspecting a release preview.',
      'No autonomous publication or AI agent. Existing release and Git checks remain mandatory.',
      ['server/releases/releaseService.ts#ReleaseService'], 50, 180);
    host('preview', 'Validate release and Git target', 'operation',
      'Check release eligibility, delivered tickets, clean target, origin and matching commit/tag.',
      'Reject stale revisions and mismatched Git targets. Never move an existing tag.',
      ['server/releases/releaseService.ts#ReleaseService'], 350, 180);
    host('claim', 'Pin publication and claim', 'operation',
      'Under the project lock, pin the workflow snapshot, branch, remote and commit before publishing.',
      'Atomic revision guard prevents duplicate publication; retries keep the pinned snapshot.',
      ['server/releases/releaseService.ts#ReleaseService'], 650, 180);
    host('tag', 'Create and push release tag', 'operation',
      'Create the validated tag and push only that tag to the validated remote.',
      'Host-only Git operations. No arbitrary scripts or agent tools.',
      ['server/releases/releaseService.ts#ReleaseService'], 950, 180);
    host('published', 'Record published release', 'result',
      'Record the immutable publication target and activity.',
      'Success requires a confirmed tag push.', ['server/releases/releaseService.ts#ReleaseService'], 1250, 180);
    host('failure', 'Failure / explicit retry', 'wait',
      'Expose publication errors; mark interrupted publication failed at restart. A user may explicitly retry.',
      'Keep the original workflow and Git target; never replay a push automatically.',
      ['server/releases/releaseService.ts#ReleaseService'], 950, 440);
    edge('request', 'preview', 'User confirms'); edge('preview', 'claim', 'Current target');
    edge('claim', 'tag', 'Claimed'); edge('tag', 'published', 'Push confirmed');
    edge('tag', 'failure', 'Failure or restart'); edge('failure', 'preview', 'Explicit retry');
  } else {
    host('queue', 'Queue ticket snapshot', 'trigger', 'Entering In Progress queues a context/provider snapshot. Re-entry and corrections create a recorded attempt.',
      'No provider change between phases. Epic tickets are serialized without per-ticket approval.',
      ['server/agents/queue.ts#enqueueTicket', 'server/agents/queue.ts#replanTicket'], 50, 180);
    host('workspace', 'Claim and prepare worktree', 'operation', 'Claim queued work, verify current task/project snapshot, reserve epic scope, prepare an isolated ticket worktree and graph.',
      'Conditional claim prevents duplicate workers. Repository and branch must exist.', ['server/agents/sessionService.ts#SessionService'], 350, 180);
    host('phase', 'Select session phase', 'decision', 'A revised unapproved plan queues read-only planning; initial queue is adaptive execution; approved plan queues execution.',
      'Phase-specific tool inventory enforced by the host.', ['server/agents/sessionService.ts#SessionService'], 650, 180);
    const docPath = '<host-resolved required ticket documentation path>';
    agent('planner', 'Read-only planner', 'Prepare a concrete implementation and verification plan.',
      [...ticketSessionInstructions('plan', false, docPath), GRAPHIFY_SKILL_INSTRUCTION].join('\n'),
      ['skill', ...readTools, ...graphTools, 'ticket_ask_user'], 950, 420);
    agent('executor', 'Adaptive / approved executor', 'Assess complexity before any write; implement simple work or the approved plan.',
      [...ticketSessionInstructions('execute', true, docPath), GRAPHIFY_SKILL_INSTRUCTION].join('\n'),
      ['skill', ...readTools, ...graphTools, 'ticket_ask_user', 'ticket_request_plan_approval',
        'ticket_create_directory', 'ticket_delete_file', 'ticket_write_file', 'ticket_run_checks'], 950, 180);
    doc.prompts.push({ id: 'approved-execution-prompt', name: 'Approved execution system instructions',
      template: [...ticketSessionInstructions('execute', false, docPath), GRAPHIFY_SKILL_INSTRUCTION].join('\n'), variables: [] });
    doc.agents.find((item) => item.id === 'executor')!.promptVariants = [{ when: 'Approved plan execution (no escalation tool)', promptId: 'approved-execution-prompt' }];
    agent('reviewer', 'Optional AI diff reviewer', 'Read-only actionable defect review of the current token-pinned diff.',
      [...ticketSessionInstructions('review', false, docPath), GRAPHIFY_SKILL_INSTRUCTION].join('\n'),
      ['skill', ...readTools, ...graphTools], 1550, 420);
    host('questions', 'Persist question and wait', 'wait', 'ticket_ask_user serializes questions, persists awaiting_input and resumes the same phase after a validated answer.',
      'No guessing user decisions. Not available during automated review.', ['server/agents/sessionService.ts#SessionService', 'server/agents/ticketSession.ts#ticketSession'], 950, 700);
    host('plan-gate', 'Plan approval / epic auto-approval', 'wait', 'Adaptive escalation before first write, or planner completion, stores the plan. Standalone tickets wait for approval; epic tickets queue execution automatically.',
      'Plan escalation forbidden after a write. Approval checks session timestamp and task revision.', ['server/agents/sessionService.ts#SessionService', 'server/agents/ticketSession.ts#ticketSession'], 1250, 420);
    host('result', 'Persist execution and checks', 'operation', 'Persist streamed output, check results, runtime telemetry and completion; move eligible ticket into review.',
      'Only registered tools; checks restricted to npm test/lint. No arbitrary commands, installations, services, commit or push by the agent.',
      ['server/agents/sessionService.ts#SessionService', 'server/agents/ticketSession.ts#ticketSession'], 1250, 180);
    host('review', 'Inspect diff and documentation', 'operation', 'Host computes current diff, preview, criteria, required documentation and review token. AI review is an optional separate user action.',
      'Required nonempty ticket documentation; AI feedback does not accept review.', ['server/agents/sessionService.ts#SessionService'], 1550, 180);
    host('accept', 'Human review acceptance', 'wait', 'Human explicitly accepts a current token-pinned diff.',
      'Reject stale diff, changed task/session, or missing documentation.', ['server/agents/sessionService.ts#SessionService'], 1850, 180);
    host('delivery', 'Explicit delivery / publication', 'result', 'Separate user actions preview then commit/merge or validate/push using existing delivery and publication services.',
      'Accepted current review token, tree/head snapshots, project locks and existing delivery guards are mandatory. Never an automatic agent action.',
      ['server/agents/deliveryService.ts#DeliveryService', 'server/agents/reviewPublicationService.ts#ReviewPublicationService'], 2150, 180);
    host('finish', 'Explicit Finish published work', 'result',
      'After verified publication and Done status, a separate Finish action previews, merges/pushes the feature branch and closes the published work.',
      'Standalone ticket or entire epic only; stopped sessions, matching publication snapshots, shared active release assignment, origin/head checks and project lock are required. Interrupted Finish requires explicit retry, never automatic Git replay.',
      ['server/git/branchFinishService.ts#BranchFinishService'], 2450, 180);
    host('stopped', 'Failure / cancel / restart', 'result', 'Cancellation aborts active work. Restart marks interrupted sessions failed without replay. Partial worktrees remain inspectable.',
      'Explicit retry only; delivery/publication have their own recovery.', ['server/agents/sessionService.ts#SessionService'], 350, 940);
    host('retry', 'Explicit retry / corrections', 'operation', 'Validate stopped session or correction feedback, archive attempt and requeue. Revising an unapproved plan forces planning; corrections reopen eligible task/epic.',
      'Existing task status, timestamp and worker-stop guards remain authoritative.', ['server/agents/sessionService.ts#SessionService', 'server/agents/queue.ts#replanTicket'], 650, 940);
    edge('queue', 'workspace', 'Worker claim'); edge('workspace', 'phase', 'Validated snapshot');
    edge('phase', 'planner', 'Revised unapproved plan'); edge('phase', 'executor', 'Adaptive or approved execution');
    edge('planner', 'plan-gate', 'Plan ready'); edge('executor', 'plan-gate', 'Complexity escalation before writes');
    edge('plan-gate', 'executor', 'Human approval or epic auto-approval');
    edge('planner', 'questions', 'ticket_ask_user'); edge('executor', 'questions', 'ticket_ask_user');
    edge('questions', 'planner', 'Answer: resume planning'); edge('questions', 'executor', 'Answer: resume execution');
    edge('executor', 'result', 'Completed without escalation'); edge('result', 'review', 'Review requested');
    edge('review', 'reviewer', 'Optional AI review'); edge('reviewer', 'review', 'Report, no acceptance');
    edge('review', 'accept', 'Human accepts current diff'); edge('accept', 'delivery', 'Separate delivery action');
    edge('delivery', 'finish', 'Published + Done + explicit Finish');
    for (const id of ['workspace', 'planner', 'executor', 'questions', 'plan-gate']) edge(id, 'stopped', 'Failure / cancellation / interruption');
    edge('stopped', 'retry', 'Explicit retry'); edge('review', 'retry', 'Correction feedback');
    edge('plan-gate', 'retry', 'Request revised plan'); edge('retry', 'queue', 'New archived attempt');
  }
  return workflowDocumentSchema.parse(doc);
}

export function protectedRuntimeShape(doc: WorkflowDocument) {
  return JSON.stringify({
    runtimeReference: doc.runtimeReference ? { scope: doc.runtimeReference.scope, revision: doc.runtimeReference.revision } : undefined,
    operations: doc.operations, hooks: doc.hooks,
    nodes: doc.nodes.map(({ id, kind, referenceId }) => ({ id, kind, referenceId })),
    edges: doc.edges,
    agents: doc.agents.map(({ id, tools, autonomy, maxIterations, promptVariants }) => ({ id, tools, autonomy, maxIterations, promptVariants })),
  });
}

export async function builtInWorkflow(scope: RuntimeWorkflowScope): Promise<WorkflowDocument> {
  return prebuiltWorkflow(scope);
}
