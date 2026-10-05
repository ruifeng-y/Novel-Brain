import { z } from "zod";

export const commandResultSchema = z.object({
  channel: z.literal("command-result"),
  contractId: z.string(),
  value: z.unknown(),
  replayed: z.boolean(),
});

export const queryResultSchema = z.object({
  channel: z.literal("query-result"),
  contractId: z.string(),
  value: z.unknown(),
});

export const processSubmissionResultSchema = z.object({
  channel: z.literal("process-result"),
  contractId: z.string(),
  process: z.unknown(),
  replayed: z.boolean(),
});

export const processResultSchema = z.object({
  channel: z.literal("process-result"),
  contractId: z.string(),
  result: z.unknown(),
});

export const productResponseSchemas = Object.freeze({
  "command-result": commandResultSchema,
  "query-result": queryResultSchema,
  "process-result": processSubmissionResultSchema,
  "process-result-exposure": processResultSchema,
});
