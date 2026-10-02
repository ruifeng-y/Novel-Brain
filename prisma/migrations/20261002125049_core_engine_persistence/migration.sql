-- CreateTable
CREATE TABLE "CurrentObject" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "revisionId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionRecord" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "commitId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "sequence" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "commitId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("sequence")
);

-- CreateIndex
CREATE INDEX "CurrentObject_aggregateType_objectId_idx" ON "CurrentObject"("aggregateType", "objectId");

-- CreateIndex
CREATE INDEX "CurrentObject_novelId_idx" ON "CurrentObject"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentObject_aggregateType_objectId_key" ON "CurrentObject"("aggregateType", "objectId");

-- CreateIndex
CREATE INDEX "RevisionRecord_aggregateType_objectId_idx" ON "RevisionRecord"("aggregateType", "objectId");

-- CreateIndex
CREATE INDEX "RevisionRecord_novelId_idx" ON "RevisionRecord"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionRecord_aggregateType_objectId_revisionId_key" ON "RevisionRecord"("aggregateType", "objectId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_eventId_key" ON "DomainEvent"("eventId");

-- CreateIndex
CREATE INDEX "DomainEvent_novelId_idx" ON "DomainEvent"("novelId");

-- CreateIndex
CREATE INDEX "DomainEvent_context_name_idx" ON "DomainEvent"("context", "name");
