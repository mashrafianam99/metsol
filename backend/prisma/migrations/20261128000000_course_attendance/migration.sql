-- CreateTable
CREATE TABLE "CourseAttendance" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseAttendance_courseId_idx" ON "CourseAttendance"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAttendance_studentId_courseId_key" ON "CourseAttendance"("studentId", "courseId");

