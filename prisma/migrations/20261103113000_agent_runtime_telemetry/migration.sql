CREATE TABLE "AgentRuntime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "endedAt" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "AgentRuntime_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentRuntime_sessionId_attempt_startedAt_idx" ON "AgentRuntime"("sessionId", "attempt", "startedAt");
