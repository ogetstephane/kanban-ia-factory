import { z } from 'zod';

/** `auto`: Copilot answers directly unless it judges a plan necessary; `plan`: Copilot always proposes a plan first. */
export const assistantModeSchema = z.enum(['auto', 'plan']);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

export const assistantPlanSchema = z.object({
  plan: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(2_000),
});
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;

/** Mode fields shared by assistant inputs; `approvedPlan` asks Copilot to apply a plan the user confirmed. */
export const assistantModeInputShape = {
  mode: assistantModeSchema.default('auto'),
  approvedPlan: assistantPlanSchema.shape.plan.optional(),
};
