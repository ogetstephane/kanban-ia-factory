-- CreateTable
CREATE TABLE "AnalysisExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "prepared" JSONB,
    "result" JSONB,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnalysisExecutionEvent" (
    "executionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurredAt" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    PRIMARY KEY ("executionId", "sequence"),
    CONSTRAINT "AnalysisExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AnalysisExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
