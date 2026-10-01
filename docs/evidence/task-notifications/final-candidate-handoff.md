# 0.4.0-rc.1 最终候选交接（Agent A）

日期：2026-10-01。派发：`D:\codex\dsh-notification-final-execution-and-handoffs.md` 第一步。
**本轮不 merge PR、不打 tag、不发布、不升级生产。**

> **转述给 B/C/D 只需要三样**：本文件绝对路径
> `D:\codex\dsh-notify-A\docs\evidence\task-notifications\final-candidate-handoff.md`
> + source 完整 commit `45d5ea2ae4221629cbff6264454198466fdb4d72`
> + 新包完整 SHA256 `FAA48D6EDFA721EE2E923208B06CB1A0CEB080773D8CA2F418E3DED928565EC8`

---

## 1. source commit / HEAD / 差异 / 工作区

| 项 | 值 |
|---|---|
| **运行时/入包 source commit** | `45d5ea2ae4221629cbff6264454198466fdb4d72` |
| 当前 HEAD | `45d5ea2ae4221629cbff6264454198466fdb4d72`（= source；其后无文档提交） |
| 分支 | `adapt/dsh-018-notify-a`（本地 = 远端，远端 HEAD 已核实同值） |
| 工作区 | **干净**（`git status --porcelain` = 0 条） |
| 运行时/入包文件差异 | **无** —— HEAD 即入包 source，`git diff` 无未提交改动 |

### 1.1 修复与 4 测试 commit

| commit | 内容 |
|---|---|
| `45d5ea2ae4221629cbff6264454198466fdb4d72` | **C 撰写、A 复核后提交**：`scripts/approval-toast.ps1` 生产前置校验专用 try/catch（exit 4 而非 1）+ `test/integration/approval-pair-rule.test.js` 新增 **L-B' 生产路径层 4 例**（Bp-1..4） |

**修复要点**（A 复核确认）：R7 的前置校验 `Test-ApprovalPairRule` 位于**生产 `try` 块之外**，
其 `throw` 会以 PowerShell 默认 **exit 1** 终止——本插件契约里 exit 1 = "用户点了拒绝"，
会把"调用方传了非法参数"**谎报成人类决策并写入审计为 rejected**。
C 的修复：前置校验包**专用 try/catch**，失败写 `CARD INVALID` 诊断（复用既有 `Format-Exception`）并 **exit 4**
（渠道不可用），与 `-ValidateOnly` 路径一致。**位置未后移**：仍在 `New-Item(StateDir)` /
`Register-UriScheme` / `Ensure-AppId` / 状态文件 / 陈旧通知清扫 / `Show()` 之前。

**A 复核后补记**：commit 时实测 BOM=True、CRLF=656、裸 LF=0、PS5.1 解析 0 错误。

---

## 2. 唯一候选

| 项 | 值 |
|---|---|
| **绝对路径** | `D:\codex\dsh-notify-A-pack\r8a\dsh-approval-center-0.4.0-rc.1.tgz` |
| **完整 SHA256** | `FAA48D6EDFA721EE2E923208B06CB1A0CEB080773D8CA2F418E3DED928565EC8` |
| bytes | **89108** |
| version | `0.4.0-rc.1` |
| 精确 peer | `@deepseek-ai/dsh: 0.1.7-rc.2` |
| 运行时依赖 | 仅 `schemastery ^3.18.0` |
| 可复现 | `r8a`/`r8b` 两次独立干净检出**逐字节相同**；源码→tgz **0 处不一致** |

### 旧包 superseded 表（历史保留，不覆盖、不删除）

| 轮 | 路径（相对 `D:\codex\dsh-notify-A-pack\`） | SHA256（前 16） | 大小 | 状态 |
|---|---|---|---|---|
| R1 | `.\dsh-approval-center-0.4.0-rc.1.tgz`（**上层**） | `F7C6E74E887A32D6` | 77254 | superseded |
| R2 | `repro1\` / `repro2\` / `sha-stability\` | `98F6CBE873DCCE89` | 78493 | superseded |
| R3 | `r3a\`–`r3d\`、`r4verify\` | `CC9163564185347E` | 81918 | superseded |
| R4 | `r4a\` / `r4b\` | `C6C7C84E68489EE6` | 82467 | superseded（旧布局） |
| R5 | `r5a\`–`r5d\` | `0358FC7FB529870F` | 86436 | superseded（旧布局/无前置门） |
| R6 | `r6a\` / `r6b\` | `FCB0C6A6E5EA42B5` | 88356 | superseded（生产前置会 exit 1） |
| R7 | `r7a\` / `r7b\` | `AF736E54C6CAA20E` | 88857 | **superseded（前置 throw 逃逸为 exit 1；不可用于实机签收）** |
| **R8** | **`r8a\` / `r8b\`** | **`FAA48D6EDFA721EE`** | **89108** | **唯一有效候选** |

---

## 3. 测试计数与 CI

| 命令 | 本地 | 干净 checkout（`r8a`） | 远端 CI |
|---|---|---|---|
| `typecheck` / `build` | exit 0 | exit 0 | exit 0 |
| `test:unit` | **281/281**（0 fail 0 skip） | 281/281 | **281/281** |
| `test:integration` | **111/111**（0 fail 0 skip） | 111/111 | **111/111** |
| **CI run URL** | | | <https://github.com/xmwpoi/dsh-approval-center/actions/runs/36842225310> |

> 集成 111 = 原 107 + **C 的 4 条生产测试**。派发书预期 "107+4=111" **恰好吻合**（仅作核对参考）。

### 3.1 4 条生产测试已纳入清单（`test:integration` 内显式文件）

`test/integration/approval-pair-rule.test.js`（共 23 例 = D 19 + **C 4**）：

| 例 | 断言 |
|---|---|
| **Bp-1** 只提供 decision | **exit 4（非 rejected=1）** + 零注册（HKCU 逐字未变）+ 零状态文件（幽灵 StateDir 未创建） |
| **Bp-2** 只提供 context | 同上 |
| **Bp-3** 显式空串对 | 同上 |
| **Bp-4** 显式空白对 | 同上 |

> 这 4 例**必须**走生产路径（不加 `-ValidateOnly`）——ValidateOnly 在脚本 L483 exit，
> **走不到** L512 的生产前置与 L511/517/519 的副作用。只用 ValidateOnly 的用例
> **无法发现**"生产前置 throw 未捕获 → exit 1"这一缺陷。零副作用以三种独立方式证明，
> **不以 finally 净清理代替"没有副作用"**。

---

## 4. 新包两支探针（**对 tgz 解包后的真实脚本**，非 A 树）

### 4.1 探针 1：参数门 9 例（ValidateOnly，结构）

**结果 9/9 PASS**：

| 例 | exit | 路径 |
|---|---|---|
| V-both-absent | 0 | LEGACY（1 `<text>`） |
| V-both-valid | 0 | **STRUCT（3 `<text>`）** |
| V-one-sided d / c | **4** ×2 | fail-loud |
| V-empty pair | **4** | fail-loud |
| V-blank dec / ctx / pair | **4** ×3 | fail-loud |
| V-missing pair（缺省） | 0 | LEGACY |

### 4.2 探针 2：生产非法输入 4 例（**不加 ValidateOnly**，真实投递路径）

**结果 4/4 PASS**：

| 例 | exit | 证据 |
|---|---|---|
| P-one-sided d | **4** | 零投递 |
| P-one-sided c | **4** | 零投递 |
| P-empty pair | **4** | 零投递 |
| P-blank pair | **4** | 零投递 |

前置 catch 后**零投递、零状态目录、注册不变**；exit 4 而非 1。
生产探针**没有**用 ValidateOnly 代替。

### 4.3 复现命令与日志

- 探针脚本形态：Node `spawnSync(ps51, [ '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',<packaged script>, ...args ])`
  —— **参数数组形态**（生产实际形态）。
- ⚠ **已知测量伪影**：用 PowerShell 交互式 runner 传 `-Param ''` 后跟另一 `-Param` 会破坏 PS5.1 绑定，
  产生 **exit 1 假读数**。B/C/D 复核时请用 Node 数组形态或 `-Param:$value` 绑定形式，
  不要据交互式 runner 的 exit 1 下结论。
- 打包解包目录（含探针用的解包脚本）：`D:\codex\dsh-notify-A-pack\r8a\unpack\package\`
- 源码→tgz 一致性：9 个入包文件 SHA256 **0 处不一致**；`approval-toast.ps1` 包内
  `5955C74D9606EF6F…` = A 树同值。
- 字节门：`approval-toast.ps1` BOM+CRLF、裸 LF 0；`toast.ps1` BOM+CRLF、裸 LF 0；PS5.1 0 语法错误。

---

## 5. B/C/D 调用入口与 D 人工 runner

### 5.1 B（输入门与退出码）

- 独立 checkout 到 `45d5ea2`；用 **`r8a` 包解包脚本**复跑 F1–F3 + 空白/空对/半对/非字符串。
- Node：非法 → `unavailable` 零 spawn；PS 生产入口：**exit 4 非 exit 1**；ValidateOnly 与生产一致。
- 维护/legacy/成对合法路径保持原语义；D1–D4、AD33、既有守护保留。
- 交付：`D:\codex\dsh-notify-B-r2\docs\evidence\task-notifications\final-wiring-signoff.md`
  （如用别的 B 树，填实际绝对路径并把同名文档交 A 归档）。

### 5.2 C（实机，门槛见派发书 §75）

- 入口 = **`r8a` 包**；先实算 SHA 并跑**两支探针**（9 + 4），再按 M1–M10。
- 交付：`D:\codex\dsh-notify-C\docs\evidence\task-notifications\final-windows-results.md`
  （实际 worktree 可不同，填实际完整路径并交 A 归档）。

### 5.3 D（包、CI 与实机入口）

- 交付：`D:\codex\dsh-notify-D\docs\evidence\task-notifications\final-package-and-evidence-signoff.md`。
- **人工 runner**：`test/integration/agent-loop.test.js` + `test/integration/helpers/deterministic-loop.mjs`
  （R6 已 cherry-pick 入树，source `45d5ea2` 可直接用）。
  ⚠ 确认默认**不投递**、**双 opt-in 才真实 sender**、无 mock channel/假 exit——由 D 复核后给 C 最短运行命令。
- 生产时序测试须覆盖**前置专用 try/catch**（不是任意第一个 try）；校验"状态目录未创建、注册无变"，
  **不以 finally 净清理代替没有副作用**。

---

## 6. 剩余 PENDING 与禁止发布状态

| # | 项 |
|---|---|
| 1 | B/D 对 `45d5ea2` + `FAA48D6E…` 的正式签收（未交） |
| 2 | C 的实机 M1–M10 + 两支探针 + 截图（未交）；真实 child 委派未装配 **PENDING** |
| 3 | 生产模型体验未测，**不外推** |
| 4 | 100/125/150% 缩放按实际授权；未获准档位不改并 PENDING |
| 5 | **发布状态：仍阻断**——须 B/D/C 三份文档齐备且 D 审 C 证据后，才由用户决定是否 merge PR #3 / 打 `0.4.0-rc.1` tag / 发布 |

**PR #3**：<https://github.com/xmwpoi/dsh-approval-center/pull/3>（draft，未合并）。
