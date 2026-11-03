ALTER TABLE "User"
ADD COLUMN "batch" TEXT,
ADD COLUMN "section" TEXT;

CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
