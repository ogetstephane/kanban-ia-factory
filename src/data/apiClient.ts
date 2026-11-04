import { z } from 'zod';

export class BoardApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function request(route: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/board${route}`, {
    method, cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status !== 204 && !response.headers.get('content-type')?.includes('application/json')) {
    throw new BoardApiError(
      `API ${method} /api/board${route} returned a non-JSON response (${response.status}). Stop and restart the application server (make dev), then reload the page.`,
      response.status,
    );
  }
  if (!response.ok) {
    const payload: unknown = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : undefined;
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new BoardApiError(error.success ? error.data.error : `Database request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

export const entityPath = (kind: string, id: string) => `/${kind}/${encodeURIComponent(id)}`;

export function filterQuery(filters: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query;
}

export function validInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BoardApiError(parsed.error.issues.map((issue) => issue.message).join(' '), 400);
  return parsed.data;
}
