ALTER TABLE "AgentSession" ADD COLUMN "autoExecute" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Feature"
SET "status" = 'In Progress'
WHERE "status" = 'Review'
  AND EXISTS (
    SELECT 1 FROM "Task"
    WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" <> 'Done'
  );

UPDATE "Task"
SET "status" = (
  SELECT "Feature"."status" FROM "Feature"
  WHERE "Feature"."id" = "Task"."featureId"
)
WHERE "featureId" IS NOT NULL;

UPDATE "AgentSession"
SET "autoExecute" = true
WHERE "taskId" IN (
  SELECT "Task"."id" FROM "Task"
  JOIN "Feature" ON "Feature"."id" = "Task"."featureId"
  WHERE "Feature"."status" = 'In Progress'
);

UPDATE "AgentSession"
SET "status" = 'execution_queued'
WHERE "autoExecute" = true AND "status" = 'awaiting_approval';
