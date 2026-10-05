import { z } from "zod";
import { apiBoundaryContracts, type ApiBoundaryContract } from "./productionApiBoundary";

const transportRequestSchema = z
  .object({
    idempotencyKey: z.string().min(1).optional(),
  })
  .passthrough();

const schemasById = new Map<string, z.ZodType>();
for (const contract of apiBoundaryContracts) {
  schemasById.set(contract.id, transportRequestSchema);
}

export const productRequestSchemas: Readonly<Record<string, z.ZodType>> = Object.freeze(
  Object.fromEntries(schemasById),
);

export const productRequestSchemaAliases: Readonly<Record<string, z.ZodType>> = Object.freeze({
  "api.command": productRequestSchemas["generation.command.create-generation-task"]!,
  "api.query": productRequestSchemas["generation.query.generation-task-status"]!,
  "api.process": productRequestSchemas["process.generation"]!,
});

export function getProductRequestSchema(contractId: string): z.ZodType {
  const schema = productRequestSchemas[contractId] ?? productRequestSchemaAliases[contractId];
  if (!schema) throw new Error(`unknown production request schema: ${contractId}`);
  return schema;
}

export function isProductionApiContract(value: unknown): value is ApiBoundaryContract {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    schemasById.has((value as { id: string }).id)
  );
}
