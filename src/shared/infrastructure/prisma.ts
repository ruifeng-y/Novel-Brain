import { PrismaClient } from "@prisma/client";

export type PrismaClientProvider = PrismaClient;

export const prisma = new PrismaClient();
