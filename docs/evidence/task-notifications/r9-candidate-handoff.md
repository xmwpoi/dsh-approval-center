# R9 候选交接（Agent A）

日期：2026-10-01。派发：`D:\codex\r9-approval-layout\TASK-agent-a.md`。
**本轮不 merge PR、不打 tag、不发布、不升级生产。**

> **转述给 B/C/D 的三样**：
> source 完整 commit **`647258c01ee00758f3cc4cd74ead84833fb570bb`**
> + 新包完整 SHA256 **`AF92B03B0EFA605B5B03C629933DE5A082C3944C24D21F8E7D7B68D5B1B440BE`**
> + 本文件绝对路径 `D:\codex\dsh-notify-A\docs\evidence\task-notifications\r9-candidate-handoff.md`

---

## 1. source / HEAD / 工作区

| 项 | 值 |
|---|---|
| **source（入包）commit** | `647258c01ee00758f3cc4cd74ead84833fb570bb` |
| 当前 HEAD | 同上（= source，其后无文档提交） |
| 分支 | `adapt/dsh-018-notify-a`（本地 = 远端） |
| 工作区 | **干净** |
| 首次修改前记录 | HEAD `eb4a16a5fabb4a11362fd37f30b4380f8fd254e4`（树干净，未丢弃任何改动） |

### 1.1 修复与测试 commits

| commit | 内容 |
|---|---|
| `71912abfb5f3907938cfe45a6a15d5fc3dd1db11` | **R9 布局修复**：decision 作为标题第二行（复用 legacy 吸收先例）+ 吸收 D 的 6 例预算验收测试 + 契约 §3.4 更新 |
| `647258c01ee00758f3cc4cd74ead84833fb570bb` | **编码修复**：`-ValidateOnly` 诊断强制 UTF-8 输出（首轮 CI FAIL 的根因） |

---

## 2. 修了什么（两项同源阻断，一次修复 + 一次编码修复）

### 2.1 布局/摘要提示（D §12.1/§12.2 的 FAIL）

**根因（修复前机械复现）**：结构化分支给 decision 与 context 各一个 `<text>`，
描述行 = 1 + 4 = **5 > 4**（ToastGeneric 文档化上限），Windows 静默裁掉末尾——
恰是契约要求可见的"（摘要，详情见 DSH）"截断提示。legacy 路径一直有标题富余行吸收；
结构化路径漏用了同一逻辑。**不是 Windows 的锅，也不是 formatter 的锅。**

**修复（最小改动，复用脚本自有预算先例）**：

| `<text>` 节点 | 内容 | 行预算 |
|---|---|---|
| **#1（标题元素）** | `title` + `\n` + `decisionSummary` | **2/2** 恰好用满 |
| **#2（描述元素）** | `contextSummary`（任务/操作/原因/摘要提示） | **≤4/4** |

- 摘要提示**永远在描述预算内** ⇒ 用户可见（像素层仍待 C 实机证明，不预签）。
- 安全语义不变：decision 仍排最前（title 后、动态摘要前）、逐字完整、不参与截断。
- context 仍由 Node 侧独立限宽（20/20/36 码点）。协议/退出码/URI/token 全部未动。
- **旧 5 行卡片（`approval-card-layout.test.js` 的 legacy 用例）不受影响**。

### 2.2 `-ValidateOnly` 诊断的编码漂移（首轮 CI FAIL，本机绿/CI 红）

**根因**：PS 5.1 把重定向 stdout 按**控制台代码页**写——本机 936(GBK)、
windows-latest 是 437(US)。断言里的中文字面量（摘要提示）随环境漂移。
这不是布局缺陷，是**测试测量通道**的缺陷；不改就会让所有含 CJK 断言的测试随机器变红变绿。

**修复**：`-ValidateOnly` 块顶部设 `[Console]::OutputEncoding = UTF8`，
`TEXT>` 诊断在任何 locale 下字节稳定。**生产路径不受影响**（不打印 TEXT>，
设置只改本进程 stdout 编码，退出即逝）。

### 2.3 修复过程实录（含一次 CI 红灯）

1. 布局修复后本机 D 验收 **6/6 绿**（B-2/B-3 由红转绿——它们正是缺陷复现用例）。
2. 推送后**首轮 CI FAIL**（integration job：B-3/B-4/B-5 红，本机同用例绿）。
3. 归因为控制台代码页差异（见 2.2），修复后 CI **全绿**。
   **首轮失败记录**：run [36854580039](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36854580039)（保留不删）。

---

## 3. 唯一候选

| 项 | 值 |
|---|---|
| **绝对路径** | `D:\codex\dsh-notify-A-pack\r9c\dsh-approval-center-0.4.0-rc.1.tgz`（`r9d` 同，逐字节） |
| **完整 SHA256** | `AF92B03B0EFA605B5B03C629933DE5A082C3944C24D21F8E7D7B68D5B1B440BE` |
| bytes | **90088** |
| version / peer | `0.4.0-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2`（精确） |
| source | `647258c01ee00758f3cc4cd74ead84833fb570bb` |
| 可复现 | r9c/r9d 两次独立干净检出**逐字节相同**；源码→tgz **0 处不一致** |
| 字节门 | `approval-toast.ps1` BOM+CRLF 680/裸 LF 0；`toast.ps1` BOM+CRLF 121/裸 LF 0；PS5.1 0 语法错误 |
| 包内含修复 | `R9 布局修复`（L368）与 `OutputEncoding=UTF8`（L507）均在包内脚本 |

### superseded 表（历史保留，不覆盖）

| 轮 | SHA256（前 16） | 大小 | 状态 |
|---|---|---|---|
| R1–R3 | `F7C6E74E…` / `98F6CBE8…` / `CC916356…` | 77254/78493/81918 | superseded |
| R4 / R5 | `C6C7C84E…` / `0358FC7F…` | 82467/86436 | superseded（旧布局） |
| R6 / R7 | `FCB0C6A6…` / `AF736E54…` | 88356/88857 | superseded（生产前置 exit 1） |
| R8 | `FAA48D6E…` | 89108 | superseded（**布局/摘要提示 FAIL**，D §12.1/12.2） |
| **R9** | **`AF92B03B0EFA605B`** | **90088** | **唯一有效候选** |

---

## 4. 测试计数与 CI

| 命令 | 本地 | 干净 checkout（`r9c`） | 远端 CI |
|---|---|---|---|
| `typecheck` / `build` | exit 0 | exit 0 | exit 0 |
| `test:unit` | **281/281**（0 fail 0 skip） | 281/281 | **281/281** |
| `test:integration` | **117/117**（0 fail 0 skip） | 117/117 | **117/117** |
| **CI run** | | | [36855337789](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36855337789) **success**（head `647258c`） |

> 111 + 6（D 预算验收）= 117，与派发书"不预定相加、以同树为准"一致。

### 4.1 新增门禁（已入显式清单）

`test/integration/approval-card-line-budget.test.js`（**D 撰写，A 吸收**，6 例）：

| 例 | 断言 | 结果 |
|---|---|---|
| B-0 | legacy 基线 3 `<text>` 可用 | ✅ |
| B-1 | formatter 截断时确实产出摘要提示 | ✅ |
| **B-2** | 结构化描述行合计 **≤4**（曾红：实测 5） | ✅ **转绿** |
| **B-3** | 摘要提示落在**前 4 行**内（曾红：第 5 行） | ✅ **转绿** |
| B-4 | legacy 对照先例在预算内且提示可见 | ✅ |
| B-5 | 36 字边界在预算内（保留折行余量风险注记） | ✅ |

吸收时修正其 `REPO_ROOT` 三级上溯缺陷（D 的树更深，会落到仓库外）。

### 4.2 既有结构断言的同步更新（语义保留）

`approval-pair-rule.test.js` B-0：`恰 3 个 <text>` → **`恰 2 个 <text>`，且第一个 `<text>` 含
title+decision 两行**（ASCII 结构断言，避开控制台代码页对 CJK 的干扰）。
成对/类型/空白/零 spawn/exit 4/零副作用/维护入口/审计语义断言**全部未动**。

---

## 5. 复验命令

```powershell
# 候选可复现
git -C 'D:\codex\dsh-approval-center' worktree add --detach <dir> 647258c01ee00758f3cc4cd74ead84833fb570bb
cd <dir>; npm ci --ignore-scripts; npm run build; npm pack
Get-FileHash .\dsh-approval-center-0.4.0-rc.1.tgz -Algorithm SHA256
# 期望 AF92B03B0EFA605B5B03C629933DE5A082C3944C24D21F8E7D7B68D5B1B440BE（90088 B）

# 布局预算验收（对包内脚本，零投递/零副作用）
node --test test/integration/approval-card-line-budget.test.js   # 期望 6/6

# 结构化布局目检（-ValidateOnly，UTF-8 诊断；注意用参数数组，勿用交互式空参数引号）
# 期望：textNodes=2；TEXT#1 = title | decision；TEXT#2 = 任务|操作|原因|(摘要提示)
```

⚠ 复核 PS 探针请用 **Node spawn 参数数组**或 `-Param:$value` 绑定；交互式 `-Param ''` 会破坏
PS 5.1 绑定产生 exit 1 假读数（R8 已记录的测量伪影）。

---

## 6. B/C/D 入口与 runner

- **B**：对 `647258c` + `AF92B03B…` 复核 F1–F3、非法路径、exit 4 非 1、正常兼容回归。
- **C**：实机入口 = **`r9c` 包**。M1–M10（含 32/100/1000、长 task/tool、approve/reject、两态）；
  **固定 title 与 decision 逐字可见、摘要提示在实际截断时可见，否则 FAIL**。
  真实主 loop 用 D 的人工 runner（`test/integration/manual/r5-real-loop-runner.mjs`，
  双 opt-in 才真实投递；等待须在 `dispose()` **之前**——C 的三变体实验已证）。
- **D**：审新包 entry/hash/编码/CI；复核 B-2/B-3 转绿的依据；吸收 C 实机证据后在
  `final-package-and-evidence-signoff.md` 追加实机审阅章节。

---

## 7. PENDING 与禁止发布

| # | 项 |
|---|---|
| 1 | B/D 对 `647258c` + `AF92B03B…` 的并行签收 |
| 2 | C 实机（含 **M7 展开态**、缩放 125/150 需授权、真实 child 未装配 PENDING） |
| 3 | **像素层可见性未经实机证明**：逻辑行在预算内 ≠ 渲染行在预算内（折行余量，D B-5 注）；不预签 |
| 4 | 生产模型体验未测，不外推 |
| 5 | **发布仍阻断**：须 B/D 签收 + C 实机 + D 审证据后，由用户决定 |

**PR #3**：<https://github.com/xmwpoi/dsh-approval-center/pull/3>（draft，未合并）。
