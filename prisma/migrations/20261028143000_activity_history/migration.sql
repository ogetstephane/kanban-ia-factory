CREATE TABLE "ActivityEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "projectName" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityTitle" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX "ActivityEvent_projectId_createdAt_idx" ON "ActivityEvent"("projectId", "createdAt");
CREATE INDEX "ActivityEvent_entityType_entityId_createdAt_idx" ON "ActivityEvent"("entityType", "entityId", "createdAt");
