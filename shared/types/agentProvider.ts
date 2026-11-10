import { z } from 'zod';

export const agentProviderSchema = z.enum(['copilot', 'claude-code']);
export type AgentProviderId = z.infer<typeof agentProviderSchema>;
