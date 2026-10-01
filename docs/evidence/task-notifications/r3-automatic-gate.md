# R3 自动门证据（Agent A）

日期：2026-09-30。编制：Agent A。
共同基线 `222e38afaff6eb10245598776f4c34726a65700f`（R2 起点）→ **R3 冻结 commit `c90a1a50cbadf75d5560a305988388da95fac023`**。
派发：`D:\codex\dsh-notification-round3-agentA.md`（裁决见 `…-round3-dispatch.md`）。

> 本轮**不发布**：不合并、不打 tag、不发 0.4.0 Release。只收口候选。

---

## 1. 整合方式（cherry-pick，无重复应用）

R3 §2 要求"C 的提交二选一：cherry-pick 或从其 patch 审查应用，不能重复应用"。
A 对 B/C/D 三家统一采用 **cherry-pick**，并在操作前**逐文件核对了父提交与 A 树的一致性**，
以确认不会误覆盖：

| 交付 | commit | A 树 vs 其父提交（`~1`） | 结果 |
|---|---|---|---|
| B | `3036ebd` | `src/notifications.ts` **字节相同** | cherry-pick 干净应用 |
| C | `76ede49` | `scripts/approval-toast.ps1` 仅 EOL 不同（内容相同） | cherry-pick 干净应用 |
| D | `ff2a124` | `notification-host.mjs` **字节相同** | cherry-pick 应用；`user-guide-draft.md` 冲突（A 树无此文件，D 拥有）→ **取 D 版** |

**无重复应用**：三家各只应用一次，未再叠加"旧全套 sender 覆盖 A 实现"（R3 §2 明确禁止）。

**C 的取舍**：只取 **布局 + 9 个测试**（`scripts/approval-toast.ps1`、`test/approval-card-layout.test.js`），
**不**取旧全套 sender 覆盖 A 的实现。

---

## 2. 关闭的代码阻断（R3 §1）

B 的 4 处缺陷修复已在 A 树中逐项核验存在：

| # | 缺陷 | 修复 | 位置 |
|---|---|---|---|
| 1 | 未知 `observe` kind 隐式返回 `undefined`（`undefined !== null`，调用方会当成有效消息） | `default: return null` | `src/notifications.ts:555` |
| 2 | 非法 `sessionId` 会在 Map 建出 `undefined` 键、去重 key 变 `"undefined:3"` | 显式拒绝非字符串/空串 | `src/notifications.ts:514` |
| 3 | sender 返回契约外值时 `lastResult` 会携带词汇表外状态 | 归 `failed` 并告警 | `src/notifications.ts:639-654` |
| 4 | 队列溢出告警泄漏 key 明文（含 sessionId） | 改记 `notificationTag(key)` 哈希 | `src/notifications.ts:571` |

**32 个对抗用例**全部纳入 `test:unit`（`test/notifications.adversarial.test.js`）。

### 旧 NS35–38 → 新 AD 映射（R3 §1 要求）

B 的 R1 报告使用 `NS35`–`NS38` 编号，R2 交付改用 `AD-*` 编号。按 B 交付文档的对照说明：

| 旧编号（R1） | 新编号（R2 `AD-*`） | 对应缺陷 |
|---|---|---|
| NS35 | AD-30 | 未知 kind → `null`（缺陷 1） |
| NS36 | AD-13 | sender 契约外结果 → `failed`（缺陷 3） |
| NS37 | AD-31 | 非法 sessionId 拒绝（缺陷 2） |
| NS38 | AD-32 | 队列溢出告警去明文（缺陷 4） |

> 该映射取自 B 交付中的覆盖差异表。**若 B 认为映射有出入，请以 B 的复核为准**——A 不代签。

**与 A 已有修改的冲突**：无。A 在 `notifications.ts` 上的改动仅为 R1 整合时的接线，B 的父提交与 A 树字节相同，
语义无重叠，**防御未丢失**。

---

## 3. C 的布局交付（R3 §2）

| 项 | 实测 |
|---|---|
| `<text>` 节点数 | 由 `Build-ApprovalToastXml` 产出 **最多 3 个**（`$t1`/`$t2`/`$t3`），按 ToastGeneric 文档化预算拆分 |
| `-ValidateOnly` 入口 | 只构造并 `LoadXml` 校验，**不注册 URI、不写状态文件、不调用 `Show()`**；退出码 0=通过 / 4=失败（**不属审批退出码契约**） |
| 协议不变 | `scenario="reminder"`、`activationType="protocol"`、`arguments="$scheme:approve|reject/$(Escape-Xml $Id)"`、退出码 0/1/2/3/4、`requestToken` **全部未动** |
| 编码 | BOM=True、CRLF=538、裸 LF=**0**、32012 bytes |
| 测试 | `test/approval-card-layout.test.js`（9 例）已接入 `test:unit` |

> ⚠ **只写结构门通过**（R3 §2 明确要求）：`-ValidateOnly` 只证明 XML 结构合法、可被 `LoadXml` 接受、
> 文本节点数与转义正确。**行数预算 ≠ 实际像素高度**；中文长标题、显示缩放、系统截断
> **必须由 C 在独占实机窗口验证**。本轮**不预签**"零截断"。

---

## 4. D 的交付（R3 §3）

新增两个集成文件并接入 `test:integration`：

- `test/integration/agent-registry.test.js`（真实 AgentRegistry 输入）
- `test/integration/session-title.test.js`（标题读取/回退/清理）

`helpers/notification-host.mjs` 扩展为可注入真实 registry。

**不覆盖已合入的 28 例 task suite**：D 的提交只改 `notification-host.mjs` 与新增两个文件，
`task-notifications.test.js` 未被触碰。

**测试边界（如实标注）**：`agent-registry.test.js` 走真实 Cordis waterfall 派发 + 真实 registry 查询面，
但**不是 `ApprovalService` 完整端到端**——真实宿主的 `ApprovalService.request()` 要求 `agent.session`
才能判 open turn（`dsh-user-approval/lib/index.js:50` `hasOpenTurn`），
故 id-only 形态在真实宿主**不可达**，该文件覆盖的是**插件 adapter 的防御路径**。

### D 的 T-1/T-5 与 R3 裁决对齐

D 的 `session-title.test.js` 头部自述："API 选择（snapshotEvents 例外 vs 改走 sessionTitle 服务 vs 只做短 ID 回退）
属 **A 的契约修订**，D 不擅自定；本文件只固化**可观察行为**，两种实现下都应成立。"

R3 裁决（§13）选定**事件缓存 + 短 ID 回退、删除所有新 `snapshotEvents` 调用**后，
D 的 T-1（断言"冷读应取 seed 标题"）与 T-5（断言"淘汰后冷读重取"）与该裁决冲突，2 例失败。
**A 按裁决对齐这两例，保留 D 的原始意图（seed 标题不得泄漏、标题不得串位）**：

| 用例 | 原断言 | R3 对齐后 |
|---|---|---|
| T-1 | 冷读应取 seed 里的标题 | **seed 历史标题不得被冷读出来**；回退短 ID（已接受限制） |
| T-5 | 300 会话逐个断言自己的标题（依赖冷读重取） | 前 44 个（>256 容量被淘汰）**精确等于**短 ID 首行；其余精确等于自己的标题；用**首行精确相等**保证不串位 |

> T-5 首版 A 用子串包含判定，被 `容量标题100` 含 `容量标题1` 误判 —— 是**用例缺陷**，
> 改为首行精确相等后通过。该修正本身也说明精确判定才是"不串位"的正确判据。

---

## 5. 元数据与契约修正（R3 §4）

| 项 | 修前 | 修后 |
|---|---|---|
| `package-lock.json` 顶层 `version` | `0.3.1-rc.1` | **`0.4.0-rc.1`** |
| `package-lock.json` `packages[""].version` | `0.3.1-rc.1` | **`0.4.0-rc.1`** |
| 契约 §2.5 | 含"首次遇到会话用 `snapshotEvents()` 回读" | **重写**：删除冷读；事件缓存为唯一来源；引用宿主 deprecated 原文；写明"冷标题显示短 ID"是**已接受限制**；写明**审批与完成共用同一份缓存与隐私设置** |
| 契约 §3.2 | 只有 `error` 的标题+正文 | **补齐 `blocked` / `max-tokens` 的标题与正文**，并写明三者互不混称 |
| 契约 §7 NF-35b | "**待 B 修复**" | "**已关闭（R2）**"（历史记录保留在 R1 交接书，不删除） |
| `src/host-contract.ts` 顶部注释 | 描述两版差异/旧证据路径 | 重写为三类冻结事实 + 精确支持 0.1.7-rc.2 |
| `safeAgentLookup` 注释 | "服务未注入时会抛"（易读成恒抛） | 按实测校准：**条件性**抛出（未注入才抛；已注入正常返回），并给出 cordis 行号与 R2-D 的验证来源 |

`npm ci` 在修正后的 lock 上**实测通过**（`added 6 packages`），
版本/peer/依赖三项核对一致：`version=0.4.0-rc.1`、`peer=0.1.7-rc.2`、`deps={schemastery:^3.18.0}`。

---

## 6. 最终测试清单与计数（实测，不凑数）

**先合并实际文件，再跑一次最终套件**（R3 §末段要求），**未相加** 209/228/61/31。

| 命令 | 开发树 | 干净 checkout（`r3a`） |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| `npm run test:unit` | **250/250**，0 fail 0 skip | **250/250** |
| `npm run test:integration` | **75/75**，0 fail 0 skip | **75/75** |

### 单测 250 的文件构成（`test:unit` 清单顺序）

| 文件 | 归属 |
|---|---|
| `host-contract.test.js` | 既有 |
| `identity-adapter.test.js` | A（R2） |
| `queue.test.js` / `store.test.js` / `dialog.test.js` | 既有 |
| `dialog.scripts.test.js` / `dialog.cleanup.test.js` / `dialog.uri-handler.test.js` / `dialog.unicode-mapping.test.js` | 既有 |
| `notifications.test.js` / `notification-format.test.js` | B（R1） |
| `notifications.adversarial.test.js` | **B（R3 新增，32 例）** |
| `task-toast-sender.test.js` / `task-toast-script.test.js` | A 代 C |
| `approval-card-layout.test.js` | **C（R3 新增，9 例）** |

### 集成 75 的文件构成

| 文件 | 例数 |
|---|---|
| `approval-flow.test.js` | 既有（含 2 处刻意取代） |
| `lifecycle.test.js` | 既有 |
| `task-notifications.test.js` | 28（D 23 + A R2 新增 5） |
| `host-publication.test.js` | 12（D） |
| `agent-registry.test.js` | **D（R3 新增）** |
| `session-title.test.js` | **D（R3 新增，T-1/T-5 按裁决对齐）** |

### 含真实进程的既有用例（如实标注执行路径，不宣称纯 mock）

| 文件 | 真实行为 | 是否触及桌面 |
|---|---|---|
| `dialog.scripts.test.js` | 真实 `powershell.exe` 5.1 `Parser::ParseFile` | 否（只解析，不执行） |
| `dialog.uri-handler.test.js` | **真实 `wscript.exe` / `powershell.exe`** 执行 URI 处理器写结果文件 | 否（写临时目录，不弹通知、不改 HKCU） |
| `dialog.unicode-mapping.test.js` | 同上 + 真实中文/空格路径映射 | 否 |
| `task-toast-script.test.js` | 真实 PS5.1 解析 + 3 条参数校验路径（全部在 `try` 块**之前** exit） | 否（未执行 AUMID 注册与 `Show()`） |
| 其余 | 纯 mock / 内存实现 | 否 |

---

## 7. 远端 CI（R3 §7）

| 轮次 | run ID | 结果 |
|---|---|---|
| 首轮 | [36745467011](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745467011) | **FAIL** — `check` 在 `test:unit` 失败（249/250） |
| 修复后 | 见 §7.2 | 见下 |

### 7.1 首轮失败根因（**保留记录，不删除**）

```
✖ ISSUE-1/VBS: UTF-16 LE 映射 -> 中文+空格 StateDir 命中
  Error: EPERM, Permission denied: \\?\C:\Users\RUNNER~1\AppData\Local\Temp\dsh-t3-unicode-GeWxLU
      at rmSync (node:fs:1282:18)
      at TestContext.<anonymous> (test/dialog.unicode-mapping.test.js:127:5)
```

**这是既有基线用例的 runner-only flake，不是 R3 整合引入的回归**：

- 断言**已通过**（用例自身逻辑正常）；失败发生在 `finally` 的 `rmSync`。
- 该用例真的拉起 `wscript.exe`（GUI 子系统）写结果文件，同一 tick 内 `kill()`；
  windows-latest 上刚被杀进程仍持有临时目录句柄。
- `rmSync(..., { force: true })` 的 `force` 只忽略"不存在"，**不重试**占用错误。
- 本地（已装 DSH 的机器）**从未复现** —— 属真实的环境差异，非本地"侥幸通过"。

**修复**（commit `c90a1a5`）：`cleanupSandbox()` 对 `EPERM`/`EACCES`/`EBUSY`/`ENOTEMPTY`
做有界退避重试；**最终仍失败则不抛**（清理失败不得把已通过的断言改写成红灯），只留告警；
其他错误码照常抛出。临时目录交由 runner 回收。

### 7.2 修复后结果

| 轮次 | run | headSha | `check` | `integration` | 总结果 |
|---|---|---|---|---|---|
| 首轮 | [36745467011](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745467011) | `717044a` | ❌ | (未运行) | **failure** |
| 修复后 | [36745878868](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745878868) | `c90a1a5` | ✅ | ✅ | **success** |
| 证据文档后 | [36746343677](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36746343677) | `e90ece2` | ✅ | ✅ | **success** |

第三轮只新增 `docs/**`（已核验**未改任何入包文件**），因此候选包 SHA 不变；CI 仍全绿。

修复后 run 的各步骤全部通过，包括本轮新增的
`assert script encodings, CRLF line endings and PowerShell syntax`（R3 §6 的打包门）
与 `install exact DSH 0.1.7-rc.2 test fixture (mandatory)`。

- 远端 ref 与本地 HEAD 一致：`c90a1a50cbadf75d5560a305988388da95fac023`。
- Draft PR：<https://github.com/xmwpoi/dsh-approval-center/pull/3>（**draft，未合并、未打 tag**）。
- 网络首轮曾失败（R2 记录：`curl 55 Send failure` / 443 连不上）；R3 重试即成功，
  **未改变任何代理/系统网络/凭据配置**。

---

## 8. 未关闭项（不代签）

| 项 | 状态 |
|---|---|
| **C 的独占实机** | 未做。布局实际可读性（中文长标题/显示缩放/系统截断）、真实主/子会话、静音/声音、重载 → 需**新的独占静音窗口**。**不得用 98F6 旧包签收 layout**（R3 派发明确）。 |
| **B 的复核** | 收到 A 整合 commit 后核对 4 缺陷与守护覆盖是否保留。**A 不代签**。 |
| **D 的最终审查** | 源/包/测试独立审查 + C 证据范围审签。**A 不代签**。 |
| **真实主/子会话 PENDING** | 无真实会话凭据条件下**保留 PENDING**，不得包装成全矩阵 PASS。 |
| **Release workflow** | 保留 Draft，防误触（未改动 `.github/workflows/release.yml` 的触发条件）。 |
