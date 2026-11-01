CREATE TABLE "BranchFinish" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "featureHead" TEXT NOT NULL,
  "targetHead" TEXT NOT NULL,
  "mergeHash" TEXT,
  "releaseId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "BranchFinish_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BranchFinish_projectId_scopeId_key" ON "BranchFinish"("projectId", "scopeId");
ALTER TABLE "ReviewPublication" ADD COLUMN "finishId" TEXT REFERENCES "BranchFinish"("id") ON DELETE SET NULL ON UPDATE CASCADE;
