import { z } from 'zod';

export const usageMeasurementSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cost: z.object({ currency: z.literal('USD'), micros: z.number().int().nonnegative() }).strict().optional(),
  basis: z.enum(['reported', 'estimated', 'unavailable']),
}).strict().refine((usage) => usage.basis !== 'unavailable'
  || (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cost === undefined),
'Unavailable usage must not contain success-shaped measurements.');

export const artifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['plan', 'patch', 'report', 'verification']),
  uri: z.string().min(1),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
}).strict();

const evidence = {
  artifacts: z.array(artifactSchema),
  usage: usageMeasurementSchema,
  nativeSessionId: z.string().min(1).optional(),
};
export const agentExecutionResultSchema = z.discriminatedUnion('status', [
  z.object({ ...evidence, status: z.literal('succeeded'), output: z.json() }).strict(),
  z.object({ ...evidence, status: z.literal('failed'), error: z.object({
    code: z.enum(['AUTHENTICATION', 'CAPABILITY_UNSUPPORTED', 'POLICY_DENIED', 'INVALID_OUTPUT', 'RATE_LIMITED', 'RUNTIME_FAILURE']),
    message: z.string().min(1), retryable: z.boolean(),
  }).strict() }).strict(),
  z.object({ ...evidence, status: z.literal('cancelled'), reason: z.string().min(1) }).strict(),
  z.object({ ...evidence, status: z.literal('interrupted'), reason: z.string().min(1) }).strict(),
  z.object({ ...evidence, status: z.literal('budget_exceeded'), limit: z.enum([
    'maxInputTokens', 'maxOutputTokens', 'maxCost', 'maxToolCalls', 'maxDurationMs', 'maxAgentTurns', 'maxAttempts',
  ]) }).strict(),
]);

export const executionEventSchema = z.object({
  executionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
  payload: z.discriminatedUnion('type', [
    z.object({ type: z.literal('started'), nativeSessionId: z.string().optional() }).strict(),
    z.object({ type: z.literal('text_delta'), text: z.string() }).strict(),
    z.object({ type: z.literal('tool_requested'), callId: z.string(), toolId: z.string() }).strict(),
    z.object({ type: z.literal('tool_completed'), callId: z.string(), succeeded: z.boolean() }).strict(),
    z.object({ type: z.literal('tool_denied'), callId: z.string(), toolId: z.string(), reason: z.string() }).strict(),
    z.object({ type: z.literal('budget_warning'), reason: z.string() }).strict(),
    z.object({ type: z.literal('usage'), usage: usageMeasurementSchema }).strict(),
    z.object({ type: z.literal('artifact'), artifact: artifactSchema }).strict(),
  ]),
}).strict();
