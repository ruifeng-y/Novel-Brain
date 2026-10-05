import { z } from "zod";
import {
  apiBoundaryContracts,
  type ApiBoundaryContract,
  type ApiRequestValidationResult,
} from "./productionApiBoundary";

const transportKeys = z.record(z.string(), z.unknown());

function schemaFor(contract: ApiBoundaryContract): z.ZodType {
  const identity = {
    contractId: z.literal(contract.id),
    params: transportKeys.optional(),
    query: transportKeys.optional(),
    body: transportKeys.optional(),
    ...(contract.idempotency === "not-applicable"
      ? {}
      : { idempotencyKey: z.string().min(1).optional() }),
  };
  return z.object(identity).passthrough();
}

const schemasById = new Map<string, z.ZodType>();
for (const contract of apiBoundaryContracts) {
  schemasById.set(contract.id, schemaFor(contract));
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

export function createProductRequestValidators(): ReadonlyMap<
  string,
  (input: unknown) => ApiRequestValidationResult<unknown>
> {
  return new Map(
    apiBoundaryContracts.map(contract => {
      const schema = schemasById.get(contract.id)!;
      const validate = (input: unknown): ApiRequestValidationResult<unknown> => {
        const parsed = schema.safeParse({
          ...(typeof input === "object" && input !== null ? input : { body: input }),
          contractId: contract.id,
        });
        return parsed.success
          ? { valid: true, request: input }
          : {
              valid: false,
              issues: parsed.error.issues.map(issue => ({
                code: issue.code,
                message: issue.message,
              })),
            };
      };
      return [contract.id, validate] as const;
    }),
  );
}

export function isProductionApiContract(value: unknown): value is ApiBoundaryContract {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    schemasById.has((value as { id: string }).id)
  );
}
