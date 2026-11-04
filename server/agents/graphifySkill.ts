import { fileURLToPath } from 'node:url';
import type { SessionConfig } from '@github/copilot-sdk';
import { z } from 'zod';

export const GRAPHIFY_SKILL_NAME = 'ticket-graphify';
export const GRAPHIFY_SKILL_DIRECTORY = fileURLToPath(new URL('../../.github/skills', import.meta.url));
export const GRAPHIFY_SKILL_INSTRUCTION =
  'Before working on this ticket, use the skill tool to load the ticket-graphify skill and follow its workflow for the current phase.';

export function graphifySkillConfiguration(tools: NonNullable<SessionConfig['tools']>) {
  const names = tools.map((tool) => tool.name);
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
        if (!z.object({ skill: z.literal(GRAPHIFY_SKILL_NAME) }).safeParse(toolArgs).success) {
          return { permissionDecision: 'deny', permissionDecisionReason: 'Only the bundled ticket-graphify skill is available in ticket sessions.' };
        }
      },
    },
  } satisfies SessionConfig;
}
