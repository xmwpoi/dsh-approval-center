# R5 独立审签报告（Agent D）

日期：2026-10-01（R5）。复核人：Agent D。工作树 `D:\codex\dsh-notify-D`。
输入：`dsh-notification-round5-approval-layout-fix.md`（R5-D）。
**R4 签收历史保留**：`r4-independent-signoff.md` / `r4-package-signoff.md`（对 `c90a1a5` + `CC916356…` 的签收**继续有效**，本轮新代码仅审受影响面）。

---

## 0. R5-D 逐条状态

| # | R5-D 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 保留 R4 签收历史；新代码仅审 formatter/XML/接口 | ✅ | §1 |
| 2 | C 失败的 32/100 真实输入加为自动结构回归（静态≠像素） | ✅ **5/5** | §2（`approval-card-regression.test.js`） |
| 3 | 独立验证安全信息优先、批准本次、超时真实、摘要提示、身份门/child 静默 | ✅ 完成 | §3 |
| 4 | 合入此前 4 独特断言（R-8/R-9/T-1b/T-1c） | ✅ **在 `c90a1a5` 树上全量复跑 79/79 + 250/250** | §4 |
| 5 | **确定性真实 loop 夹具**（真实 `ctx.llm.registerAdapter` + 真实 agent-loop） | ✅ **4/4，loop 三终态全真实产出** | §5、`r5-loop-evidence.md` |
| 6 | 主/子真实 loop：子代理路径障碍记录 | ✅ 如实记录（不外推） | `r5-loop-evidence.md` §6.3 |
| 7 | 失败 adapter 走真实 error 终态（loop 产出 turn/end） | ✅ L-2 | §5 |
| 8 | 新包审（等 A 的新候选） | ⏳ 方法与复验点已备好（§6） | `r4-package-signoff.md` §2-§6 可复用 |
| 9 | 输出 `r5-independent-review.md` + `r5-loop-evidence.md` | ✅ 完成 | 本文件 |

---

## 1. R4 签收历史与"受影响面"界定

R4 签收（`c90a1a5` + `CC916356…`）**继续有效**。本轮只审**受影响面**：

| 面 | 影响范围 | 审签动作 |
|---|---|---|
| formatter（`formatApprovalCard`） | 卡片 message 结构 | B 改 → D 结构回归（§2） |
| 审批脚本 XML（`approval-toast.ps1`） | 渲染层 | C 改 → C 实机复测 |
| 任务通道 `toast.ps1` | **若未改则 R4 的 T1-T4 证据可复用** | D 在新包上核字节（§6） |
| 身份门/child 静默 | **不得回归** | D 回归（§3） |
| loop/通知路径 | **不得回归** | D 回归（§4、§5） |

---

## 2. C 实机 FAIL 样本固化为自动结构回归（**静态 ≠ 像素**）

`test/integration/approval-card-regression.test.js`（**5/5 PASS**）：把 C 报告的
32 中文 / 100 中文（Node 截断阈值）/ 200 中文（C 的 L4 原始样本）三档真实输入，
经**真实审批路径**（真实 waterfall + 插件身份门 + mock 通道）固化为断言。

**实测结论（重要，与 C 的诊断一致）**：**Node 侧截断后，message 字符串仍然完整包含**
`选择：批准=本次允许；拒绝=不允许执行`、`等待：30秒；超时=自动拒绝`——
**失败发生在 Windows 渲染层（`<text>` 内 `\n` 不折行），不在字符串组装层**。

⇒ **本回归只保护"字符串结构"，不覆盖像素渲染**。像素层的修复依赖 R5 布局方案
（固定安全信息优先 + 3 个 `<text>`），最终判定**必须**由 C 的实机复测给出。

---

## 3. 必不回归项（R5-D 第 54 条）

以下在 `c90a1a5`（A 当前基线）上由 D 的套件独立复验，**全部通过**：

| 项 | 用例 |
|---|---|
| **安全信息在卡片中真实存在**（选择/等待/超时动作，长原因下仍在字符串里） | `approval-card-regression` 3 例 |
| **批准仅本次**、不描述永久授权 | 同上 |
| **超时动作真实**（reject 写自动拒绝；approve 写自动批准、不伪装拒绝） | `R5-S3` |
| **原因缺失如实占位**、不伪造命令、不拼接未核实字段 | `R5-S2` |
| **身份门**（origin==='subagent' 唯一判据）不回归 | `T3-3/T3-4`、`T-7`、`R-2` |
| **child 静默**（所有终态 + 旧开关 true 零通知零进程） | `T3-3/T3-4` |

---

## 4. 此前 4 独特断言已合入并全量复跑（R5-D 第 54 条）

把 D 的 R3 版 `agent-registry.test.js` / `session-title.test.js`（含 `R-8`/`R-9`/`T-1b`/`T-1c` 4 例独有）
复制进 `c90a1a5` 树后：

| 套件 | tests | pass | fail | skip |
|---|---|---|---|---|
| `npm run test:integration` | **79** | **79** | 0 | 0 |
| `npm run test:unit` | 250 | **250** | 0 | 0 |

⇒ **4 例独特断言在 A 树上是干净追加**（75 + 4 = 79），无回归、无冲突。
（A 的 `test:integration` 尚未纳入 `agent-loop.test.js` 的 4 例——那是**新增文件**，待 A 决定是否纳入 CI 清单。）

---

## 5. 确定性真实 agent-loop 夹具（R5-D 第 56-58 条，**本轮核心交付**）

**C 的 R4 报告明确 PENDING："真实 agent-loop 与子会话——PENDING（无确定性模型适配器）"。
本轮 D 交付了该适配器与真实 loop 驱动**（详见 `r5-loop-evidence.md`）：

| 项 | 实测 |
|---|---|
| 真实服务装配 | `SessionStore`/`AgentRegistry`/`LlmRuntime`/`SystemPrompt`/`ToolRuntime`/`SessionProjectionRegistry` + 插件 + **真实 `AgentLoop`**（6 服务 inject） |
| 确定性 adapter | 真实 `LlmAdapter` 契约最小实现，经**真实 `ctx.llm.registerAdapter`** 注册 |
| **真实完成** | `followup` → 真实 `turn/start`→`step/start`→`system/message`→`user/message`→`request/header`→`request/context`→`assistant/message`→`step/end`→`turn/end (completed)`；`adapter.callCount===1`；插件发成功通知 |
| **真实失败终态** | adapter **throw** → loop 产出 `turn/end (error)` 且携带 LlmFailure → 插件发错误通知（原始错误不进正文） |
| **真实取消** | `agent.cancel({kind:'user'})` → `turn/end (aborted)` → 插件静默、零进程 |
| **无冒充** | **无任何手工 `session.append('turn/end')`**；事件序列全部由真实 loop 产出 |
| 测试 | `agent-loop.test.js` **4/4**（L-1/L-2/L-3/L-4） |

**调用层事实（固化在 `R-9`）**：`id-only` 是**防御性回退输入**——真实 `ApprovalService.request`
对 id-only 在宿主层先抛（open-turn 需要 `agent.session`）；**不得为不可达输入加生产依赖**。

### 5.1 诚实边界（R5-D 第 56/62 条）

1. **模型是确定性的**：证明的是**路径**（真实 loop → 事件 → 插件 → 通知），**不证明**生产模型体验。
2. **sender 仍为 mock**：若 C 在静音窗口把本夹具换成**最终包的真实 sender**，
   即形成"确定性模型真实 loop + Windows"端到端证据；**即便如此仍不等于生产模型已验**。
3. **子代理真实 loop 未覆盖**：需真实 `dsh-subagent` 委派执行路径（装配较重），**主会话证据不外推到子代理**。
4. **helper 依赖限定测试域**：`dsh-agent-loop` 等是 fixture 测试依赖，**不是插件运行时依赖**；
   是否纳入 CI 清单由 A 决定（R5-A）。

### 5.2 给 C 的可执行 runner（R5-D 第 60 条）

见 `r5-loop-evidence.md` §7：在静音窗口以最终包为 `DSH_PLUGIN_ENTRY` 重跑
`agent-loop.test.js`（有界 20s 超时、fiber 全量 dispose、临时目录清理）。

---

## 6. 新包审（R5-D 第 62 条）：**等 A 的新候选**

R5 的 formatter/XML 改动尚未落地（B/C 并行中），新候选未生成。D 已备好复验方法：

| 步骤 | 说明 |
|---|---|
| ① 逐条目不剥 CR | 复用 `r4-package-signoff.md` §2 的方法 |
| ② 两次干净 pack 全 hash | 复用 §6（**独立目录，不覆盖旧候选**） |
| ③ **任务 sender/script 字节比对** | 与 `CC916356…` 包内 `lib/dialog.js`、`scripts/toast.ps1` 逐字节比——**若未变，R4 的 T1-T4 实机证据可复用**；若变则通道受影响项重测 |
| ④ version/lock/peer/description | 复用 §4 |
| ⑤ 编码门 | 复用 §3 |

派发书 §38 要求的"原 R4 任务通道 T1–T4 证据可保留，但需 D 确认 runtime/script 字节确实未变"
在 A 出新候选后执行；**在此之前不预设结论**。

---

## 7. 仍开放（不由 D 关闭）

| # | 项 | 归属 |
|---|---|---|
| O-1 | R5 formatter（固定安全信息优先）落地 + 纯函数断言 | B |
| O-2 | R5 XML（3 `<text>`、安全信息前置）落地 + `-ValidateOnly` 静态门（含 32/100 样本） | C |
| O-3 | 新候选出包 + D 包审（§6） | A → D |
| O-4 | C 新包实机：32/100/超长原因 + approve 自动批准可见性 + 缩放档位（未批准档位 PENDING） | C → D 审 |
| O-5 | 确定性模型真实 loop + Windows 端到端（用 D 夹具替换真实 sender） | C（可用 §5.2 runner） |
| O-6 | 最终 readiness | A（收齐 B/D 独立 + 新布局实机 + 真实 loop） |

**D 不预签**：新布局的实机渲染结论、生产模型体验、全 DPI 覆盖——都不在本轮 D 的签收范围。

---

## 8. 边界

- **全自动层只 mock spawn**：未投递任何真实通知、未运行 wscript 投递、未改 HKCU/URI。
- §7.2 红例启动的 Node 替身进程已全部回收（win32 kill 为强制终止，实测零残留）。
- **未修改** A/B/C 的源码、脚本、`package.json`、README/CHANGELOG、`cordis.patch.yml`、`.github/**`。
- **未合并 PR、未打 tag、未发布、未升级生产**；历史包（F7/98F6/CC916）**未删未覆盖**；未删除任何文件。
- **诚实更正记录**：R4 报告 §2.3 的"D 独有 8 例"在本轮精确核对后更正为 **4 例**（§4）；
  初次错误原因是用名称前缀比对，A 的改写版名称不同但语义等价。
