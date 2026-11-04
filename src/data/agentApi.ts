import {
  agentOptionsSchema, agentSessionSchema, agentListSchema, reviewSchema, aiReviewResultSchema, projectHealthSchema,
  deliveryPreviewSchema, deliveryHistorySchema, type DeliveryRequest, type AgentListQuery,
} from '../../shared/types/agent';
import { agentWorkflowsSchema } from '../../shared/types/workflow';
import { ALL_PROJECTS } from '../utils/projectLogic';
import { entityPath, filterQuery, request } from './apiClient';

const sessionPath = (taskId: string) => `${entityPath('tasks', taskId)}/session`;

export const agentApi = {
  async agentOptions(signal?: AbortSignal) {
    return agentOptionsSchema.parse(await request('/agent-options', 'GET', undefined, signal));
  },
  async agentWorkflows(projectId: string, signal?: AbortSignal) {
    const query = projectId === ALL_PROJECTS ? '' : `?${new URLSearchParams({ projectId })}`;
    return agentWorkflowsSchema.parse(await request(`/agent-workflows${query}`, 'GET', undefined, signal));
  },
  async agentSessions(filters: AgentListQuery, signal?: AbortSignal) {
    return agentListSchema.parse(await request(`/agent-sessions?${filterQuery(filters)}`, 'GET', undefined, signal));
  },
  async agentSession(taskId: string) {
    return agentSessionSchema.nullable().parse(await request(sessionPath(taskId)));
  },
  async agentHistory(taskId: string, signal?: AbortSignal) {
    return agentSessionSchema.shape.attempts.parse(await request(`${sessionPath(taskId)}/history`, 'GET', undefined, signal));
  },
  async agentAction(taskId: string, sessionId: string, action: 'approve' | 'retry' | 'cancel', updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${sessionPath(taskId)}/${action}`, 'POST', { sessionId, updatedAt }));
  },
  async answerAgent(taskId: string, sessionId: string, questionId: string, answer: string) {
    return agentSessionSchema.nullable().parse(await request(`${sessionPath(taskId)}/answer`, 'POST', { sessionId, questionId, answer }));
  },
  async feedbackAgent(taskId: string, sessionId: string, feedback: string, updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${sessionPath(taskId)}/feedback`, 'POST', { sessionId, feedback, updatedAt }));
  },
  async cleanupAgent(taskId: string, sessionId: string, updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${sessionPath(taskId)}/cleanup`, 'POST', { sessionId, updatedAt }));
  },
  async reviewAgent(taskId: string, signal?: AbortSignal, path?: string) {
    const query = path ? `?${new URLSearchParams({ path })}` : '';
    return reviewSchema.parse(await request(`${sessionPath(taskId)}/review${query}`, 'GET', undefined, signal));
  },
  async aiReviewAgent(taskId: string, token: string) {
    return aiReviewResultSchema.parse(await request(`${sessionPath(taskId)}/ai-review`, 'POST', { token }));
  },
  async acceptReview(taskId: string, sessionId: string, updatedAt: string, token: string) {
    return agentSessionSchema.nullable().parse(await request(`${sessionPath(taskId)}/accept-review`, 'POST', { sessionId, updatedAt, token }));
  },
  async delivery(taskId: string, signal?: AbortSignal) {
    return deliveryPreviewSchema.parse(await request(`${sessionPath(taskId)}/delivery`, 'GET', undefined, signal));
  },
  async deliver(taskId: string, action: 'commit' | 'merge', input: DeliveryRequest) {
    return deliveryPreviewSchema.parse(await request(`${sessionPath(taskId)}/delivery/${action}`, 'POST', input));
  },
  async deliveryHistory(filters: { projectId?: string; status?: string; search?: string; page?: number }, signal?: AbortSignal) {
    return deliveryHistorySchema.parse(await request(`/delivery-history?${filterQuery(filters)}`, 'GET', undefined, signal));
  },
  async projectHealth(projectId: string, signal?: AbortSignal) {
    return projectHealthSchema.parse(await request(`${entityPath('projects', projectId)}/health`, 'GET', undefined, signal));
  },
};
