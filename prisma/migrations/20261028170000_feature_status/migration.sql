ALTER TABLE "Feature" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Backlog';

UPDATE "Feature"
SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Task" WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" = 'In Progress'
  ) THEN 'In Progress'
  WHEN EXISTS (
    SELECT 1 FROM "Task" WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" = 'Review'
  ) THEN 'Review'
  WHEN EXISTS (
    SELECT 1 FROM "Task" WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" = 'To Do'
  ) THEN 'To Do'
  WHEN EXISTS (
    SELECT 1 FROM "Task" WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" = 'Backlog'
  ) THEN 'Backlog'
  WHEN EXISTS (
    SELECT 1 FROM "Task" WHERE "Task"."featureId" = "Feature"."id" AND "Task"."status" = 'Done'
  ) THEN 'Done'
  ELSE 'Backlog'
END;
