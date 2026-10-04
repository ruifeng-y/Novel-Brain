# Cross-capability Verification Harness

Task 1.3 提供跨 capability 的验证分层、task-scoped gate 证据、fixture builders 和可执行命令。该 harness 不定义 Story Foundation、Production Run、Recall 或任何未来 capability domain，也不改变 Frozen Core 语义。

## Verification layers

| 命令 | Verification | Vitest 范围 | 用途 |
| --- | --- | --- | --- |
| `npm run verify:unit` | Unit Verification | `vitest.config.ts`，全部 `tests/**/*.test.ts`，排除 integration | 完整 unit/regression 执行面。 |
| `npm run verify:domain` | Domain Verification | `vitest.domain.config.ts`，限定 manuscript/narrative/production/safety/shared domain-focused tests | 快速 domain/invariant/identity/immutability/state-transition 子集。 |
| `npm run verify:integration` | Integration Verification | `vitest.integration.config.ts` | Persistence、transaction、concurrency、recovery、replay、cross-system application/integration flows。 |
| `npm run verify:system` | System Verification | typecheck + Unit + Domain + Integration | 对明确 task profile 执行完整 gate evidence validation。 |

Unit 与 Domain 不是同一命令的别名：

- Unit 是 all unit。
- Domain 是 domain-focused subset。
- 两者配置和 counts 不同。
- capability 不能只凭 unit 或 domain PASS 宣称完成。

System total counts 聚合实际执行的三个 Vitest steps。Domain subset 同时包含在 Unit all-unit 中，因此 System total 包含该重复执行量；layer counts 分别显示，不把 total 当作唯一测试数。

## Task profiles and gate evidence

Task gate evidence 由 `scripts/verificationTaskManifest.ts` 登记：

```ts
export const verificationTaskProfiles = {
  "1.3": {
    id: "1.3",
    label: "[task:1.3]",
    requiredGates: verificationGates,
  },
};
```

约定：

1. 每个后续 task 在 manifest 登记自己的 `id`、`[task:id]` label 和 required gates。
2. capability smoke/contract tests 在 suite/test full name 中包含 `[task:id]`。
3. 每个 gate 以 `[gate]` 标记。
4. runner 解析 Vitest JSON `assertionResults`，不只检查 test name。
5. 一个 gate 只有在同 task scope 中至少一个 test 为 `passed` 时才有证据。
6. `failed` 或 `todo` 会使该 gate 失败。
7. `pending`/`skipped` 不计入 passed evidence。

因此 Task 1.3 的 `[task:1.3] [persistence] ...` 不能满足未来 `[task:2.1]` profile。

## Gates

每个 task profile 显式声明所需 gate。Task 1.3 使用：

```text
domain
integration
persistence
transaction
concurrency
recovery
replay
cross-system
regression
```

测试写法：

```ts
runCapabilityVerificationSmokeContract("InMemory", "1.3", createEnvironment);
```

该 smoke suite 产生：

```text
InMemory [task:1.3] capability verification gate smoke > [persistence] ...
```

## Commands

```powershell
# 完整 unit；不等于 capability completion
npm run verify:unit

# domain-focused subset；counts 与 unit 不同
npm run verify:domain

# integration
npm run verify:integration

# Task 1.3 representative smoke；校验 [task:1.3] 九 gate JSON evidence
npm run verify:harness

# Task 1.3 full system；package script 已固定 --task 1.3
npm run verify:system

# focused contract；跨 unit/integration config
npm run verify:contract -- capabilityPersistence

# task-scoped gate；必须给 task profile 和 gate
node scripts/verificationHarness.ts gate capabilityVerificationHarness --task 1.3 --gate persistence
```

`verify:system` 必须有显式 task profile。直接调用 runner 时使用：

```powershell
node scripts/verificationHarness.ts system --task 1.3
```

未来 task 必须先登记 manifest profile，再执行对应 `--task <id>`。

## Current counts

以下为 fix round 1 当前基线：

```text
Unit Verification counts:
files=42 tests=409 passed=409 failed=0 skipped=0

Domain Verification counts:
files=32 tests=261 passed=261 failed=0 skipped=0

Integration Verification counts:
files=4 tests=73 passed=73 failed=0 skipped=0

Focused Contract Verification counts for capabilityVerificationHarness:
files=2 tests=76 passed=76 failed=0 skipped=0

System Verification total counts:
files=78 tests=743 passed=743 failed=0 skipped=0
```

## Layer / gate mapping

| Layer | 直接执行范围 | 主要 gate evidence | completion rule |
| --- | --- | --- | --- |
| Unit | all unit | regression 信号 | 不能单独完成 capability |
| Domain | domain-focused subset | domain、regression 信号 | 不能单独完成 capability |
| Integration | integration config | integration、persistence、transaction、concurrency、recovery、replay、cross-system 信号 | 不能单独完成 capability |
| System | typecheck + Unit + Domain + Integration | task profile required gates | 只有 JSON passed evidence 完整且无 failed/todo 才通过 |

## Reusable fixtures

- `tests/support/capabilityPersistenceFixtures.ts`
  - 复用 Task 1.1 generic InMemory/Prisma persistence ports 和 adapters。
- `tests/support/observationSourceContract.ts`
  - 保存 Task 1.2 `domainEventSourceContent`、`domainEventSourceReference`、snapshot factory 语义。
  - `eventStreamSourceReference` / `createEventStoreObservationSnapshot` / `EventStoreObservationSource` 是唯一 EventStore mapping/version/hash source of truth。
- `tests/support/observationSourceFixtures.ts`
  - 仅 re-export Task 1.2 contract helpers，不复制 version/hash/mapping 逻辑。
- `tests/support/capabilityVerificationContract.ts`
  - `runCapabilityVerificationSmokeContract`
  - `describeVerificationGate`
  - `seedCapabilityVerificationEvidence`

Parity/no-drift coverage 位于 `tests/support/observationSourceFixtures.test.ts`：

- fixture reference function 与 Task 1.2 contract function identity 相同。
- EventStore snapshot mapping 必须与 Task 1.2 factories 的独立期望一致。

后续 capability task 应为自己的窄 ports/domain 提供 fixture，登记 task manifest profile，并为 required gates 提供本 task scope 的 passed evidence，再运行对应的 `verify:system`。
