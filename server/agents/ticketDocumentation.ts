import { DEFAULT_DOCS_PATH, docsPathSchema } from '../../src/types/board';

function slug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '') || 'ticket';
}

export function requiredTicketDocumentationPath(input: {
  docsPath?: string | null;
  taskId: string;
  taskTitle: string;
  featureTitle?: string | null;
}) {
  const docsPath = docsPathSchema.parse(input.docsPath ?? DEFAULT_DOCS_PATH);
  const folder = input.featureTitle ? slug(input.featureTitle) : 'tickets';
  const ticket = `${slug(input.taskTitle)}-${slug(input.taskId).slice(0, 8)}`;
  return `${docsPath}/features/${folder}/${ticket}.md`;
}
