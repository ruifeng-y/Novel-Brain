-- CreateTable
CREATE TABLE "IdempotencyReservation" (
    "key" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyReservation_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "IdempotencyReservation_novelId_idx" ON "IdempotencyReservation"("novelId");
