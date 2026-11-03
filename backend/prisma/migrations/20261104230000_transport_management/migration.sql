ALTER TYPE "Role" ADD VALUE 'TRANSPORT_ADMIN';

ALTER TABLE "User"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Notice"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "transportScheduleId" TEXT;

CREATE UNIQUE INDEX "Notice_transportScheduleId_key" ON "Notice"("transportScheduleId");

CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startingPoint" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "geometry" JSONB,
    "geometrySource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "routeId" TEXT,
    "startingPoint" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "operatingDays" TEXT[] NOT NULL,
    "morningSchedule" TEXT,
    "afternoonSchedule" TEXT,
    "returnSchedule" TEXT,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Bus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusStop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "area" TEXT NOT NULL,
    "osmId" TEXT,
    "description" TEXT,
    "landmark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "busStopId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "arrivalTime" TEXT,
    "departureTime" TEXT,
    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportSchedule" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER NOT NULL,
    "fileData" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "TransportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportActivity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransportActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportRoute_name_key" ON "TransportRoute"("name");
CREATE INDEX "TransportRoute_updatedAt_idx" ON "TransportRoute"("updatedAt");
CREATE UNIQUE INDEX "Bus_number_key" ON "Bus"("number");
CREATE INDEX "Bus_isActive_updatedAt_idx" ON "Bus"("isActive", "updatedAt");
CREATE INDEX "Bus_routeId_idx" ON "Bus"("routeId");
CREATE INDEX "BusStop_name_idx" ON "BusStop"("name");
CREATE INDEX "BusStop_area_idx" ON "BusStop"("area");
CREATE UNIQUE INDEX "RouteStop_routeId_sequence_key" ON "RouteStop"("routeId", "sequence");
CREATE UNIQUE INDEX "RouteStop_routeId_busStopId_key" ON "RouteStop"("routeId", "busStopId");
CREATE INDEX "RouteStop_busStopId_idx" ON "RouteStop"("busStopId");
CREATE INDEX "TransportSchedule_status_publishedAt_idx" ON "TransportSchedule"("status", "publishedAt");
CREATE INDEX "TransportSchedule_createdAt_idx" ON "TransportSchedule"("createdAt");
CREATE UNIQUE INDEX "TransportSchedule_one_published_idx" ON "TransportSchedule"("status") WHERE "status" = 'PUBLISHED';
CREATE INDEX "TransportActivity_createdAt_idx" ON "TransportActivity"("createdAt");
CREATE INDEX "TransportActivity_entityType_entityId_idx" ON "TransportActivity"("entityType", "entityId");
CREATE UNIQUE INDEX "Notification_userId_noticeId_key" ON "Notification"("userId", "noticeId");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

ALTER TABLE "Bus"
ADD CONSTRAINT "Bus_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteStop"
ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteStop"
ADD CONSTRAINT "RouteStop_busStopId_fkey" FOREIGN KEY ("busStopId") REFERENCES "BusStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportSchedule"
ADD CONSTRAINT "TransportSchedule_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportActivity"
ADD CONSTRAINT "TransportActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notice"
ADD CONSTRAINT "Notice_transportScheduleId_fkey" FOREIGN KEY ("transportScheduleId") REFERENCES "TransportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
