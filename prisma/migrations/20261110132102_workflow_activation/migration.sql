-- AlterTable
ALTER TABLE "Release" ADD COLUMN "workflowSnapshot" JSONB;

-- AlterTable
ALTER TABLE "WorkflowConfiguration" ADD COLUMN "activeVersionId" TEXT;
