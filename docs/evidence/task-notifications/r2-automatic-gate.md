# R2 自动门证据（Agent A）

日期：2026-09-30。编制：Agent A。共同基线 `222e38afaff6eb10245598776f4c34726a65700f`，本轮整合 commit `6f5daf75e09cec4ea1b79bee29b73f47a6f974ce`。

## 1. 输入与整合方式

| 来源 | 交付 | 处置 |
|---|---|---|
| B | `src/notifications.ts` + 2 个测试文件（75 例） | 已在 R1 整合进 A 树；R2 无新增 |
| C | sender + `toast.ps1`（R1）；**R2 layout 未交付** | R1 已整合；**A 补写**了 R1 中被截断的 `toast.ps1`；R2 layout 记 **PENDING**（见 §5） |
| D | 23 例 task-notifications + 12 例 host-publication + `notification-host.mjs` + fixture lock/.npmrc + 审查 | **全部采纳** |

**关于"未 commit 先要求 D 提交"**：R2 派发要求 D 先 commit。B/C/D 三个代理会话均已终止且未能 commit。
A 的处置：把三人工作树**逐字节原样** commit 到各自分支（`afba925` / `7cee252` / `7611807`），
commit 信息明确标注"由 A 代为提交以保留出处，内容 A 未改动"。随后按 merge 语义整合，**没有整体覆盖工作树**。

**harness.mjs 冲突核查**：D 的版本与 A 的版本 SHA256 **完全相同**
（`26FE641A…1CB191`）——D 确实同步了 A 的 `FakeSessionLog`（`header`/`id`/`snapshotEvents`）。
无冲突。

## 2. 测试语义合并（不盲目覆盖、不重复计数）

A 原有 10 例 `task-notifications.test.js` 与 D 的 23 例同名。逐条比对后结论：
**D 的 23 例是 A 10 例的严格超集**（含 `-Group dsh-task`/`-Tag` 16 hex/`-Sound silent`、成功正文固定文案、
隐私断言、`session/title` 事件更新任务名、`showTitle=false` 短 ID 回退且**不泄漏敏感标题**）。

处置：**采纳 D 的文件**，A 的 10 例文件退役（其断言全部被覆盖，无一丢失）。
在此基础上 A 新增 R2 要求的 5 例（见 §4），合并后 **28 例**，无重复计数。

## 3. 测试计数（实测，非沿用旧数）

| 命令 | 开发树 | 干净 checkout（repro1） |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| `npm run test:unit` | **209/209**，0 fail 0 skip | **209/209** |
| `npm run test:integration` | **61/61**，0 fail 0 skip | **61/61** |

构成（可复核）：

- 单测 209 = 既有 98 + B notifications 75 + 任务 sender 12 + 脚本静态 11 + **身份适配器 13（R2 新增）**
- 集成 61 = 既有 21 + D task-notifications 28（23 + R2 新增 5）+ D host-publication 12

**既有 98 项中含真实进程用例（如实标注，不宣称纯 mock）**：

| 文件 | 真实行为 | 是否弹 Toast / 改 HKCU |
|---|---|---|
| `test/dialog.scripts.test.js` | 真实 `powershell.exe` 5.1 `Parser::ParseFile` 语法门 | 否 |
| `test/task-toast-script.test.js`（A 代 C 写） | 真实 PS5.1 解析 + 3 条参数校验路径（全部在 `try` 块**之前** exit） | 否（未执行 AUMID 注册与 `Show()`） |
| 其余 | 纯 mock / 内存实现 | 否 |

如需在这些**真实进程**用例上做桌面级确认，须另开明确窗口（本轮未做）。

## 4. R2 新增验证

### 4.1 标题冷读裁决（有实证）

宿主 `dsh-session/lib/types/index.d.ts`（0.1.7-rc.2）对 `snapshotEvents()` 的 JSDoc **原文**：

> `@deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.`

**裁决**：B 的说法属实。本插件**不得新增**该调用 → 删除了"首次遇到会话回读事件快照"的冷读路径。
标题**只**来自 `session/title` 事件流；读不到回退 `会话 <短ID>`。
受支持的替代（`SessionTitleService.get(session)`）需要宿主注入 `dsh-session-title`，本插件不假设其存在；
事件缓存本身即是受支持路径。`latestTitleFromEvents` 保留但标记 deprecated（禁止喂 `snapshotEvents()` 结果）。
契约 §2.5 已更新并引用上述原文。

### 4.2 registry 查询面（协调者关注点：不能让主审批静默失效）

**实测发现**：真实宿主的 `ApprovalService.request()` 对 **id-only 请求直接抛异常**
（`dsh-user-approval/lib/index.js:50` `hasOpenTurn` 读 `agent.session` 的 `seq`）。
⇒ "id-only 请求"在真实宿主**不可达**，`ctx.agents.get` 只能是**防御性回退**，不是主路径。

因此该路径在**单元层**覆盖（`test/identity-adapter.test.js`，13 例）：
registry 命中 / 查不到 / 抛异常 / 无 session 无 id / 优先 `agent.session` 等逐项断言。
集成层新增**回归用例**：宿主**未注入** `dsh-agent`（无 `ctx.agents`）时主审批照常认领——
这正是 R1 实测的 cordis 崩溃（`cannot get property "agents" without inject`）回归，现已由 `safeAgentLookup` 防住。

### 4.3 新增集成用例（并入 D 的文件，编号 T3-12）

| 用例 | 断言 |
|---|---|
| R2-1 冷标题 | 无 `session/title` 事件 → `任务：会话 <短ID>`，通知不消失、无 `undefined` 占位 |
| R2-2 title 数据异常 | `title: 12345` → 通知不消失、回退短 ID、不把数字塞进正文 |
| R2-3 无 ctx.agents | 主审批照常认领 + 结构化卡片 + 审计 1 行（R1 回归） |
| R2-4 session/disposed 清缓存 | 真实 store 移除路径（同 host-publication D2）：同 id 重建、**新轮次**后旧标题不得复用 |
| R2-5 缓存上界 | 建 257 个会话（TITLE_CACHE_MAX=256）：最旧被淘汰回退短 ID，最新仍在缓存 |

**R2-4 排障记录**：首版用例在重建后复用 `turn: 1`，被同 key 去重正确抑制 —— 是**用例错误**而非实现缺陷，
改为 `turn: 2` 后通过。这个"错误"本身反向验证了去重是生效的。

## 5. 脚本打包门（R2 §6）

**R1 实测事故复核**：`toast.ps1` 曾被截断成 3 字节（仅 BOM）。当时三项门禁——长度非 0、BOM 存在、
空文件 `Parser::ParseFile` 零错误——**全部通过**，但脚本什么都不做，sender 会以 exit 0 **静默假成功**。

新增两道门（`assertScriptsUsable` + CI）：

1. **完整性门**：剥掉 BOM 后必须还有非空白字节，否则拒绝挂载（CI 报 `BOM/whitespace-only script`）。
2. **换行门**：`.ps1`/`.vbs` 最终交付必须 **CRLF-only**。实测发现 A 写的 `toast.ps1` 有 **117 个裸 LF**、
   0 个 CRLF（`npm pack` 打包的是工作树文件，`.gitattributes` 的 `eol=crlf` 管不到它）——已归一化并纳入 CI。

本地门禁结果：4 个脚本全部 PASS（BOM/ASCII/CRLF/非空）；PS5.1 解析 0 错误。

## 6. 远端 CI（未完成，阻塞）

`git push` 失败，网络层错误：

```
error: RPC failed; curl 55 Send failure: Connection was reset
fatal: unable to access 'https://github.com/xmwpoi/dsh-approval-center.git/':
Failed to connect to github.com port 443 after 21129 ms: Could not connect to server
```

分支 `adapt/dsh-018-notify-a`（HEAD `6f5daf7`）**只在本地**，Draft PR 未创建，远端 CI 未触发。
恢复网络后执行：`git push -u origin adapt/dsh-018-notify-a`，再建 Draft PR。CI 首轮结果无论成败都须保留记录。

## 7. 未关闭项（不替他人签字）

| 项 | 状态 |
|---|---|
| C 的 R2 layout 修复 | **未交付**（C 会话两次终止）。当前卡片仍是 `标题 + 单个 Message text`（2 个 `<text>`，多行靠 `\n`），token/URI/按钮/退出码/超时**全部未动**。按 R2 §2 要求，layout 改动需官方 schema + 实机确认，A 不代做。 |
| B / D 的独立 review 签字 | B 的 R2 状态机复核、D 的独立复核均未返回；本文只引用 D 在 R1 交付里写的审查结论，**不代签**。 |
| T6 Windows 独占实机 | 未做（无新独占窗口/真实主子会话凭据）。 |
| 远端 CI / Draft PR | 网络阻塞（§6）。 |
