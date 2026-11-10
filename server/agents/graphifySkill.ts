import { fileURLToPath } from 'node:url';
import type { SessionConfig } from '@github/copilot-sdk';
import { z } from 'zod';

export const GRAPHIFY_SKILL_NAME = 'ticket-graphify';
export const BUNDLED_SKILLS_DIRECTORY = fileURLToPath(new URL('../skills', import.meta.url));
export const GRAPHIFY_SKILL_DIRECTORY = BUNDLED_SKILLS_DIRECTORY;
export const GRAPHIFY_SKILL_INSTRUCTION =
  'Before working on this ticket, use the skill tool to load the ticket-graphify skill and follow its workflow for the current phase.';

/** `extraSkills` are other bundled skills the session may load, e.g. the assistant-planning skill. */
export function graphifySkillConfiguration(tools: NonNullable<SessionConfig['tools']>, extraSkills: string[] = []) {
  const names = tools.map((tool) => tool.name);
  const skills = [GRAPHIFY_SKILL_NAME, ...extraSkills];
  return {
    tools,
    availableTools: ['skill', ...names],
    enableSkills: true,
    enableConfigDiscovery: false,
    skipCustomInstructions: true,
    skillDirectories: [GRAPHIFY_SKILL_DIRECTORY],
    onPermissionRequest: (permission) => ({
      kind: permission.kind === 'custom-tool' && names.includes(permission.toolName)
        ? 'approved' : 'denied-interactively-by-user',
    }),
    hooks: {
      onPreToolUse: ({ toolName, toolArgs }) => {
        if (toolName !== 'skill') return;
        const requested = z.object({ skill: z.string() }).safeParse(toolArgs);
        if (!requested.success || !skills.includes(requested.data.skill)) {
          return { permissionDecision: 'deny', permissionDecisionReason: `Only the bundled ${skills.join(', ')} skill${skills.length > 1 ? 's are' : ' is'} available in this session.` };
        }
      },
    },
  } satisfies SessionConfig;
}
