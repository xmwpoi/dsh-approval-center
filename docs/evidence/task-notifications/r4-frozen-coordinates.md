# R4 冻结坐标与候选清单（Agent A）

日期：2026-10-01（Asia/Shanghai）。派发：`D:\codex\dsh-notification-round4-final-signoff.md`。
**本轮只准备，不合并 PR、不打 tag、不发布、不升级生产。**

> ⚠ **修订（R4 第 2 版）**：C 在静态验收中发现 **2 个真实缺陷**（R4C-D1 / R4C-D2），
> A 已修复。因**运行时代码与脚本变更**，候选包**必须重打**：
> **旧 `CC916356…`（81918）已 superseded，新候选为 `C6C7C84E…`（82467）**。见 §1.3。

---

## 1. 统一坐标（B/C/D 一律引用本表）

| 项 | 值 |
|---|---|
| 功能/修复共同签收基线（历史） | `c90a1a50cbadf75d5560a305988388da95fac023` |
| **A 当前 HEAD（含缺陷修复）** | `5dfe9378a35772dc03be5ac576f419dc108e1cb7` |
| 分支 | `adapt/dsh-018-notify-a`（本地 = 远端） |
| Draft PR | <https://github.com/xmwpoi/dsh-approval-center/pull/3>（**draft，未合并**） |
| 远端 CI（HEAD `5dfe937`） | run [36750463844](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36750463844) **success**（`check` ✅ / `integration` ✅，0 fail 0 skip） |
| 首轮失败（历史归档，不删除） | run [36745467011](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745467011) `717044a` |

### 1.1 唯一候选包（**第 2 版**）

> **唯一有效候选路径：**
> `D:\codex\dsh-notify-A-pack\r4a\dsh-approval-center-0.4.0-rc.1.tgz`

| 项 | 值 |
|---|---|
| **完整 SHA256** | `C6C7C84E68489EE694EB52440F24D8EAEA3427D360541C0C6961A8EC18394E17` |
| 大小 | **82467 bytes** |
| 对应 source commit | `5dfe9378a35772dc03be5ac576f419dc108e1cb7` |
| 版本 / peer / 依赖 | `0.4.0-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2` / 仅 `schemastery ^3.18.0` |
| 可复现 | 两次独立干净检出（`r4a`、`r4b`）**逐字节相同** |
| 源码→tgz | 12 个入包文件 SHA256 **0 处不一致** |

### 1.2 包目录中同名文件的历史留存（**不重命名、不覆盖、不删除**）

`D:\codex\dsh-notify-A-pack` 下**存在多个同名 `dsh-approval-center-0.4.0-rc.1.tgz`**，
分属不同轮次。**必须按完整路径引用，不得只写文件名**：

| 路径 | 大小 | SHA256（前 16） | 状态 |
|---|---|---|---|
| `…\dsh-notify-A-pack\dsh-approval-center-0.4.0-rc.1.tgz`（**上层**） | 77254 | `F7C6E74E887A32D6` | **superseded**（R1） |
| `…\repro1\`、`…\repro2\`、`…\sha-stability\` | 78493 | `98F6CBE873DCCE89` | **superseded**（R2） |
| `…\r3a\`、`…\r3b\`、`…\r3c\`、`…\r3d\`、`…\r4verify\` | 81918 | `CC9163564185347E` | **superseded**（R3；无 R4 缺陷修复） |
| **`…\r4a\`**、`…\r4b\` | **82467** | **`C6C7C84E68489EE6`** | **当前唯一有效候选** |

**上层那个 `F7C6E74E…` 是 R1 旧包**：**不是**当前候选，但**保持原样保留**（历史包不删除、不重命名）。
C 的实机验收必须用 `…\r4a\…`。

### 1.3 候选沿革（为什么必须重打）

| 候选 | SHA256 | 大小 | 状态 |
|---|---|---|---|
| R1 | `F7C6E74E…` | 77254 | superseded |
| R2 | `98F6CBE873DCCE89…` | 78493 | superseded |
| R3 | `CC9163564185347E…` | 81918 | **superseded**：R4 修了 2 个真实缺陷，**运行时代码与脚本已变** |
| **R4** | **`C6C7C84E68489EE6…`** | **82467** | **当前唯一有效候选** |

---

## 2. A 在 R4 所做的改动

### 2.1 合入 D 的 4 个独特断言（纯测试）

R4 §2 要求"保持运行时代码和 scripts 冻结，不重复 cherry-pick B/C 旧补丁或 merge C-verify"。
A **未** cherry-pick 任何 B/C 旧补丁，**未** merge C-verify。

D 在 `r4-independent-signoff.md` §2 用**断言语义**逐条核对（并自我更正了首次"前缀匹配"假差异），
结论为 **D 独有 4 例**。A **独立复核并确认**：

| 文件 | A（R3） | D（`d385703`） | D 独有 |
|---|---|---|---|
| `test/integration/session-title.test.js` | 7 | 9 | `T-1b`（审批与完成**共用缓存**）、`T-1c`（`showTitle=false` 对**两者同时**生效） |
| `test/integration/agent-registry.test.js` | 7 | 9 | `R-8`（缺失服务**依语境**：root 返回 `undefined` vs plugin-fiber 内**抛**）、`R-9`（**调用层区分**：真实 `ApprovalService` 对 id-only **宿主层先抛**） |

A 实测 grep：`T-1b`/`T-1c`/`R-8`/`R-9` 在 A 树中均为 **0**，在 D 中分别为 2/1/2/2 —— 与 D 一致。

**合入方式**：**整文件采纳 D 的版本**（D 拥有这两个文件，契约 §6）。
**关键**：D 的 `T-1` 仍断言"冷 seed 标题**不得**被读取 → 回退短 ID（拒绝 `snapshotEvents` 冷读）"，
**保留**了 R3 的标题裁决。

**D 的覆盖差异复核（R4-D 独立完成）**：`task-notifications.test.js` A=28 例、D=23 例，
规范化标题比对 **matched=23、D-only=0、A-only=5** ⇒ **A 版是严格超集，无遗漏的 D 断言**。

### 2.2 修复 C 发现的 2 个真实缺陷（运行时代码 + 脚本）

#### R4C-D1 — `scripts/toast.ps1` 双端校验在**大小写维度**失效

PowerShell 的 `-notmatch` / `-ne` **默认大小写不敏感**，而 Node 侧白名单是
`/^[0-9a-f]{16}$/`（只收小写）与字面量 `'dsh-task'`。A **独立复现**：

```
'AABBCCDDEEFF0011' -notmatch  '^[0-9a-f]{16}$'  -> False  （被脚本接受）
'AABBCCDDEEFF0011' -cnotmatch '^[0-9a-f]{16}$'  -> True   （被拒绝）
node /^[0-9a-f]{16}$/.test('AABBCCDDEEFF0011')  -> false  （Node 拒绝）
```

⇒ 大写 Tag **通过脚本校验**却被 Node 拒绝，"双端校验"（T0 §4.4）在大小写维度失效，
**大写 Tag 会真的投递出去**。C 的实测（`V3` 用例 exit 0 并穿透到 `Show()`）正是此缺陷的活证据。

**修复**：`-cnotmatch` / `-cne`（区分大小写）。C 的原始 repro 现为回归测试：
大写 Tag / 混合大小写 Tag / 大写 Group 均 exit 1，合法小写仍 exit 0。

#### R4C-D2 — `src/dialog.ts` 类型守卫晚于哈希调用

`taskNotificationTag(message.key)` 在 key 类型守卫**之前**调用；非字符串 key 会让
`createHash.update()` 抛 `TypeError`，该异常**逃出** `send()` 的 promise（reject），
而不是按冻结契约结算成 `'failed'`（契约 §4.1 只允许 resolve 三值）。

**可达性如实说明**：经正常接线**不可达**（B 的 `observe()` 已守卫 `sessionId`，key 恒为
`` `${sessionId}:${turn}` ``），故属**契约健壮性缺陷，非当前阻断**。

**修复**：把 typeof/length 守卫移到哈希调用之前。
**实测**：`key=undefined/null/123/{}/[]` 现全部 resolve `'failed'`，无 rejection、无 spawn。

#### R4C-O1（记录，不判 FAIL）

审批脚本强制截断分支会丢掉"选择："行。**当前接线不可达**（A 用 `normalizeInline` 把 reason 折成单行）。
C 的裁决与 A 一致：记为**已知边界**，不修改。

### 2.3 计数变化（实测）

| 命令 | R3 | R4（合入 D 4 例） | R4 第 2 版（+5 缺陷回归） |
|---|---|---|---|
| `test:unit` | 250/250 | 250/250 | **255/255** |
| `test:integration` | 75/75 | **79/79** | **79/79** |

**远端 CI 独立复核**（run 36750463844，HEAD `5dfe937`）：unit **255/255**、integration **79/79**，
**0 fail / 0 skip**。这是与本地独立的一次核对，非转录。

### 2.4 运行时冻结性（R4 第 2 版已解除，如实记录）

第 1 版（`d3ab3a8`）曾证明"运行时冻结、测试增补不改包"。第 2 版**刻意打破**该冻结以修真实缺陷：
`src/dialog.ts` 与 `scripts/toast.ps1` 均已变更，**故包 SHA 必然改变**（81918 → 82467）。
`package.json` 的 `files[]` 仍不含 `test/`，故测试增补本身不影响 tgz。

---

## 3. B 的 CR 关闭状态（R4 §2 要求 A 确认）

| CR | 内容 | 状态 |
|---|---|---|
| CR-B3 | `blocked` / `max-tokens` 的**标题与正文**写入契约 | ✅ **已闭**：契约 §3.2 已列出三者独立标题与正文，并写明互不混称 |
| CR-B4 | NF-35b 表述与"原失败作为历史" | ✅ **已闭**：契约 §7 标为"已关闭（R2）"，历史记录保留不删除 |

⇒ **不再要求用户对已明确需求再次拍板。**

### 3.1 NS35–38 → AD 映射（采纳 B 的最终版本，覆盖 A 的旧猜测）

A 在 R2 交接中**猜测**的映射为 `NS35→AD-30 / NS36→AD-13 / NS37→AD-31 / NS38→AD-32`。
B 在 R4 给出**逐条准确**版本，且为**用例作者**，故**以 B 为准**：

| 旧（R1） | 缺陷 | 新（R2/R4 `AD-*`） | 性质 |
|---|---|---|---|
| NS-35 未知 kind / 缺 sessionId 一律静默 | D1 + D2 | **AD-30**（未知 kind）+ **AD-31**（缺/非法 sessionId） | **增强**（AD-30 用 `assertNull` 同时校验 `value === null && typeof value === 'object'`，`undefined` 必红） |
| NS-36 缺 sessionId 不污染轮次表 | D2 | **AD-31**（含 `turnStateCount === 0`） | 等价（并入，减少重复） |
| NS-37 close 后看门狗先到点 | 计时器泄漏 | **AD-12** | **增强**（sender 无视 abort + `closeTimeoutMs` 有界收敛 + `pendingTimers === 0`） |
| NS-38 sender 返回契约外值 | D3 | **AD-13** | **增强**（另断言告警文案与不重试） |

**结论：4 条守护无一丢失**，全部以等价或更强形式存在并通过。

**B 的变异测试实证（A 独立复核其结论）**：B 在 scratch checkout 中把四处修复逐一改回坏形态，
对应用例立即变红（M1→AD-30、M2→AD-31、M3→AD-13、M4→AD-32，各 `fail=1`），
随后按 SHA256 逐字节还原。⇒ **守护不是装饰性断言**。

**A 的独立复核**：`git diff 3036ebd c90a1a5 -- src/notifications.ts test/notifications.adversarial.test.js`
= **空**（B 的工作被**原样吸收**）；AD 用例 = **恰好 32**；D1–D4 四处修复在 `c90a1a5` 均在位
（`default→null` 1 处、sessionId 守卫 1 处、`rawResult` 归一 1 处、`key=` 明文泄漏 **0** 处、
`tag=` 哈希告警 4 处）。

---

## 4. CI flake 的严重度裁决（R4 §24/§46）

D 独立审查了 A 的 `cleanupSandbox` 修复，并构造**红例**实测；A 采纳其裁决：

- **修复范围**：确实**只放宽临时目录删除**（`EPERM`/`EACCES`/`EBUSY`/`ENOTEMPTY` 退避重试，
  最终失败只 `console.warn` 不抛）；**其他错误码仍原样抛出**；断言/spawn/成功判据**未改动**。
- **成立的部分**：`dialog.unicode-mapping` 的成功判据确实**不含**处理器终止；`kill()` 后未 await `close`/`exit`。
- **实测反驳的部分**：win32 上 `child.kill()` 是**强制终止**（`TerminateProcess` 语义，
  忽略 SIGTERM 的替身同样被杀），kill 前存活、kill 后立即消失；D 另采样 `Get-Process wscript`，
  运行期间与结束后**均无残留**。
- **A 的结论**：这是**"未等待终止"的时序缺口**，**不是**"清理告警掩盖了真实泄漏"。
  按派发书 §24"不能因建议就无限扩大修改"，A **不扩大修改**；
  D 建议的"有界等待 close + 一条红例"记为**非阻断的后续项**。
  判据记录：**以 kill 后进程是否仍存活判泄漏，不以 close 是否到达判泄漏。**

---

## 5. 通知历史基线（实机前必须核对）

A 在验证 R4C-D1 修复时，探针跑到了**合法小写 Tag** 路径，**真实投递了 1 条通知**
（tag=`aabbccddeeff0011`，group=`dsh-task`）。已用**三参 `Remove` 只删该条**，
并复核基线未变：

| 项 | 值 |
|---|---|
| TOTAL | **13** |
| `dsh-task` | 2 |
| `dsh-result` | 11 |
| `dsh-approval` | 0 |

**与 C 记录的基线完全一致**（C 亦曾因同类用例设计失误投递 1 条并同样定向清理）。
**双方均未使用 `History.Clear` / `RemoveGroup`，无净变化。**
AUMID `Dev.DSH.ApprovalCenter`（DisplayName「DSH 审批中控台」）与 URI `dshapproval` 未改。

---

## 6. 待收齐的签收（A 不代签）

| 签收方 | 交付 | 状态 |
|---|---|---|
| B | `r4-state-machine-signoff.md` | ✅ 已交付，A 已独立复核其关键主张（含变异测试） |
| D | `r4-independent-signoff.md`、`r4-package-signoff.md`、`r4-d-unique-assertions.md`、`r4-ci-and-package-refresh.md` | ✅ 已交付；D 独立核了 CI 与包可复现性 |
| C | `r4-windows-results.md` | ⏳ **PENDING**：用户已授权新独占窗口；C 需在**新包 `C6C7C84E…`** 上完成并绑定该 SHA |

**任何真实主/子会话 PENDING 不得写成"全面实机完成"。**

