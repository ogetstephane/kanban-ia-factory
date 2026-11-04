import { activityListSchema, type ActivityQuery } from '../../shared/types/activity';
import { filterQuery, request } from './apiClient';

export const activityApi = {
  async activityEvents(filters: ActivityQuery, signal?: AbortSignal) {
    return activityListSchema.parse(await request(`/activity-events?${filterQuery(filters)}`, 'GET', undefined, signal));
  },
  async activityHistory(entityType: string, entityId: string, page = 1, signal?: AbortSignal) {
    const query = new URLSearchParams({ page: String(page) });
    return activityListSchema.parse(await request(
      `/activity-events/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?${query}`,
      'GET', undefined, signal,
    ));
  },
};
