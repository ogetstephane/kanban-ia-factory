CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resumeStatus" TEXT,
    "context" JSONB NOT NULL,
    "taskRevision" INTEGER NOT NULL,
    "workspace" TEXT,
    "branch" TEXT,
    "baseCommit" TEXT,
    "providerSessionId" TEXT,
    "plan" TEXT NOT NULL DEFAULT '',
    "output" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "AgentSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentSession_taskId_key" ON "AgentSession"("taskId");
CREATE TABLE "AgentQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "allowFreeform" BOOLEAN NOT NULL,
    "answer" TEXT,
    "createdAt" TEXT NOT NULL,
    "answeredAt" TEXT,
    CONSTRAINT "AgentQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentQuestion_sessionId_idx" ON "AgentQuestion"("sessionId");
