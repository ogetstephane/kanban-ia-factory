import type { MessageOptions } from '@github/copilot-sdk';
import type { AgentRequest } from './provider';
import { contextFilesSchema } from '../../shared/types/contextFile';

export function prepareContextFiles(input: unknown) {
  const files = contextFilesSchema.parse(input ?? []);
  const attachments: NonNullable<MessageOptions['attachments']> = [];
  const contextFiles = files.map(({ data, ...file }) => {
    const bytes = Buffer.from(data, 'base64');
    const text = bytes.toString('utf8');
    const binaryType = file.mimeType === 'application/pdf' ||
      /^(image|audio|video)\//.test(file.mimeType) ||
      /\.(pdf|png|jpe?g|gif|webp|bmp|ico|svg|zip|gz|docx?|xlsx?|pptx?)$/i.test(file.name);
    if (!binaryType && Buffer.from(text, 'utf8').equals(bytes) && !/[\u0000-\u0008\u000e-\u001f]/.test(text)) {
      return { ...file, content: text };
    }
    attachments.push({ type: 'blob', data, mimeType: file.mimeType, displayName: file.name });
    return { ...file, content: 'Included as a binary attachment. If it cannot be interpreted, report that limitation and ask the user for a readable version.' };
  });
  return { contextFiles, attachments };
}

export function agentMessage(request: AgentRequest): MessageOptions {
  const { contextFiles, attachments } = prepareContextFiles(request.context.task.contextFiles);
  return {
    prompt: JSON.stringify({
      phase: request.phase,
      ...(request.adaptive ? { mode: 'adaptive' } : {}),
      context: { project: request.context.project, feature: request.context.feature, task: { ...request.context.task, contextFiles } },
      approvedPlan: request.plan, feedback: request.feedback,
      previousAnswers: request.answers, reviewDiff: request.reviewDiff,
      ...(request.workflowStep ? { workflowStep: request.workflowStep } : {}),
    }),
    ...(attachments.length ? { attachments } : {}),
  };
}
