ALTER TABLE "Task" ADD COLUMN "agentProvider" TEXT NOT NULL DEFAULT 'copilot';
ALTER TABLE "Task" ADD COLUMN "agentModel" TEXT;
