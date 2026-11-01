ALTER TABLE "Task" ADD COLUMN "blockedReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentSession" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentSession" ADD COLUMN "feedback" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentSession" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "AgentSession" ADD COLUMN "reviewToken" TEXT NOT NULL DEFAULT '';
CREATE TABLE "AgentAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "AgentAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentAttempt_sessionId_number_key" ON "AgentAttempt"("sessionId", "number");
CREATE TABLE "AgentCheck" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "script" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "output" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "AgentCheck_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentCheck_sessionId_attempt_idx" ON "AgentCheck"("sessionId", "attempt");
