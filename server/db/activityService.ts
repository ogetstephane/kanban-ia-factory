import type { Prisma, PrismaClient } from '@prisma/client';
import { activityEventSchema, activityListSchema, activityQuerySchema, activityEntityTypeSchema } from '../../shared/types/activity';

const pageSize = 25;

export class ActivityService {
  constructor(private readonly db: PrismaClient) {}

  async list(input: unknown) {
    const query = activityQuerySchema.parse(input);
    const where: Prisma.ActivityEventWhereInput = {
      projectId: query.projectId,
      entityType: query.entityType,
      ...(query.search ? { OR: [
        { projectName: { contains: query.search } },
        { entityTitle: { contains: query.search } },
        { summary: { contains: query.search } },
        { actor: { contains: query.search } },
      ] } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.activityEvent.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * pageSize, take: pageSize,
      }),
      this.db.activityEvent.count({ where }),
    ]);
    return activityListSchema.parse({ items: rows.map((row) => activityEventSchema.parse(row)), total, page: query.page, pageSize });
  }

  async history(entityType: string, entityId: string, pageInput: unknown) {
    const type = activityEntityTypeSchema.parse(entityType);
    const { page } = activityQuerySchema.pick({ page: true }).parse({ page: pageInput ?? 1 });
    const where = { entityType: type, entityId };
    const [rows, total] = await this.db.$transaction([
      this.db.activityEvent.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.db.activityEvent.count({ where }),
    ]);
    return activityListSchema.parse({ items: rows.map((row) => activityEventSchema.parse(row)), total, page, pageSize });
  }
}
