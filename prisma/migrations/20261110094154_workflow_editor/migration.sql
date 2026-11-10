-- CreateTable
CREATE TABLE "WorkflowConfiguration" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL,
    "selectedVersionId" TEXT
);

-- CreateTable
CREATE TABLE "WorkflowConfigurationVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowConfigurationVersion_scope_fkey" FOREIGN KEY ("scope") REFERENCES "WorkflowConfiguration" ("scope") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowConfigurationVersion_scope_number_key" ON "WorkflowConfigurationVersion"("scope", "number");
