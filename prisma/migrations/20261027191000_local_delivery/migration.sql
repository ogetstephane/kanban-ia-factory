CREATE TABLE "AgentDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "targetHead" TEXT NOT NULL,
  "ticketHead" TEXT NOT NULL,
  "tree" TEXT NOT NULL,
  "reviewToken" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "acknowledgeChecks" BOOLEAN NOT NULL,
  "commitHash" TEXT,
  "mergeHash" TEXT,
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "AgentDelivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentDelivery_sessionId_attempt_key" ON "AgentDelivery"("sessionId", "attempt");
