-- CreateTable
CREATE TABLE "CourseBatch" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseBatch_batch_idx" ON "CourseBatch"("batch");

-- CreateIndex
CREATE UNIQUE INDEX "CourseBatch_courseId_batch_key" ON "CourseBatch"("courseId", "batch");

