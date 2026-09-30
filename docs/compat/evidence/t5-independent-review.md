# T5 独立复核报告（Agent B，2026-09-30）

复核对象：`D:\codex\dsh-approval-center` `adapt/dsh-017-host@1d7d2a867850cf43306458acc46c83e14cf8258a`（B 的 T5 `31358fb` 经 `1923a19` 合入 + A 修复 `d7af734` + T7a `1d7d2a8`）。
复核分支：`D:\codex\dsh-approval-center-B` 的 **`adapt/dsh-017-t5-review`**（独立 checkout，从主仓 FETCH_HEAD 建立，复核 commit 见文末）。未触碰主整合分支。

## 1. 结果总览

| 项 | 结论 |
|---|---|
| 集成测试（目标版） | **PASS：21/21，0 fail，0 skip，0 cancelled，0 todo**（B 独立复跑，非转录 A 记录） |
| 两条原失败用例 | 均 PASS（见 §3 逐条） |
| 旧版 0.1.5-rc.1 观察 | **PASS：4/4（新增文件，明确标注非支持承诺，见 §5）** |
| fixture 精确性 | 四个 dsh 包 + cordis 全部精确版本，lockfile integrity 完整（§2） |
| `test:integration` 门禁形态 | 显式文件列表 + `--import` 钩子，不会拉起人工 `test/approval.test.js`（§4） |
| CI 安装/解析路径 | 一致（§4） |

执行命令与计数：

```text
npm run test:integration                     → tests 21 / pass 21 / fail 0 / skipped 0
node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 \
  test/integration/{approval-flow,lifecycle,legacy-015-observe}.test.js
                                             → tests 25 / pass 25 / fail 0 / skipped 0
```

环境：Windows（本机桌面账户）、Node v24.20.0、插件 lib 由 `npm run build` 从 `1d7d2a8` 源码现构建。

## 2. fixture 精确版本与解析路径（目标版）

- 实装版本（`test/integration/node_modules/*/package.json`）：`@deepseek-ai/cordis 4.0.4`；`@deepseek-ai/dsh-{llm,scope,session,user-approval}` 均 `0.1.7-rc.2`。
- `package-lock.json` 内五包条目版本一致且均有 `sha512-` integrity（dsh-user-approval `RQ6GB+...`、cordis `obgyxq...` 等，与 registry 实查值一致）。
- 解析验证（ESM 按模块 URL 上溯）：`import.meta.resolve` 自 `test/integration/helpers/` 解析到 `test/integration/node_modules/@deepseek-ai/cordis/lib/index.js` 与 `.../dsh-user-approval/lib/index.js` —— 测试加载的就是精确版本 fixture，不是宿主残留或提升副本。
- 真实性：测试进程内实例化的是 fixture 的真实 Context/ApprovalService；仅 `powershell.exe` 异步 spawn 被 mock（`hooks/spawn-shim.mjs`）。 approval/asked+decided、open turn 校验、never 短路、signal 竞争、审计配对全部走真实宿主代码路径。

## 3. 两条原失败用例的修复复核（src diff 1d7d2a8 vs 31358fb）

1. **unload-cancelled**：新增 `effectiveDialogOutcome(outcome, pluginClosed)`（src/host-contract.ts），`queue.close()` 中止的活动 worker 以 cancelled 到达时改判 `unavailable`；index.ts 在 settle 前接线。已核实实现使用队列状态而非组合 signal 判断（close 先落 closed 再 abort，时序可靠）。已知窄竞态：宿主撤回与插件关闭同时发生时按关闭处理（审计记 unavailable 而非 cancelled）——注释已声明取舍，且宿主侧早已结算 cancelled、不受影响，方向保守，可接受。
2. **settle-failure-receipt**：新增 `approvalResultLabel(outcome, { timeoutAction, settleFailed })`，settle 失败后文案改为"审计结算失败，已按渠道不可用处理"，不再出现"已批准"。回归断言（`!message.includes('已批准')`）实测通过。
3. 附带核实：dialog abort/cancel 路径现会清除看门狗（B 前轮报告的遗留定时器问题已处理）。

## 4. 测试门禁形态与 CI 一致性

- `package.json`：`test:integration` = `node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 test/integration/approval-flow.test.js test/integration/lifecycle.test.js`——显式文件列表，`test/approval.test.js`（人工 Toast）不在其中，也不会被通配拉起；`test:unit` 同样显式列表排除人工用例。
- 测试文件内无 `t.skip/todo`（runner 输出 skipped/todo/cancelled 全 0 佐证）。
- `ci.yml` / `release.yml`：根目录 `npm ci && build && test:unit`；`working-directory: test/integration` 与 `test/integration/fixture-015` 各自 `npm ci --ignore-scripts`（使用两份已提交 lockfile），随后根目录跑 `test:integration`——安装位置与 ESM 解析上溯路径一致（§2）。CI 实际运行结果本会话无法观测，维持派发包的 CI PENDING 结论。

## 5. 新增：旧版 0.1.5-rc.1 回归观察（隔离分支 commit，待 A 决定是否整合）

新增 `test/integration/legacy-015-observe.test.js`（4 用例，PASS 4/4）：

1. 匹配审批流：allowed-once + asked/decided 同 id 配对 + 审计 approved；
2. 旧版 payload 无 displayReason：展示回退原始 reason，审计保存原始 reason；
3. never 策略（会话级 `setApprovalPolicy`）：派发前短路，插件零 spawn/零记录；
4. 进行中撤回：cancelled、子进程被杀、审计 cancelled。

隔离机制：node --test 每文件独立子进程；文件内用 `createRequire(fixture-015/package.json)` 加载旧版 cordis/ApprovalService 实例，不 import 任何 0.1.7 fixture 包，两套宿主零模块共享。文件头明确声明"观察，不构成双版本支持承诺"。**旧版观察不作为 C/T6 前置门，不改变 peer 声明（仍精确 `0.1.7-rc.2`）。**

建议（供 A 裁量）：若整合，可在 `test:integration` 文件列表追加 `legacy-015-observe.test.js` 并在命令注释标注"旧版观察层"；不整合也不影响目标版门。

## 6. 复核中发现的问题

- 无阻断问题。两条窄边界备忘：(a) §3-1 的撤回×关闭窄竞态按关闭处理（低风险，已声明）；(b) 旧版 `ApprovalService` 构造必须显式传 `{ policy }`（旧版无默认兜底），观察文件已按此处理——给未来旧版工作留档。

## 7. 交接要素

- 任务 ID / Agent：T5 独立复核 / Agent B
- 共同基线：`adapt/dsh-017-host@1d7d2a867850cf43306458acc46c83e14cf8258a`
- 复核分支与 commit：`adapt/dsh-017-t5-review`（`D:\codex\dsh-approval-center-B`），新增 legacy 观察文件与本文档
- 修改文件：`test/integration/legacy-015-observe.test.js`（新增）、`docs/compat/evidence/t5-independent-review.md`（新增）
- 固定宿主版本：`0.1.7-rc.2`（integrity 见 §2）；候选 tgz SHA `7CE7ACAD...F819D` 本轮未重新验证（归 A 的 G1 签收范围）
- 全局环境改动：无（全程 mock 通道；未触碰真实 Toast/URI/生产 profile）
