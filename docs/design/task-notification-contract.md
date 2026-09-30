# T0 契约冻结：主对话审批 / 完成 / 错误通知（dsh-approval-center × DSH 0.1.7-rc.2）

冻结日期：2026-09-30。编制：**Agent A**（T0 契约 + T4 接线/整合/发布候选）。
本文档是 T0 交付物，是 B/C/D 开工的**唯一接口依据**。接口变更须走 A 的变更请求（CR），
任何成员不得自行修改本文冻结的 public 签名。

**本文件取代**此前由 C 侧按计划书原文推导的
`task-notification-sender-contract-c.md`（其自述为 "不是对 A 的 T0 的替代"，并挂了 CR-C-1）。
CR-C-1 的裁决见 §8。

---

## 0. 修订约束（本轮需求的硬边界）

用户明确要求：**关闭所有子代理通知**，仅保留主对话的审批请求、完成通知、错误/异常通知。

- 删除 `subagent/start`、`subagent/end` 的发送监听。
- 旧开关 `notifyOnSubagentStart` / `notifyOnSubagentEnd` **仅作弃用兼容字段**：即使旧配置为
  `true` 也**强制不生效**，不得只改默认值而让旧配置继续响铃。可限频记录一次弃用日志。
- 子代理事件在**入队之前**被过滤：不产生 PowerShell 进程、不占队列、不建去重项。
- 子代理 `completed/aborted/error/max-tokens/refusal` 与 continuation 一律静默；
  绝不把子代理错误转成父会话错误通知。
- `notifyOnApprovalResult` 保持默认 `false`，仅允许主对话显式启用；子代理结果回执始终禁用。

---

## 1. 基线与完整性（T0-1）

| 项 | 实测值 | 结论 |
|---|---|---|
| 已发布 tag `v0.3.1-rc.1` | **annotated** tag 对象 `d1db71e9a976af54ba2d0328fa131d816f8d0650` | PASS |
| tag 指向的 commit | `4f6e04b2fb2fcbf261cbb052ffb0e543814cd0de` | PASS（与计划书 §3 一致） |
| tag commit 的 tree | `b4143c4e2edd7adb863ddf6382e2b7d7cac543a2` | — |
| `adapt/dsh-017-host` HEAD | `da3404bcba2d6c30790a4f72aaeb266f410cbdad` | — |
| 本地 `main` | `f608abd074315b430a3ab17f26b51129cdd185c7` | **陈旧**（见下） |

### 1.1 拓扑实测（计划书 §3 要求 A 实际 resolve，不得假设）

```
main (f608abd) ──┐
                 ├──> 4f6e04b (tag v0.3.1-rc.1)   ← merge commit
da3404b ─────────┘
```

实测命令与结果：

- `git rev-parse v0.3.1-rc.1^{commit}` → `4f6e04b…`（tag 是 annotated，需 `^{commit}` 解引用）
- `git merge-base --is-ancestor main v0.3.1-rc.1` → **0（是）**：main 是 tag 的祖先
- `git merge-base --is-ancestor v0.3.1-rc.1 main` → **1（否）**：tag **不是** main 的祖先
- `git merge-base --is-ancestor da3404b v0.3.1-rc.1` → **0（是）**：adapt 分支 HEAD 是 tag 的祖先
- `git rev-list --count main..v0.3.1-rc.1` → **48**
- `git diff --raw HEAD v0.3.1-rc.1` → **空**（tree 逐字节相同）

### 1.2 共同完整基线（冻结）

> **共同基线 commit = `4f6e04b2fb2fcbf261cbb052ffb0e543814cd0de`（tag `v0.3.1-rc.1`）**

**关键结论（与计划书原文的差异，必须记录）：**

1. 计划书 §3 说「当前本地 adapt 分支不应误当最新 main」。实测更严重：**本地 `main`
   (`f608abd`) 比 tag 落后 48 个 commit**，且 tag 的 tree 与 `adapt/dsh-017-host` HEAD
   (`da3404b`) **逐字节相同**（`git diff --raw` 为空）。
2. 因此**从 `main` 建 worktree 会退回 v0.3.0 时代**，缺少 v0.3.1-rc.1 的全部修复
   （Unicode 映射、VBS 处理器、定向清理、store 实例锁等）。
3. 本契约的全部成员一律**从 tag commit `4f6e04b` 建 worktree**，不碰 `main`。

各成员工作树（A 已创建，均为 tag commit）：

| Agent | 工作树 | 分支 |
|---|---|---|
| A | `D:\codex\dsh-notify-A` | `adapt/dsh-018-notify-a` |
| B | `D:\codex\dsh-notify-B` | `adapt/dsh-018-notify-b` |
| C | `D:\codex\dsh-notify-C` | `adapt/dsh-018-notify-c` |
| D | `D:\codex\dsh-notify-D` | `adapt/dsh-018-notify-d` |

### 1.3 前置尝试残留（A 的处置，不改动）

仓库中已存在**上一轮中止尝试**留下的工作树与未提交内容，A 已核实并**原样保留，未删除**：

- `D:\codex\dsh-approval-center-notif-B`（分支 `adapt/dsh-017-notifications`，HEAD `da3404b`）：
  未跟踪 `src/notifications.ts`、`test/notifications.test.js`、`test/notification-format.test.js`、`lib/notifications.*`。
  A 实测：`typecheck`/`build` 通过；新测试 **74 pass / 1 fail**。
- `D:\codex\dsh-approval-center-c-tasknotify`（分支 `adapt/task-notify-windows`，HEAD `4f6e04b`）：
  未跟踪 `docs/design/task-notification-sender-contract-c.md`。
- `D:\codex\dsh-approval-center-d-t3`（分支 `adapt/dsh-017-t3`，HEAD `4f6e04b`）：
  未跟踪 `docs/design/task-notification-user-guide-draft.md`、`docs/evidence/task-notifications/package-repro-review.md`、`test/integration/.probe/`。

**这些是参考素材，不是已完成交付**：它们产生于 T0 冻结**之前**，且 B 的残留存在 1 个真实失败用例
（见 §7）。B/C/D 可参考，但必须按本契约独立核对，不得直接宣称完成。

---

## 2. 宿主契约核对（T0-2，只读核实，非猜测）

### 2.1 证据来源与版本（PASS）

| 来源 | 版本 | 用途 |
|---|---|---|
| `D:\dsh-title-dev\dsh-cli\node_modules\@deepseek-ai\*` | **0.1.7-rc.2** | 目标版宿主事实来源 |
| `D:\codex\dsh-approval-center\test\integration\node_modules\@deepseek-ai\*` | **0.1.7-rc.2** | 集成测试 fixture（CI 强制门） |
| `C:\Users\A\.dsh\dsh-cli\node_modules\@deepseek-ai\*` | 0.1.5-rc.2 | **当前实际运行中的 DSH GUI 宿主** |

> ⚠ **风险记录（A 实测发现）**：当前正在运行的 DSH（本会话 GUI）是 **0.1.5-rc.2**，
> 而本插件 `peerDependencies` 精确声明 `@deepseek-ai/dsh: 0.1.7-rc.2`。本插件的目标宿主是
> 0.1.7-rc.2，全部契约与门禁均按 0.1.7-rc.2 冻结；0.1.5-rc.2 的兼容性**不在本轮范围**。
> 该事实写入交接风险，不作为 PASS 依据。

### 2.2 `session/event` 监听入口（PASS，目标版）

```ts
// @deepseek-ai/dsh-session/lib/types/index.d.ts:64
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;
```

- 模式为 **emit**（非 waterfall）：监听器同步返回，**不 await 回调**。因此 A 的接线必须
  同步返回，绝不 await PowerShell；异步失败由 NotificationService 自行捕获。
- **scope 过滤**：`@deepseek-ai/dsh-scope` 按 session 的 owner scope 派发。
  ⇒ 监听必须在 **profile 根上下文**注册；agent-scoped 监听只能收到相应作用域的事件。
- 仅当 session 被 **attach/enter** 后才派发（`dsh-session/lib/index.js:1426-1433`，
  `attachments.get(session)` 为 `undefined` 时不收集回调）。
- **seed 历史不经 `session/event` 发布**（`index.d.ts:126` "Seed events never publish on
  `session/event`"）。⇒ 重放/恢复/分叉的构造期事件不会触发通知，这是**正确**行为，
  也是"历史修复不误报"的结构保证。
- `turn` 边界**不是**持久化 flush 的确认（`types.d.ts:265-272` 原文：loop does not await a
  flush at turn boundaries）。⇒ 通知表达**执行结束**，不表达"所有数据已落盘"。

### 2.3 `turn/end` 与 `step/start`（PASS，目标版）

```ts
'turn/start': { turn: number }
'turn/end':   { turn: number; reason: TurnEndReason }
'step/start': { turn: number; step: number }
```

`TurnEndReasonMap`（`types.d.ts:165-208`）**封闭词汇实测**：

| kind | 含义 | 本插件行为 |
|---|---|---|
| `completed` | 本轮成功 | **成功通知**（受 step 门禁） |
| `error` | 本轮失败，`error` 是结构化 `LlmFailure` | **错误通知**（非成功） |
| `blocked` | 本轮受阻 | 通知："本轮执行受阻"（非成功） |
| `max-tokens` | 至少一步触顶 | 通知："本轮达到输出上限"（非成功） |
| `aborted` | 取消请求中断 | **静默**（用户取消） |
| `interrupted` | 崩溃恢复事后闭合 | **静默**（历史修复） |
| `forked` | fork seed 闭合源会话未结束的轮 | **静默**（fork seed） |

- `TurnEndReasonMap` **可被插件 merge 扩展**（原文 "Merge-extensible sum type"）。
  ⇒ 实现必须带 `default` 分支**保守静默**，不得把未知 kind 当成功。
- 计划书 §2.1 的分类与实测词汇**完全一致**（7 个 kind 全部覆盖）。
- `turn/end` **不含堆栈**：`error` 变体只带 `{ message, code }`，`message` 是 `errorChain` 摘要。
  ⇒ 本插件**只读 `reason.kind`**，不读 `reason` 任何其他字段。隐私边界由结构保证，不靠过滤。

### 2.4 主/子身份判据（PASS，目标版）— 冻结

```ts
// @deepseek-ai/dsh-session/lib/types/types.d.ts SessionHeader
readonly origin?: 'subagent'
readonly parentSession?: SessionId
readonly isSeeded: boolean
readonly delegationDepth?: number
```

**冻结判据（唯一）**：

```
header.origin === 'subagent'  →  子代理会话（一律静默）
否则                          →  主会话
```

**为什么不能用其他字段（逐条否决，计划书 §2.2 要求）**：

| 候选 | 否决理由（实测原文） |
|---|---|
| `parentSession` | 注释原文 "The session this one was forked from (seed lineage)"。**fork 也会保留父会话关系**，会把 fork 根会话误判为子代理。 |
| `delegationDepth` | 注释原文 "Delegation depth: absent (zero) for a top-level session, parent depth + 1 for a subagent child… Persisted so a **recursion budget** survives restart"。它是**递归预算**，不是主分类。 |
| `isSeeded` | fork seed 为 true，但 fork 根会话仍是主会话。 |
| 输出文本 / 进程退出 / 网页状态 / 日志正则 | 计划书 §2.2 明确禁止"从输出文本、进程退出、网页状态或日志正则猜测"。 |

- `origin` 是 "Coarse **product classification** for a session created as a subagent child"，
  且注释声明 "This is presentation metadata, not proof that the child is continuable"
  ⇒ 用于**展示分类**是它的设计意图，本用途正当。
- root 会话该字段**缺省**（`undefined`），**不存在** `'root'` / `'main'` 字面量。
  ⇒ 判据必须是"等于 `'subagent'`"，不得写"等于 `'root'`"。
- **A 已核对计划书 §2.2 的说法**："主通知路径排除 `session.header.origin === 'subagent'`…
  这是目标版公开分类字段" — **成立**。

### 2.5 标题读取（PASS，目标版）— 冻结

```ts
// @deepseek-ai/dsh-session-title/lib/types/types.d.ts
export interface SessionTitleEventData {
  readonly title: string          // Normalized non-empty title text
  readonly messageSeqs: SessionSeq[]
  readonly source: SessionTitleSource
}
```

- `session/title` 由 `dsh-session-title` 通过 module augmentation 注册进 `SessionEventMap`
  （`dsh-session-title/lib/types/index.d.ts:42`）。**它不在 `dsh-session` 自身的事件表里**
  ⇒ 集成测试 fixture 若只装 `dsh-session` 将**看不到** `session/title`，属预期。
- 计划书 §2.3 说 "session-title 目标版公开 title:string" — **成立**（`SessionTitleEventData.title`）。
- 计划书 §2.3 说 "**禁止假设 session.title 存在**" — **成立**：`Session` 上没有 `title` 属性，
  只有 `header`（`SessionHeader` 不含 title）。标题**只能**从事件流取。

**冻结读取顺序**：

1. 最新 `session/title` 事件的 `data.title`（事件流增量维护）；
2. 首次遇到某会话时，用公开 `session.snapshotEvents()` 找**最后一条** `session/title`
   （`index.d.ts:193` `snapshotEvents(fromSeq?, toSeqExclusive?)`，公开 API）；
3. 都没有 → 回退 `会话 <短ID>`。

- **不需要**额外标题服务，**不需要**模型调用。
- `session.title` 属性**不存在**，禁止假设。
- 标题缓存必须有**容量上界**与 **session/disposed 清理**（计划书 §4 A 段要求）。
- 正常 `turn/end` 即释放本轮状态（**不只是**通知去重缓存）。

### 2.6 审批请求 → Session 解析（PASS，目标版）— §2.7 的前置

```ts
// @deepseek-ai/dsh-user-approval/lib/types/types.d.ts
export interface ApprovalRequestEvent {
  readonly agent: Agent          // "Agent identity projected to the corresponding Client Context in transit"
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}
// @deepseek-ai/dsh-agent/lib/types/types.d.ts
export interface Agent { readonly id: SessionId }   // 公开面只保证 id
```

- **`req.agent` 的 wire-safe 公开面只有 `id`**（`Agent` 接口仅声明 `readonly id`）。
  `agent.session` 是**运行时增强**（`dsh-agent/lib/types/runtime-types.d.ts:143`
  `readonly session: Session`），**不能假定请求对象上带着它**。
- **冻结解析顺序**（计划书 §2.7 "优先其公开 session，必要时按宿主公开查询 API 查回 session"）：

  ```
  1) req.agent?.session          （若运行时增强存在，直接用）
  2) ctx.agents.get(req.agent.id)?.session
     （AgentRegistry.get(id: SessionId): Agent | undefined
       — dsh-agent/lib/types/index.d.ts；ctx.agents 为 AgentRegistry）
  3) 都拿不到 → 身份无法确认 → 本插件不认领
  ```

- **安全默认（冻结）**：身份无法可靠确认的请求**不认领** —— 不入审批队列、不创建本插件审批记录、
  不弹窗，调用 `next()` **恰一次**交宿主其他应答者处理。**绝不静默自动批准或拒绝**。
- 子代理审批（解析出的 session `header.origin === 'subagent'`）同样不认领。
- `tools` 不匹配继续保持 `next()`。
- **文档必须说明**：宿主不存在后续渠道时遵循宿主原有兜底，子代理仍可能在宿主界面等待人工审批；
  本插件无法替其他程序禁止通知。

### 2.7 子代理事件（本轮仅用于"确认为零通知"）

```ts
// @deepseek-ai/dsh-subagent/lib/types/types.d.ts（0.1.7-rc.2）
subagent/start(info: SubagentRunInfo)
subagent/end(info: SubagentRunEndInfo)   // { runId, provider, id, local, stopReason, lastAssistantMessage? }
SubagentStopReason = 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'
```

- `stopReason` 在目标版**非可选**，词汇封闭。
- 本轮**不监听**这两个事件；相关既有文案函数 `subagentEndLabel` 保留但不再被通知路径调用。
- 子代理 `continuation` 复用同一 child session ⇒ 若未来要通知，去重必须用 `runId` 而非 `childId`。
  本轮一律静默，不涉及。

---

## 3. 行为契约（T0-3）— 冻结

### 3.1 "完成"的准确含义

第一版以 **"主会话完成一次实际执行的一轮"** 为通知边界。

- 模型完成一次回复 **≠** 用户所有任务目标已达成，**≠** 全部后台子代理都已结束。
- 文案使用 **"本轮回复已完成"**，**不无条件声称"项目已完成"**。
- **任何子代理事件都不产生通知。**

**通知触发矩阵（冻结）**：

| 条件 | 通知 |
|---|---|
| 主会话 `turn/end` 且 `reason.kind === 'completed'` 且该轮**确有 `step/start`** | 成功通知 |
| 主会话 `completed` 但**未观察到 `step/start`** | **不通知**（热加载中途接入，首版不补发） |
| 主会话 `error` | 错误通知："本轮执行出错" |
| 主会话 `blocked` | 通知："本轮执行受阻"（非成功） |
| 主会话 `max-tokens` | 通知："本轮达到输出上限"（非成功） |
| 主会话 `aborted` | **静默**（用户取消，默认静默） |
| `interrupted` / `forked` / 未知 kind | **静默**（保守） |
| 等待审批 / 单个工具完成 / 单个 step 完成 | **不通知**（不算一轮结束） |
| 子代理任何终态 | **静默** |

- **step 门禁只约束 `completed`**：`error`/`blocked`/`max-tokens` 是宿主真实终态，
  即使没有 step 也应提示（否则真实失败被吞掉）。
- **热加载中途**没有观察到 `step/start` 的轮次，首版**不补发**完成提醒。此限制写入用户文档。
- **卸载**停止监听并丢弃待发通知，**不补播历史**。

### 3.2 内容与隐私（冻结）

主会话成功：
```
标题：本轮回复已完成
正文：任务：<会话标题>
      Agent 已完成这一轮回复，请返回 DSH 查看。
```

主会话错误：
```
标题：本轮执行出错
正文：任务：<会话标题>
      本轮执行失败，请返回 DSH 查看详情。
```

**禁止出现在完成/错误通知中的内容**：完整回答、工具命令、提示词、凭据、绝对目录、原始错误堆栈。

- **不把原始异常堆栈塞进通知**（结构上已保证：只读 `reason.kind`）。
- **通知发送自身失败仅记录日志**，**不再发送错误通知**（避免递归弹窗与失败提示音）。
- `taskNotificationShowTitle = true`（默认）：显示标题；设 `false` **仅显示短 ID**。
  文档提示：锁屏也可能展示正文。
- **审批卡片**允许显示宿主明确提供的操作与审批原因（§3.4），**不与完成通知的隐私规则混淆**。
- 标题来源：最新 `session/title.data.title` → `会话 <短ID>`。

**文本上界与归一化（冻结）**：

| 项 | 值 |
|---|---|
| 任务名 | 60 个 **Unicode 码点** |
| 完成/错误正文 | 160 个 Unicode 码点 |
| 超限处理 | 以省略号 `…` 截断 |
| 截断实现 | **必须按码点（`Array.from`）切**，绝不切坏代理对（surrogate pair） |
| 控制字符 | 归一化：删除 C0/C1/DEL、零宽字符、bidi 嵌入/覆盖/隔离符（U+202A–202E、U+2066–2069）；CRLF/CR→LF；连续 3+ 换行折叠为 2 |
| XML 转义 | 复用现有实现（`Escape-Xml`）并补充测试 |

### 3.3 去重、进程与生命周期（冻结）

- 新增**独立 NotificationService**，**不借用审批队列**。
- 任何通知异常**不改变**审批结果、模型结果或 SQLite 审批记录。
- **主通知 key = `sessionId + turn`**；同一轮完成/错误只取宿主真实终态**一次**，不双报。
- 同一 key 在**同进程生命周期**最多入队一次。
- 子代理事件在**入队前**过滤：不得产生 PowerShell 进程或占用队列。
- **有界 TTL 缓存**：TTL 建议 **24h**，容量最多 **4096** 项。接受容量淘汰后**不提供永久
  exactly-once**；**不新增通知 SQLite 表**、**不承诺跨进程严格去重**。
- Tag = key 哈希映射为 **16 位 ASCII 十六进制**；Group 固定 **`dsh-task`**。
  审批 `dsh-approval` 与旧结果 `dsh-result` **保持隔离**。相同 tag/group 作为第二层替换保障。
- 缓存去重与实际投递是 **best-effort**，无法保证被 Windows 阻止后补发。
- **队列**：仅 **1 个** PowerShell worker；最多 **100** 条待发；进程 watchdog **10 秒**；
  溢出**丢弃最新**并**限频告警**。
- **第一版不自动重试**：WinRT 已接收而进程超时的情形不能证明未发送，重试可能重复响铃。
- 大量不同任务由 Windows 折叠；截图里的"+20 个通知"是**系统呈现**，
  **不承诺**精确复刻数字或外观。
- `close()`：立即停止接受、丢弃待发、杀死活动发送进程并**等待有限时间**；
  **不删除**已经显示的任务历史。
- 通知队列**没有**强制审批数据依赖。
- **最多等待 12 秒**完成清理；活动进程 `exit`/`error`/`timeout` **只结算一次**；
  所有 timer/listener 清理。

### 3.4 主对话审批卡片内容（冻结，计划书 §2.7）

**认领前置**：按 §2.6 解析 session 并判定主/子。子代理与身份不可确认的请求**不认领**，
`next()` 恰一次。

结构化内容（ToastGeneric 多行）：

```
需要你审批 · <工具名>
任务：<标题 或 会话短ID>
操作：<宿主工具名 / 明确操作摘要>
原因：<displayReason 的 zh-CN→zh→reason→en 回退>
选择：批准=本次允许；拒绝=不允许执行
等待：<timeoutSec>秒；超时=<按实际配置>
```

示例：
```
需要你审批 · bash
任务：修复登录问题
操作：bash
原因：需要执行沙箱外操作
选择：批准=本次允许；拒绝=不允许执行
等待：60秒；超时=自动拒绝
```

**硬约束（逐条冻结）**：

| # | 约束 |
|---|---|
| 1 | 保留**批准/拒绝按钮** |
| 2 | **不得**把批准描述成**永久授权**（"批准=本次允许"） |
| 3 | `timeoutAction=approve` **必须醒目写"超时自动批准"**，**不可**写默认拒绝文案 |
| 4 | `reason` 缺失显示 **"宿主未提供审批原因"** |
| 5 | **工具名不是命令**，不假装已展示命令；不拼接未核实字段，不从日志抓取 |
| 6 | 原始 `reason` 仍用于**审计**；中文 `displayReason` **仅展示** |
| 7 | 原因可合理截断并**显式标记**"已截断，请在 DSH 查看完整内容" |
| 8 | 任务名短 ID **保证识别来源** |
| 9 | **禁止**隐藏风险、写反按钮、或无限正文挤掉"选择"含义 |
| 10 | 审批卡片改动**不得改变** URI 参数、`requestToken`、退出码、超时动作或审计语义 |

**旧子代理通知不自动批量清除**：此前随机 tag 无法可靠归属，**不用 `History.Clear`**
清掉主审批记录。关闭的是**后续发送**；已有历史由用户手动清除。

---

## 4. 跨模块冻结接口（T0-4）

以下为**冻结版签名**。这是**插件内部接口，不冒称宿主类型**。

### 4.1 `src/notifications.ts`（B 独占）

```ts
/** 归一化后的宿主事件（A 的身份适配器产出；B 不自行决定宿主事件签名）。 */
export interface TurnEventInput {
  kind: 'turn-start' | 'step-start' | 'turn-end'
  sessionId: string
  turn: number
  /** 宿主 session.header.origin；'subagent' → 零动作。root 会话为 undefined。 */
  origin?: string | undefined
  /** turn/end 的 reason.kind；未知/缺省一律静默。 */
  reasonKind?: string | undefined
  /** 会话标题（A 的适配器解析后传入）；B 不读宿主标题。 */
  title?: string | undefined
}

export interface NotificationMessage {
  key: string              // 主通知 = `${sessionId}:${turn}`
  source: 'turn'
  sessionId: string
  title: string            // 已归一化/截断
  message: string          // 已归一化/截断；可含 \n
  silent: boolean          // true = 不响铃
}

export type SendResult = 'submitted' | 'failed' | 'aborted'

export interface NotificationSender {
  send(message: NotificationMessage, signal: AbortSignal): Promise<SendResult>
}

export class NotificationService {
  constructor(options: NotificationServiceOptions)
  observe(event: TurnEventInput): NotificationMessage | null
  enqueue(message: NotificationMessage): boolean
  close(): Promise<void>
  get lifecycle(): 'accepting' | 'closed'
}
```

**AbortSignal 归属（冻结裁决）**：`NotificationSender.send` 的 `signal` 由
**NotificationService 创建并持有**（每条发送一个 `AbortController`），用于：
watchdog 超时中止、`close()` 中止在飞发送。sender **不得**创建或替换该 signal，
但**必须**响应其 `abort`（kill 子进程并结算 `'aborted'`）。

**幂等结算（冻结）**：`exit` / `error` / `abort` / `watchdog` 四路竞争，**只结算一次**，
先到先得。`close()` 幂等。

### 4.2 `src/host-contract.ts`（A 独占）— 新增身份适配器与标题读取

```ts
/** 主/子身份判据（§2.4）：origin === 'subagent' → 'subagent'；否则 'root'。 */
export function classifySessionOrigin(header: { origin?: string } | undefined): 'subagent' | 'root'

/** 审批请求 → Session 解析（§2.6）。返回 undefined 表示身份不可确认（不认领）。 */
export function resolveRequestSession(
  req: { agent?: { id?: string; session?: unknown } },
  lookup?: (id: string) => { header?: { origin?: string } } | undefined,
): { header?: { origin?: string } } | undefined

/** 从事件流取最新 session/title 的 title；无则 undefined（§2.5）。 */
export function latestTitleFromEvents(events: readonly { type: string; data?: { title?: unknown } }[]): string | undefined
```

- 现有 `selectDisplayReason` / `matchTool` / `HOST_OUTCOME` / `STORE_STATUS` / `RESULT_LABEL`
  / `agentIdOf` / `effectiveDialogOutcome` / `approvalResultLabel` **保持不变**。
- `subagentEndLabel` **保留**（不再被通知路径调用）。

### 4.3 `src/dialog.ts`（C 独占）— 任务 sender

```ts
/** 任务通知 sender（新增）。保留 showToast 兼容路径。 */
export function createTaskNotificationSender(deps?: TaskSenderDeps): NotificationSender
```

**不变项**：审批 `showApprovalToast` 的协议 URI、退出码 0/1/2/3/4 语义、`reminder`+protocol+VBS
主路径、`cleanupRequest` 定向清理、`assertScriptsUsable` BOM/ASCII 门禁、`mapExitCode` 映射表。

### 4.4 `scripts/toast.ps1`（C 独占）

```
-File toast.ps1 -Title <string> -Message <string>
     [-Tag <^[0-9a-f]{16}$>] [-Group <'dsh-task'>] [-Sound <silent|default>]
```

- Tag/Group **双端白名单校验**（Node 侧 + 脚本侧）。
- **参数数组**启动，**不使用**拼接 Shell 命令或 `Invoke-Expression`。
- **UTF-8 BOM**；中文、空格、emoji 路径/正文要覆盖。
- stdout/stderr 管道**受限收集**诊断；**禁止**输出敏感正文。
- 区分**启动失败 / 非零退出 / watchdog 超时**；日志**不宣称"用户已看到"**。
- 默认静音：`<audio silent="true"/>`；可配置系统默认提示音。
- 保留现有 AUMID 与应用显示名，**第一版不更名、不改 URI**。

### 4.5 配置（A 独占，`src/index.ts`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `notifyOnTurnEnd` | `true` | 主会话成功结束 |
| `notifyOnTurnFailure` | `true` | 主会话异常（error/blocked/max-tokens） |
| `taskNotificationSound` | `'silent'` | `'silent' \| 'default'` |
| `taskNotificationShowTitle` | `true` | 设 `false` 仅短 ID |
| `notifyOnSubagentStart` | `false` | **弃用**：即使旧配置 `true` 也强制不生效 |
| `notifyOnSubagentEnd` | `false` | **弃用**：同上 |
| `notifyOnApprovalResult` | `false` | 仅允许主对话显式启用 |

- 审批请求**保留现有声音行为**，本轮不擅自改变审批交互。
- README **仅提供**"主对话审批+完成+错误"完整 profile 配置，**删除**启用子代理提醒的示例。
- **id 定向补丁会整体替换 config**，不能只写一个新字段而意外重置 `tools`/`timeoutAction` 等。

### 4.6 第一版明确不做（非目标）

- **没有**批准/拒绝按钮的任务通知。
- **没有**"点击打开特定任务"的协议跳转（避免与审批 URI 共用解析逻辑）。
- 任务跳转及自定义图标**后续独立设计**。

---

## 5. 共同规则与门禁（T0-5）

### 5.1 禁止事项（全员）

- **不得**在自动测试中启动真实 Toast、`wscript` 或修改 `HKCU`。
- **不得**自行重装生产 profile。
- **不得**修改本文冻结的 public 签名（走 CR）。
- **不得**删除上一轮残留工作树（A 已保留；见 §1.3）。

### 5.2 Windows 实机（仅 C，独占时段）

- 进入前记录：AUMID / URI / 通知历史。
- 测试后**只清本轮 `dsh-task` tag**；**不 `History.Clear()`**，不清掉用户审批或其他结果。

### 5.3 门禁

- **N0**：契约签名/来源/identity/原因/配置已冻结。
- **N1**：既有审批回归 + 新增单测/精确宿主集成**无失败**；CI 无真实通知。
- **N2**：固定包 Windows 主对话完成/错误与审批共存实机通过；子代理所有路径**零本插件通知与
  发送进程**，旧开关 `true` 也无效；声音符合配置；主审批卡片来源/操作/原因/选择/超时清楚且
  实际回传一致；范围与 PENDING 如实记录。
- **N3**：tgz 版本/peer/脚本 BOM/构建逐字节/附件 SHA 全部核验。
- **N4**：README 仅主对话的完整配置 + 升级回滚 + 受限行为；审批数据 schema 不变；
  关闭主完成/错误新开关后仅剩主对话审批，子代理开关**始终无效**。

### 5.4 验收铁律

- 任何失败测试**不得**合并成"整体通过"。
- 通知 API 成功**不得**写成"用户已看到"。
- 纯 mock **不得**替代真正 DSH 任务完成验收。

---

## 6. 文件所有权（避免并行冲突）

| 文件 | 所有者 |
|---|---|
| `src/notifications.ts`、`test/notifications.test.js`、`test/notification-format.test.js` | **B** |
| `src/dialog.ts`（sender 新增）、`scripts/toast.ps1`、`scripts/approval-toast.ps1`（仅视觉）、`test/task-toast-sender.test.js`、`test/task-toast-script.test.js`、`docs/evidence/task-notifications/windows/` | **C** |
| `test/integration/task-notifications.test.js`、`test/integration/fixture` 清单、`docs/evidence/task-notifications/integration.md`、`docs/design/task-notification-user-guide-draft.md` | **D** |
| `src/index.ts`、`src/host-contract.ts`、`cordis.patch.yml`、`package.json`、`.github/workflows/`、`README.md`、`CHANGELOG.md`、`docs/design/task-notification-contract.md` | **A** |

- B **不得**改 `index.ts`、`dialog.ts`、PS 脚本、`package.json`。
- C **不得**改 `index.ts`、`host-contract.ts`、`cordis.patch.yml`、`package.json`、README/CHANGELOG。
- D **不得**改前三位的源码。
- 接口不一致 → **提交 CR**，不私改他人文件。

---

## 7. 已知缺陷与风险（A 实测，如实记录）

| # | 项 | 状态 |
|---|---|---|
| 1 | 本地 `main` 比 tag 落后 48 commit；从 `main` 建树会退回 v0.3.0 | **已规避**：全员从 `4f6e04b` 建树 |
| 2 | 当前运行的 DSH GUI 是 **0.1.5-rc.2**，插件 peer 声明 0.1.7-rc.2 | **风险**：本机实机验收环境与目标版不一致 |
| 3 | 上一轮 B 残留有 1 个真实失败用例 `NF-35b`（超长工具名截断后"选择："行被挤掉） | **待 B 修复** |
| 4 | 上一轮残留产生于 T0 之前，未经契约核对 | **参考素材，非交付** |
| 5 | `session/title` 不在 `dsh-session` 自身事件表，fixture 需 `dsh-session-title` | **D 须扩展 fixture** |
| 6 | Windows 实机、真实主/子会话 | **PENDING → C/D** |

---

## 8. 变更请求裁决（CR）

### CR-C-1（C 提出，阻断级）— **裁决：已解决**

- **C 的问题**：计划书 §3 要求 T0 先冻结 `docs/design/task-notification-contract.md`；
  该文件在 `4f6e04b` 上不存在，C 无法"消费 A 冻结后的 normalized event"。
- **A 的裁决**：CR-C-1 成立且**已由本文件关闭**。本文即该 T0 契约。
  C 的 `task-notification-sender-contract-c.md` 与本文**无实质冲突**：
  - `NotificationMessage` 字段（`key`/`source`/`sessionId`/`title`/`message`/`silent`）**一致**；
  - `SendResult` 三值**一致**；
  - Tag = sha256(key) 前 16 位小写 hex、Group = `dsh-task`**一致**；
  - 退出码语义（任务脚本 0=提交成功，非审批语义）**一致**。
- **差异（以本文为准）**：`NotificationSender.send` 的 `signal` 在本契约中是**必填**
  （§4.1 AbortSignal 归属裁决）；C 草案写作可选 `signal?`。C 按本文改为必填。

### CR-C-2（C 提出，信息级）— **裁决：接受**

- `close()` 杀死活动发送进程的职责划分：**C 的实现**是 sender 接受 `AbortSignal`，
  收到 abort 即 `kill()` 并结算 `'aborted'`；**B 的 `close()`** 负责 abort 所有在飞 signal。
  与本契约 §4.1 一致。

---

## 9. PASS / PENDING 汇总

| 项 | 结论 |
|---|---|
| 基线 tag/commit/tree 与拓扑 resolve | **PASS**（§1） |
| 0.1.7-rc.2 与 fixture 版本一致性 | **PASS**（§2.1） |
| `session/event` 签名、emit 语义、scope、seed 不发布 | **PASS**（§2.2） |
| `turn/end` / `step/start` / 7 个 `TurnEndReason` kind | **PASS**（§2.3） |
| `header.origin === 'subagent'` 主/子判据 + 其他字段否决 | **PASS**（§2.4） |
| `session/title` 公开 `title: string` 与读取顺序 | **PASS**（§2.5） |
| 审批请求 → Session 解析（`ctx.agents.get`）与安全转交 | **PASS**（§2.6） |
| 子代理词汇（本轮仅用于"确认零通知"） | **PASS**（§2.7） |
| 跨模块冻结接口 | **PASS**（§4） |
| B/C/D 实现与单测 | **PENDING** |
| 精确宿主集成测试（含 fixture 扩展） | **PENDING** |
| Windows 实机（主完成/错误/审批共存、子代理零通知） | **PENDING** |
| 候选包 SHA / 逐字节核验 | **PENDING** |
| README/CHANGELOG 与升级回滚 | **PENDING** |

> 本表是 **T0 冻结时**的状态，**不是发布就绪状态**。后续执行结果以 A 的 T4 整合证据为准。

---

## 10. 给 B/C/D 的开工说明

1. **共同基线**：从 tag commit `4f6e04b2fb2fcbf261cbb052ffb0e543814cd0de` 建 worktree
   （A 已为三人建好，见 §1.2）。**不要**从 `main` 建树。
2. **本文 §4 签名冻结**；§3 行为冻结；§6 文件所有权不得越界。
3. **需要接口变化**：提交 CR + 测试给 A，**不得**直接改对方文件。
4. **测试不得启动真实 Windows 通知**；单测一律 mock spawn。
5. **上一轮残留**（§1.3）可作参考，但必须按本契约独立核对；
   B 必须修复 §7 的 `NF-35b` 失败用例。
6. 交付时给出：分支 + 完整 commit、修改文件、**实际执行命令与 PASS/FAIL/SKIP 计数**、
   未测项目、给 A 的最小接线例子。
