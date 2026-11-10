-- CreateTable
CREATE TABLE "WorkflowTestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WorkflowTestRun_scope_createdAt_idx" ON "WorkflowTestRun"("scope", "createdAt");
