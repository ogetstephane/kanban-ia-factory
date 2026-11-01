CREATE TABLE "ReviewPublication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "projectId" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "remoteUrl" TEXT NOT NULL,
  "reviewToken" TEXT NOT NULL,
  "tree" TEXT NOT NULL,
  "ticketHead" TEXT NOT NULL,
  "commitHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "ReviewPublication_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewPublication_sessionId_attempt_key" ON "ReviewPublication"("sessionId", "attempt");
CREATE INDEX "ReviewPublication_projectId_scopeId_idx" ON "ReviewPublication"("projectId", "scopeId");
