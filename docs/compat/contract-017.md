# T0 契约冻结：dsh-approval-center × DSH 0.1.7-rc.2

冻结日期：2026-09-29。编制：Agent A（集成负责人）。
共同开发基线：插件 commit `f608abd074315b430a3ab17f26b51129cdd185c7`（v0.3.0），分支 `adapt/dsh-017-host`。
本文档是 T0 交付物：B/C/D 以此为准实现各自模块；接口变更须走 A 的变更请求，不得自行改 public 签名。

## 1. 基线与完整性（T0-1/T0-2）

| 项 | 值 | 结论 |
|---|---|---|
| 插件基线 commit | `f608abd074315b430a3ab17f26b51129cdd185c7`（2026-09-26，v0.3.0） | PASS（GitHub API + 本地 clone 双确认） |
| DSH 0.1.5-rc.1 tag | 轻量 tag → commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` | PASS（GitHub git/refs API） |
| DSH 0.1.7-rc.2 tag | 轻量 tag → commit `477b4f420553e8a52c2fbccc464d7561b239c443` | PASS（GitHub git/refs API） |
| npm `@deepseek-ai/dsh@0.1.7-rc.2` | integrity `sha512-SQFhriLvza8GnFApnC5/32AgpcyKxrWnYXhvwDOLJdgWpkCX2EexyR9c8kCkMITJXnFLEN3Qb2CEh0W36vkLyw==`，tarball sha256 `5f2da7272d9485abc223e681075809a8d929697c5232ee445718e1b7e066bff8` | PASS（registry 与实下载交叉一致） |
| npm `@deepseek-ai/dsh@0.1.5-rc.1` | integrity `sha512-rmNmzQCg3oIc1z8xH7izRSOuy1TNzq+/NILyfM+7e8DKOyV+yBtg47WEsqR2SiIe1ATec3L/rUa1YhIcfQ2XEg==` | PASS（registry 记录） |
| 本机宿主证据源 | `D:\dsh-title-dev\dsh-cli\node_modules\@deepseek-ai\dsh`（0.1.7-rc.2）与发布 tarball `lib/` 逐字节一致 | PASS（diff -rq 零差异） |

本机证据源可代表 0.1.7-rc.2 发布包；下文目标版代码行号均指该本机路径。旧版证据来自 GitHub 固定 commit。

## 2. 宿主契约核对结果（T0-3）

### 2.1 approval/request waterfall（两版一致，PASS）

- 事件签名（目标版 `@deepseek-ai/dsh-user-approval/lib/types/types.d.ts`；旧版 `packages/interaction/user-approval/src/types.ts@183f08e`）：

```ts
'approval/request'(this: Scoped<Agent>, req: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>   // @waterfall
```

- 结果词汇表两版相同且封闭：`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`。宿主把词汇表外的返回值与抛异常的应答者一律归一化为 `'unavailable'`（目标版 `dsh-user-approval/lib/index.js:176`）。
- 派发实现（`@deepseek-ai/cordis/lib/index.js:319-324`）：`cbs.shift() ?? inner` —— 监听器按数组顺序执行；**返回值即认领**，调用 `next()` 才轮到下一个应答者；全部放行时落到宿主兜底 `() => Promise.resolve('unavailable')`。插件返回四值之一后请求即被认领，**宿主不会转问 Web UI**（V09/V10 语义由此保证）。
- scope 过滤：`scopeTarget(req.agent, req.agent)`（`dsh-user-approval/lib/index.js:176`），`{ prepend: true }` 使插件先于后注册的 Web 应答者被询问，保留不变。

### 2.2 displayReason（仅目标版新增，PASS）

- 0.1.5-rc.1 的 `ApprovalRequestEvent`：`agent / toolName / callId? / reason? / signal?`，**无 displayReason**。
- 0.1.7-rc.2 新增（`types.d.ts` 原文）：`readonly displayReason?: { readonly en: string; readonly [locale: string]: string }`，注释明确 "Localized presentation only; never persisted in approval audit events"。
- **冻结回退规则**（host-contract.ts 实现）：非空 `displayReason['zh-CN']` → 非空 `displayReason['zh']` → 原始非空 `reason` → 非空 `displayReason['en']` → 空串。审计库（`reason` 列）始终保存原始 `reason`，绝不落 displayReason。

### 2.3 never 策略 / open turn / abort（两版一致，PASS）

- `'never'` 在 `ApprovalService.decide()` 派发前短路返回 `'rejected'`——**插件根本收不到请求**（目标版 `dsh-user-approval/lib/index.js:175`）。插件不得也无法绕过。
- open turn 前置：`request()` 在无 open turn 时**抛异常**（不是返回 unavailable），审计对必须被 turn 包裹（`index.js:130`）。集成测试必须开真实 turn 后请求。
- abort 竞争：signal 中止 → 宿主立即 resolve `'cancelled'`，**应答者晚到的结果被丢弃**（`index.js:178-188`）。因此插件侧收到撤回后仍应完成自身结算（审计、清理），只是宿主结果必然是 cancelled。

### 2.4 Cordis 生命周期（PASS，目标版 cordis 实现）

- `prepend: true` → `unshift` 进 hooks 数组（`cordis/lib/index.js:336`），注册顺序决定 waterfall 优先级。
- 监听器注销是**同步**的（`unregister`，`index.js:349`）；`on()` 注册的 listener 本身是 fiber effect，fiber 卸载即移除。
- **fiber 卸载会 await 所有 effect cleanup**（`_unload()`，`index.js:1372-1387` 对每个 disposable `await runDisposable(...)`）——cleanup 可以返回 Promise，宿主在 unload/reload 时会等待。但进程退出不保证等待。
- 卸载开始后：`_disposables.clear()` 先行、fiber 进入 state 5，新的 `on()` 抛 `INACTIVE_EFFECT`（`index.js:1150`）；**正在飞行中的 waterfall 调用不会被取消**。⇒ 插件必须在 cleanup 里主动结算队列与 worker，之后禁止再写已关闭的 DB 句柄。

### 2.5 子代理事件（PASS，目标版 `dsh-subagent/lib/types/types.d.ts`）

- `subagent/start(info: SubagentRunInfo)` / `subagent/end(info: SubagentRunEndInfo)`，按 `runId` 配对。
- `SubagentRunEndInfo = { runId, provider, id: SessionId, local: boolean, stopReason, lastAssistantMessage? }`。
- **stopReason 在目标版非可选**，取值封闭：`'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'`（`types.d.ts:239-248`）。V16 文案修正据此映射；同 run 去重用 runId，不能用 childId（continuable activation 会复用 child）。

### 2.6 宿主加载门（PASS）

- peer 判定：`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`（`dsh-app-boot/lib/index.js:292`）；仅检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peer。
- Schema 识别判据（`dsh-app-boot/lib/index.js:2162-2170`）：

```js
Reflect.get(value, Symbol.for('schemastery')) === true
  && typeof Reflect.get(value, 'type') === 'string'
  && meta !== null && typeof meta === 'object'
```

## 3. schemastery 实测（T0-4，PASS）

- 宿主自带 `@deepseek-ai/schemastery` 3.18.4 与插件依赖 npm `schemastery` 3.18.0 **同上游 fork**，协议键 `Symbol.for('schemastery')` 相同（双方 `lib/index.mjs` 均定义 `kSchema = Symbol.for("schemastery")`）。
- 实测（`.t0-tmp/schema-check/criteria-test.mjs`，Node 24）：
  - `isNativeConfigSchema(插件Config)` = **true**；
  - `Config({})` 默认值投影正确（30/reject/`['*']`/serial/false×3/''）；
  - 局部覆盖投影正确；非法 `queueMode` 被拒绝（`$.queueMode expected "serial" | "parallel"`）。
- **结论：保留 npm schemastery ^3.18.0，不迁移依赖。**（计划书 3.5 的"先验证，失败才换"分支未触发。）
- PENDING：宿主 JSON Schema 生成器对深层节点的遍历投影（`dsh-app-boot` config-schema 段）留待 T5/V19 用真实宿主验证；判据与默认值层面已通过。

## 4. 跨模块冻结签名（T0-5）

以下签名即冻结版。标 ★ 的是相对基线 f608abd 的**新增/变化**；未标注者维持现状。

### 4.1 `src/host-contract.ts`（A 独占，新文件）

```ts
// 最小宿主类型（对齐 dsh-user-approval/lib/types/types.d.ts，两版通用）
interface ApprovalRequestEvent {
  readonly agent: { readonly id?: string; readonly session?: { readonly id?: string } }
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }  // ★ 目标版新增
  readonly signal?: AbortSignal
}
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

function matchTool(patterns: readonly string[], toolName: string): boolean   // '*' 全匹配；'prefix*' 前缀；其余全等
function selectDisplayReason(req: ApprovalRequestEvent): string              // ★ 回退链见 §2.2，空串表示无原因
// 结果映射表（HOST_OUTCOME / STORE_STATUS / RESULT_LABEL）从 index.ts 移入本模块，取值不变
```

### 4.2 `src/queue.ts`（B 独占）

```ts
type QueueState = 'accepting' | 'closing' | 'closed'        // ★
interface QueueCallbacks<TReq, TRes> {                       // ★ 结果映射归属调用方，队列保持泛型
  run(req: TReq, signal: AbortSignal): Promise<TRes>         // 执行阶段；signal=请求 signal 与插件生命周期 signal 的组合
  onCancel(): TRes                                           // 入队前已中止 / 排队中被撤回时的结算值
  onClose(): TRes                                            // close() 时排队项的结算值
}
class ApprovalQueue<TReq, TRes> {
  constructor(cb: QueueCallbacks<TReq, TRes>, mode: 'serial' | 'parallel', maxConcurrent?: number) // maxConcurrent 默认 3，>=1 兜底
  submit(req: TReq, signal?: AbortSignal): Promise<TRes>     // ★ 加 signal；Promise 必定结算且只结算一次
  close(): Promise<void>                                     // ★ 幂等；停接单→onClose 结算排队项→等待活动 worker 结束
  get state(): QueueState                                    // ★
}
```

约束：serial=FIFO（保持基线 chain 语义）；parallel=信号量背压上限 3；取消排队项**不得**启动 handler、不得占位；close() 重复调用安全；无悬挂 Promise。Windows/Dialog 一概不进队列。

**实现修正（A，2026-09-29，commit 2706621）**：`close()` 内部持有 AbortController，并把该 signal 组合进**活动**条目的 signal——close() 时活动 handler 收到中止信号应尽快结算；`onClose()` 只结算排队项。不如此则 close() 等待活动 worker 与调用方"先 close 再 abort 生命周期"的顺序互相死锁。handler 侧契约：必须响应 signal 或自行最终结算。排队中收到撤回（`onCancel`）与 running 后的撤回（组合 signal）语义分界：entry 一旦转 running，abort 只经组合 signal 传递。

### 4.3 `src/dialog.ts`（C 独占）

```ts
interface DialogRequest {
  title: string; message: string; timeoutSec: number
  timeoutAction?: 'reject' | 'approve'
  signal?: AbortSignal
  requestToken?: string                                      // ★ 插件生成的内部 token，传入脚本用于定向清理
}
interface DialogHandle { promise: Promise<DialogOutcome>; cancel(): void }  // ★ cancel()：终止+按 token 定向清理本人通知/状态文件
function cleanupRequest(token: string): void                 // ★ 幂等的定向清理入口；只动自己的 tag/状态文件，禁止 History.Clear
```

不变项：退出码 0/1/2/3/4 语义、reminder+protocol+VBS 主路径+PS 回退、watchdog+15s、PS1 BOM 与 VBS ASCII 门禁、`assertScriptsUsable`。退出码映射表 `mapExitCode` 冻结不动。PS1 脚本新增可选 `-RequestToken` 参数，无参数时走旧随机 ID 路径（手动脚本兼容）。

### 4.4 `src/store.ts`（D 独占）

```ts
class ApprovalStore {
  constructor(dataDir: string, owner?: { identity: string }) // ★ 打开前取同 dataDir 实例锁；冲突抛 StoreLockError（含 owner 诊断），绝不修改他人 pending
  insert(record: ApprovalRecord): void                       // 失败抛 StoreWriteError（调用方 → unavailable + 告警）
  settle(requestId: string, status: ApprovalStatus): void    // ★ 仅 pending → 终态；重复 settle 幂等；晚到结果不覆盖终态（WHERE status='pending'）
  close(): void                                              // ★ 释放锁；close 后访问抛 StoreClosedError
}
```

不变项：表结构、`ApprovalStatus` 七值词汇、WAL。变化：崩溃恢复改为**取得锁之后**把残留 pending 标 `'unavailable'`（不再是 timeout——不把崩溃伪装成超时；'timeout' 保留给真实展示超时）。锁文件管理全部封装在 store 模块内，异常退出回收须验证原 owner 已不存在（PID 重用/无法判定时保守拒绝并给人工处理说明）。

### 4.5 关闭来源 → 宿主结果映射（冻结，index.ts 接线）

| 关闭/结算来源 | 宿主结果 | 审计状态 |
|---|---|---|
| 用户点批准 | `allowed-once` | approved |
| 用户点拒绝 | `rejected` | rejected |
| 真实超时无人应答，timeoutAction=reject（默认） | `unavailable` | timeout |
| 真实超时无人应答，timeoutAction=approve | `allowed-once` | timeout（文案注明自动批准） |
| dismissed（保留词汇，当前通道不产生） | `unavailable` | dismissed |
| 宿主撤回（req.signal abort） | `cancelled` | cancelled |
| 插件卸载/关闭（queue close、lifetime abort） | `unavailable` | unavailable |
| 通道故障（spawn 失败/脚本异常/DB 故障） | `unavailable` | unavailable |

铁律：只有"真实 timeout + 显式 approve"能自动批准；abort/watchdog/exit/关闭/信号撤回一律不可走 approve 分支。

### 4.6 index.ts 关闭顺序（冻结，实现见 commit 2706621）

1. cordis 卸载：监听器同步注销（§2.4），此后不再有新请求进入队列；
2. `queue.close()`：排队项按 `onClose()→'unavailable'` 结算；close 内部 AbortController 中止活动 worker 的组合 signal。活动 dialog 内部的 `cancelled` 经 `effectiveDialogOutcome` 改判为 `unavailable`，审计也记 `unavailable`；close() 等待全部活动 worker 结算完成；
3. store：活动 worker 结算时已把各自审计行落终态；随后 `store.close()`（最后一步）；
4. worker/异步回调此后不得再触碰 store（settle 内部捕获 + 关闭后错误可诊断）。

活动条目在关闭阶段的宿主结果：真实用户未决策 → 宿主结果 discarded（宿主已撤回）或 unavailable；插件自身关闭的审计状态为 `unavailable`，宿主主动撤回的审计状态为 `cancelled`。

## 5. PASS / PENDING 汇总

| 项 | 结论 |
|---|---|
| 基线 commit、两版 tag、npm integrity | PASS |
| approval/request payload、结果词汇、waterfall/prepend/next（两版） | PASS |
| never / open turn / abort 竞争（两版） | PASS |
| displayReason 目标版新增 + 回退规则 | PASS（冻结 §2.2） |
| Cordis prepend / cleanup await 语义 | PASS（§2.4） |
| subagent/start、/end payload 与 stopReason | PASS（§2.5） |
| schemastery 3.18 判据与默认值投影 | PASS（实测）；深层 JSON Schema 投影 PENDING（需 dsh-app-boot 完整引导） |
| 0.1.7-rc.2 真实宿主非交互集成（审批、waterfall 共存、重载） | 本地 21/21 PASS；GitHub Actions 首轮运行 PENDING |
| Windows 实机全部用例 | PENDING → T6（C 独占） |

> **执行后更新（2026-09-30）：** 上表是契约冻结时的状态，不是发布就绪状态。T6 新包实机复测已由 C 签 G2 PASS；深层 JSON Schema 投影由 T6 S2 关闭；宿主级 V01–V08 受控测试通过。V16 完整真实子代理会话、GitHub Actions 首轮仍 PENDING。详见 [T7b 最新评估](./evidence/t7b-release-readiness.md)，不要将“Windows 实机全部用例”理解为每个 V 项均已完整执行。

## 6. 给 B/C/D 的开工说明

- 共同基线：`f608abd`，从 `adapt/dsh-017-host` 分支出各自分支（`adapt/dsh-017-queue` / `adapt/dsh-017-windows` / `adapt/dsh-017-store`），不共用 node_modules。
- 本文档 §4 签名冻结；§4.5/§4.6 是接线约定，B/C/D 只需保证自己的模块符合签名与语义。
- 需要接口变化时：提交变更请求 + 测试给 A，不得直接改对方文件。
- 完整 config 覆盖与 schema 默认值：timeoutSec 默认 30（schema）/60（bundle cordis.patch.yml 值，维持现状）；queueMode 默认 serial（schema）、parallel 3 为代码兜底。README 层面区分由 A 在 T7 统一写。
