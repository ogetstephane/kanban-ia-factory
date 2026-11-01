CREATE TABLE "Release" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'upcoming',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "publishing" BOOLEAN NOT NULL DEFAULT false,
  "targetBranch" TEXT,
  "targetCommit" TEXT,
  "remoteUrl" TEXT,
  "tagHash" TEXT,
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "publishedAt" TEXT,
  CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Release_projectId_version_key" ON "Release"("projectId", "version");
ALTER TABLE "Task" ADD COLUMN "releaseId" TEXT REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Task_releaseId_idx" ON "Task"("releaseId");
