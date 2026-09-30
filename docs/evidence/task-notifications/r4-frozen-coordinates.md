# R4 冻结坐标与候选清单（Agent A）

日期：2026-10-01（Asia/Shanghai）。派发：`D:\codex\dsh-notification-round4-final-signoff.md`。
**本轮只准备，不合并 PR、不打 tag、不发布、不升级生产。**

---

## 1. 统一坐标（B/C/D 一律引用本表）

| 项 | 值 |
|---|---|
| **功能/修复共同签收基线** | `c90a1a50cbadf75d5560a305988388da95fac023` |
| A 当前 HEAD（在其上**仅测试**增补） | `d3ab3a849f1dc3d1edf32fbc3e24e6602f117fb1` |
| 分支 | `adapt/dsh-018-notify-a`（本地 = 远端） |
| Draft PR | <https://github.com/xmwpoi/dsh-approval-center/pull/3>（**draft，未合并**） |
| 远端 CI（HEAD `d3ab3a8`） | run [36748762201](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36748762201) **success**（`check` ✅ / `integration` ✅，0 fail 0 skip） |
| 首轮失败（历史归档，不删除） | run [36745467011](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745467011) `717044a` |

### 1.1 唯一候选包

> **唯一有效候选路径：**
> `D:\codex\dsh-notify-A-pack\r3c\dsh-approval-center-0.4.0-rc.1.tgz`

| 项 | 值 |
|---|---|
| **完整 SHA256** | `CC9163564185347EFDDC44C5DC2BEBA24C9B5F80372780E3A2322308EB006B9B` |
| 大小 | **81918 bytes** |
| 对应 source commit | `c90a1a50cbadf75d5560a305988388da95fac023` |
| 版本 / peer / 依赖 | `0.4.0-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2` / 仅 `schemastery ^3.18.0` |

### 1.2 包目录中同名文件的历史留存（**不重命名、不覆盖、不删除**）

`D:\codex\dsh-notify-A-pack` 下**存在多个同名 `dsh-approval-center-0.4.0-rc.1.tgz`**，
分别属于不同轮次。**必须按完整路径引用，不得只写文件名**：

| 路径 | 大小 | SHA256（前 16） | 状态 |
|---|---|---|---|
| `…\dsh-notify-A-pack\dsh-approval-center-0.4.0-rc.1.tgz`（**上层**） | 77254 | `F7C6E74E887A32D6` | **superseded**（R1；LF 换行、无 D 套件、无冷读裁决、无脚本门） |
| `…\repro1\`、`…\repro2\`、`…\sha-stability\` | 78493 | `98F6CBE873DCCE89` | **superseded**（R2） |
| `…\r3a\`、`…\r3b\`、`…\r3c\`、`…\r3d\`、`…\r4verify\` | 81918 | `CC9163564185347E` | **R3/R4 同一内容**；**`r3c` 为签收路径** |

**上层那个 `F7C6E74E…` 是 R1 旧包**：它**不是**当前候选，但**保持原样保留**（历史包不删除、不重命名）。
C 的实机验收必须用 `…\r3c\…`，用上层文件会拿到 superseded 的旧包。

---

## 2. A 在 R4 所做的改动（仅测试，运行时冻结）

R4 §2 要求"保持运行时代码和 scripts 冻结，不重复 cherry-pick B/C 旧补丁或 merge C-verify"。
A 遵守：**未** cherry-pick 任何 B/C 旧补丁，**未** merge C-verify。

唯一改动：**合入 D 的 4 个独特断言**（`d385703`）。

### 2.1 文件级比较结论（D 的 9+9 vs A 已吸收的 7+7）

D 在 `r4-independent-signoff.md` §2 中用**断言语义**逐条核对（并自我更正了首次的"前缀匹配"假差异），
结论为 **D 独有 4 例**。A **独立复核并确认**：

| 文件 | A（R3） | D（`d385703`） | D 独有 |
|---|---|---|---|
| `test/integration/session-title.test.js` | 7 | 9 | `T-1b`（审批与完成**共用缓存**）、`T-1c`（`showTitle=false` 对**两者同时**生效） |
| `test/integration/agent-registry.test.js` | 7 | 9 | `R-8`（缺失服务**依语境**：root 返回 `undefined` vs plugin-fiber 内**抛**）、`R-9`（**调用层区分**：真实 `ApprovalService` 对 id-only **宿主层先抛**） |

A 实测 grep：`T-1b`/`T-1c`/`R-8`/`R-9` 在 A 树中均为 **0**，在 D 中分别为 2/1/2/2 —— 与 D 的结论一致。

**合入方式**：**整文件采纳 D 的版本**（D 拥有这两个文件，契约 §6），而非手工拼接。
**关键**：D 的 `T-1` 仍断言"冷 seed 标题**不得**被读取 → 回退短 ID（拒绝 `snapshotEvents` 冷读）"，
**保留**了 R3 的标题裁决，未回退为冷读。

### 2.2 计数变化（实测）

| 命令 | R3 | R4（合入后） |
|---|---|---|
| `test:unit` | 250/250 | **250/250**（未变） |
| `test:integration` | 75/75 | **79/79**（+4） |

**远端 CI 独立复核**（run 36748762201，HEAD `d3ab3a8`）：unit **250/250**、integration **79/79**，
**0 fail / 0 skip**。这是与本地独立的一次核对，非转录。

### 2.3 运行时确实冻结（实证）

```
git diff --stat c90a1a5 HEAD -- src scripts lib package.json package-lock.json cordis.patch.yml README.md CHANGELOG.md LICENSE
→ 空
```

且 `package.json` 的 `files[]` = `lib, scripts, cordis.patch.yml, README.md, CHANGELOG.md, LICENSE`
—— **不含 `test/`**，故测试增补**不可能**改变 tgz。

**实证复核**：从新 HEAD `d3ab3a8` 干净检出 + `npm ci` + `build` + `pack`，
得到 **SHA256 = `CC916356…B9B`、81918 bytes**，与冻结候选**逐字节相同**。
⇒ **候选包对 `c90a1a5` 与 `d3ab3a8` 同时有效**。

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
（A 已请 B 确认此行；若 B 再更正，以 B 为准。）

---

## 4. CI flake 的严重度裁决（R4 §24/§46）

D 独立审查了 A 的 `cleanupSandbox` 修复，并构造**红例**实测。A 采纳其裁决：

- **修复范围**：确实**只放宽临时目录删除**（`EPERM`/`EACCES`/`EBUSY`/`ENOTEMPTY` 退避重试，
  最终失败只 `console.warn` 不抛）；**其他错误码仍原样抛出**；断言/spawn/成功判据**未改动**。
- **成立的部分**：`dialog.unicode-mapping` 的成功判据确实**不含**处理器终止；`kill()` 后未 await `close`/`exit`。
- **实测反驳的部分**：win32 上 `child.kill()` 是**强制终止**（`TerminateProcess` 语义，
  忽略 SIGTERM 的替身同样被杀），kill 前存活、kill 后立即消失；D 另采样 `Get-Process wscript`，
  运行期间与结束后**均无残留**。
- **A 的结论**：这是**"未等待终止"的时序缺口**，**不是**"清理告警掩盖了真实泄漏"。
  按派发书 §24"不能因建议就无限扩大修改"，A **不扩大修改**；
  D 建议的"有界等待 close + 一条红例"记为**非阻断的后续项**。

---

## 5. 待收齐的签收（A 不代签）

| 签收方 | 交付 | 状态 |
|---|---|---|
| B | `r4-state-machine-signoff.md` | ✅ 已交付（`c948872`/`36b51fd`），A 已独立复核其关键主张 |
| D | `r4-independent-signoff.md`、`r4-package-signoff.md`、`r4-d-unique-assertions.md` | ✅ 已交付（`637d798`）；已请其复核新 HEAD 的 CI 与包 |
| C | `r4-windows-results.md` | ⏳ **PENDING**（文件尚不存在；无新独占窗口授权） |

**任何真实主/子会话 PENDING 不得写成"全面实机完成"。**
