# R2 独立复核报告（Agent D）

日期：2026-09-30（R2）。复核人：Agent D（`D:\codex\dsh-notify-D`，分支 `adapt/dsh-018-notify-d`）。
输入：R2 派发书 `D:\codex\dsh-notification-round2-dispatch.md` + R2-D 作业单 `D:\codex\dsh-notification-round2-agentD.md`。

**独立性声明**：本报告每个结论都来自 D 自己执行的命令与测试，**不引用 A/B/C 自己的测试结论**作为证据。
为排除 A 工作树未提交改动的污染，D 另建**独立基线 worktree** `D:\codex\dsh-r2-base`
（detached at `222e38afaff6eb10245598776f4c34726a65700f`，`git status` 干净），
并在该树构建 lib 作为全部复跑的被测产物。

---

## 0. 签收表：R2-D 逐条状态

| # | R2-D 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 精确提交测试/fixture/review/用户指南，交 commit 与所有权清单 | ✅ 完成 | §1（`7611807` = A 代提交；`548de47` = D 的 harness 同步） |
| 2 | 在 A 已提交基线复跑原 21 项，确认冒号与子代理旧断言已修 | ✅ 关闭 | §2（**31/31**，两处已修） |
| 3 | 真实 `AgentRegistry` 服务注入集成（发布阻断） | ✅ **阻断已关** | §3（`agent-registry.test.js` 7/7） |
| 4 | 标题读取：弃用原文、受支持路径提议、冷读/回退/清理/容量/重载 | ✅ 完成 | §4（`session-title.test.js` 7/7） |
| 5 | 独立审 toast.ps1/去重/close/sender/layout、tgz 逐条目、两次打包 | ✅ 完成 | §5 → `r2-package-review.md` |
| 6 | 校正文档（默认值裁决、子代理永久禁用、0.1.5 只记录） | ✅ 完成 | §6（用户指南已更新） |
| 7 | C 实机交接后审 SHA/范围/恢复记录 | ⏳ **PENDING** | §8（C 尚未交接，D 不能预签） |

---

## 1. 提交与文件所有权（R2-D 第 1 条）

### 1.1 提交事实（与作业单预期不同，如实记录）

作业单要求"在 `D:\codex\dsh-notify-D` 精确提交你的测试、fixture、review、用户指南"。
实测：**Agent A 已代 D 提交**（提交信息自述 "committed by Agent A on behalf of Agent D"）。

| commit | 作者 | 内容 |
|---|---|---|
| `7611807` | **A 代 D** | `R1 delivery (real-host integration tests + fixture + review)`，19 文件 / +3461 行 |
| `548de47` | **D（本报告）** | `sync harness.mjs to A's committed a3b6ae9 version (adds FakeSessionLog.id)` |

D 独立核验 `7611807` 的内容与 D 磁盘交付物**逐字节一致**（9/9 交付文件 `git hash-object` == `HEAD:<path>`）：

```
SAME  test/integration/task-notifications.test.js
SAME  test/integration/host-publication.test.js
SAME  test/integration/helpers/notification-host.mjs
SAME  test/integration/package.json
SAME  test/integration/.npmrc
SAME  docs/design/task-notification-user-guide-draft.md
SAME  docs/evidence/task-notifications/review.md
SAME  docs/evidence/task-notifications/integration.md
SAME  docs/evidence/task-notifications/package-repro-review.md
```

⇒ **A 代提交未篡改 D 的交付内容**，作业单第 1 条的实质目标已达成，只是提交者不是 D。
D 补齐了一个 A 漏掉的依赖：`test/integration/helpers/harness.mjs`。
`7611807` 里的该文件是 D 早先同步的旧版（blob `b2c0282`），**缺少 A 在 `a3b6ae9` 加入的
`FakeSessionLog.id`**；D 已 `git checkout 222e38a -- <path>` 采用 A 的已提交版本
（blob `2a24ba73`，与 A 的 `222e38a` 完全一致），使后续合并零冲突。

**未提交（按作业单要求保留本地、不混入生产包）**：
`test/integration/.probe/`、`test/integration/.probe-d/`（D 的探针）、
`HANDOFF-d-t3-task-notifications.md`、`test/integration/.a-task-notifications.test.js`（D 用于跑 A 版本的临时文件）。
注：探针目录已被 `7611807` 收进 git，但 `package.json` 的 `files` 白名单只含
`lib/scripts/cordis.patch.yml/README/CHANGELOG/LICENSE`，**探针不会进入 tgz**（D 已在候选包 21 条目中确认无 `test/`）。

### 1.2 文件所有权清单（D 交付，R2-D 第 1 条）

| 文件 | 归属 | 说明 |
|---|---|---|
| `test/integration/task-notifications.test.js` | **D** | 23 用例（与 A 的 10 用例**同名**，A 按语义合并） |
| `test/integration/host-publication.test.js` | **D** | 12 用例，真实发布路径前提 |
| `test/integration/agent-registry.test.js` | **D** | **R2 新增** 7 用例，真实 AgentRegistry |
| `test/integration/session-title.test.js` | **D** | **R2 新增** 7 用例，标题读取/回退/清理 |
| `test/integration/helpers/notification-host.mjs` | **D** | 真实宿主装配器（R2 扩展 `registry: 'stub'\|'real'\|'none'`） |
| `test/integration/helpers/harness.mjs` | **A**（D 已同步 A 版本） | 原 A 修改；D 不再改动 |
| `test/integration/{package.json,package-lock.json,.npmrc}` | **D** | fixture 扩展 10 个精确依赖；移除 `omit=peer` |
| `docs/design/task-notification-user-guide-draft.md` | **D** | R2 已按实现事实更新 |
| `docs/evidence/task-notifications/{integration,review,package-repro-review,r2-independent-review,r2-package-review}.md` | **D** | 证据 |

**未改动**：A/B/C 的任何源码、脚本、`package.json`、`README.md`、`CHANGELOG.md`、`cordis.patch.yml`。
（`harness.mjs` 是 A 的文件，D 只是把它恢复成 A 自己的已提交版本。）

---

## 2. 在 A 已提交基线上复跑（R2-D 第 2 条）

**方法**：`D:\codex\dsh-r2-base` = detached at `222e38a`，干净；`npm run build` 产出被测 lib。
D 的测试从自己的 worktree 运行、以 `DSH_PLUGIN_ENTRY` 指向基线 lib（不触碰基线工作树）。

### 2.1 两处旧断言：**已由 A 修复，D 独立确认关闭**

R1 时 D 报过"既有 21 项中 2 项为过时断言"。R2 复核结论：

| 旧失败用例 | A 的修法（`a3b6ae9`） | D 独立复跑 |
|---|---|---|
| `只有 en 时回退展示 en；只有 reason 时展示 reason` | 断言改为全角冒号 `原因：手工原因`，并加注释说明旧版是半角 | **通过** |
| `stopReason 区分文案` | 整例反转为 `子代理通知（V16 反转：一律零通知）`，期望 0 spawn / 0 通知 / 0 审计 | **通过** |

⇒ R2 派发书 §当前裁决 5 的"接受 A 的修改"在实测上成立。
**并须记录一个方法论教训**：R1 时 D 是**从自己的分支**跑那 21 项（该分支尚无 A 的测试修正）
才看到 2 项失败；从 A 的已提交基线跑是正确的做法。该失败是**分支分叉产物，不是 A 的缺陷**。

### 2.2 基线门计数（真实输出）

| 命令（在 `dsh-r2-base`） | tests | pass | fail | skip |
|---|---|---|---|---|
| `npm run test:unit` | 196 | **196** | 0 | 0 |
| `npm run test:integration` | 31 | **31** | 0 | 0 |

`test:integration` 的 31 = 21 既有 + **A 的 10 个通知用例**（`222e38a` 新增）。

### 2.3 D 的独立用例在 A 基线上复跑（不采信 A 的 31 项）

| 文件 | tests | pass | fail |
|---|---|---|---|
| `task-notifications.test.js`（D，23） | 23 | **23** | 0 |
| `host-publication.test.js`（D，12） | 12 | **12** | 0 |
| `agent-registry.test.js`（D，7，R2 新） | 7 | **7** | 0 |
| `session-title.test.js`（D，7，R2 新） | 7 | **7** | 0 |
| **D 小计** | **49** | **49** | **0** |

### 2.4 去重后的文件 / 用例矩阵（R2-D 第 2 条要求）

A 的 10 个用例与 D 的 23 个**语义重叠**（A 的 10 项是 D 的子集），去重后**新增约 39 项**：

| A `222e38a` 用例（10） | D 中的对应覆盖 |
|---|---|
| turn/start→step/start→turn/end 恰 1 条 | T3-1a |
| completed 无 step 不补发 | T3-1a（后半） |
| error/blocked/max-tokens 各 1 条 | T3-5a |
| aborted/interrupted/forked/未知静默 | T3-5a |
| 同轮去重 / 新轮再提醒 | T3-7 |
| subagent 会话零通知零进程零审计 | T3-3a/b（D 未断言审计，A 覆盖） |
| 旧开关 true 强制无效 | T3-4 |
| notifyOnTurnEnd=false | T3-8a |
| 卸载后到达事件零通知 | T3-11a |
| 标题回读 + showTitle=false | T3-8d / T-1 / T-2 |

**D 独有、A 的 10 项未覆盖**（建议 A 保留）：

- `T3-2` **fork 根会话不得被误杀**（`isSeeded`/`parentSession` 误判对照）
- `T3-3c` 子代理 continuation 复用同一 child session 仍零通知
- `T3-5b` 错误正文**隐私断言**（无堆栈 / 无绝对目录 / 无命令）
- `T3-6` **seed 历史与 interrupted 恢复**零通知（两条）
- `T3-8b/c` `notifyOnTurnFailure=false` 单独、两开关全关且**审批不受影响**
- `T3-9` **通知投递失败不改变审批结果与审计**（隔离性）
- `T3-10` 审批卡片 6 行结构化字段 + `timeoutAction=approve` 醒目文案
- `T3-11b` 重载后新实例正常通知
- `host-publication.test.js` 全部 12 项（真实 `SessionStore` 发布路径前提断言）
- `agent-registry.test.js` 全部 7 项（§3）
- `session-title.test.js` 全部 7 项（§4）

**给 A 的合并建议**：A 的 `task-notifications.test.js`（10 项）可整体由 D 的 23 项**取代**
（语义超集），或保留 A 版并把上列 D 独有项并入；`host-publication` / `agent-registry` /
`session-title` 三个文件作为**新增文件**直接采纳。D 不代 A 决定。

---

## 3. 真实 `AgentRegistry` 服务注入（R2-D 第 3 条，**发布阻断已关**）

### 3.1 为什么必须补

R1 的 `notification-host.mjs` 只用最小 `{ get: (id) => agents.get(id) }` 替身。
那只能证明"插件会调用某个 get 函数"，**不能证明真实宿主服务注入正确**——
即真实 `@deepseek-ai/dsh-agent` 的 `AgentRegistry` 作为真实 Cordis 服务注册后，
`ctx.agents.get(id)` 是否真能按契约 §2.6 解析顺序第 2 步查回 live agent。R2-D 第 3 条据此列为发布阻断。

### 3.2 实现方式（真实组件，非替身）

`helpers/notification-host.mjs` 新增 `registry: 'stub' | 'real' | 'none'`：

- `'real'`：`new AgentRegistry(ctx)` —— 真实 Cordis 服务注册（`super(ctx, "agents")`），
  并用返回的 `registerAgent(agent)` 走真实 `AgentRegistry.register()`
  （内部真实 `enter()` 校验 `agent.id === session.id`，再 `announce(agent, 'startup')` 效果链）。
- `'none'`：完全不注入，触发插件 `safeAgentLookup` 的"服务不可用"路径。
- `'stub'`：保留给既有 23 个用例，兼容不变。

### 3.3 结果：`test/integration/agent-registry.test.js` **7/7 PASS**

| 用例 | 断言 |
|---|---|
| `R-1` | **req.agent 仅带 id**（无 session）→ 经真实 `ctx.agents.get(id).session` 解析出主会话 → **被认领**（弹卡片 + 下游未被调用 + 审计 `approved`） |
| `R-2` | 真实 registry 中该 agent 的 session 是委派子会话（`origin=subagent`）→ **next() 恰一次**、无审计、无 spawn |
| `R-3` | 真实 registry 在位但 **id 未注册** → next() 恰一次、无审计、无 spawn |
| `R-4` | **完全不注入 agents 服务**（宿主无 `dsh-agent`）→ 插件**照常挂载**、next() 恰一次、无审计、无 spawn |
| `R-5` | 真实 registry 的 owning fiber **dispose 后**（新宿主查无此 agent）→ next() 恰一次 |
| `R-6` | agent 注册后、审批前被**真实注销**（`store.delete` 路径）→ next() 恰一次、无审计 |
| `R-7` | 回归：`req.agent` **带 session**（解析顺序第 1 步）→ 在完全没有 registry 时仍被认领 |

**过程中发现并记录的两个实现事实**（对 A 有价值）：

1. **cordis 会把服务包成 proxy**：`ctx.agents === new AgentRegistry(ctx)` 实测**恒为 `false`**。
   因此断言必须用"真实 API 可用性"（`typeof ctx.agents.register === 'function'`）而不是实例相等；
   对代理做深比较还会踩进服务代理陷阱（D 实测报 `cannot get property "href" without inject`）。
2. **`ctx.agents` 在服务缺失时不抛**：实测 `void ctx.agents` 未抛异常（返回 falsy），
   与 A 在 `safeAgentLookup` 注释里写的"cordis 在服务未注入时读取该属性会抛"**不一致**。
   两种情形插件都已安全处理（A 的 `try/catch` + 类型检查），所以**不是缺陷**，
   但该注释在 cordis `4.0.4` 上不准确，建议 A 修正措辞。

**结论：R2-D 第 3 条的发布阻断已关闭**（真实实现测试通过，不再是 PENDING）。

---

## 4. 标题读取与清理（R2-D 第 4 条）

### 4.1 弃用原文（D 独立取字节核实）

`@deepseek-ai/dsh-session@0.1.7-rc.2`，`lib/types/index.d.ts:186-189` 原文：

```
* @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
* See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[]
```

同样标记的还有 `eventAt()` 与 `ownEvents()`。

### 4.2 受支持替代（D 的提议，**API 选择归 A 契约修订**）

| 路径 | 弃用状态 | 说明 |
|---|---|---|
| `session.snapshotEvents()` | **@deprecated / new calls prohibited** | 当前 A 的 `titleOf()` 冷读用它 |
| `SessionTitleService.get(session)` | **无弃用标记**（`dsh-session-title/lib/types/index.d.ts:123`） | 返回 `SessionTitleSnapshot`（含 `title`），宿主挂载该服务时可用；插件侧需安全访问 `ctx.sessionTitle`（同 `safeAgentLookup` 模式），**无需新增依赖** |
| 增量 `session/title` 事件 | 公开事件（A 已实现 `rememberTitle`） | 实时更新路径，已正确 |

**D 的提议**：冷读优先 `ctx.sessionTitle.get(session)?.title`（受支持、无弃用调用），
把 `snapshotEvents()` 降为"服务未挂载时的回退"，并在契约里显式记录该回退仍属被禁止的新调用；
若 A 不接受，另一条自洽选择是**彻底不做冷读**、只有实时 title 事件才更新标题，
其余一律短 ID 回退（这也满足"冷读无标题不阻断审批处理"）。
**D 不代 A 决定，也不擅自改 A 的源码**；本文件只把行为固化成两种实现都能通过的形式。

### 4.3 结果：`test/integration/session-title.test.js` **7/7 PASS**

| 用例 | 验证内容 |
|---|---|
| `T-1` 冷读 | 标题只在 **seed 历史**里、本进程从未发布 `session/title` → 通知仍带上该标题 |
| `T-2` 回退 | 完全无标题 → `任务：会话 <短ID>` |
| `T-3` 空白/欺骗字符 | 标题事件为 ` \u200b\u202e \t ` → **不得当标题**，回退短 ID |
| `T-4` **disposed 后同 id 重建** | 带标题会话 `session/disposed` 后，同 id 重建且无标题 → **不得泄漏旧标题**，回退短 ID |
| `T-5` 缓存容量 | 连续 300 个带独立标题的会话（超 `TITLE_CACHE_MAX=256`）逐个走一轮 → **标题不串位** |
| `T-6` 重载 | 插件卸载（`titleCache.clear()`）后重载，同 id 无标题 → 无陈旧标题，回退短 ID |
| `T-7` **身份门回归** | 带标题的**委派子会话**仍**零通知零进程** —— 标题路径**未**绕过 `origin === 'subagent'` |

**没有任何用例为了变绿而放宽主/子身份门**；`T-7` 是专门盯这一点的反向断言。

---

## 5. 包审与可复现性（R2-D 第 5 条）

完整证据见 **`r2-package-review.md`**（独立文件）。要点：

| 项 | 结论 |
|---|---|
| 候选 `F7C6E74E…`（77254 B）与协调者记录一致 | PASS |
| 包内 `lib/**` 与干净构建 `222e38a` 逐字节一致 | PASS（6/6） |
| version / peer 精确 | PASS |
| 脚本 BOM / ASCII | PASS |
| **审批卡片独立 text 布局** | **FAIL（发布阻断）**：`<text>` 仅 2 个（标题 + 单个 Message），两脚本内 `任务：/操作：/原因：/选择：/等待：` 标记 **0 处** |
| **`package.json` description** | **FAIL**：字节级仍含 `parallel subagents` |
| **换行门** | **FAIL**：`toast.ps1` 为 pure-LF（其余 3 脚本 CRLF），`test/`+`.github/` **无任何换行门** |
| **候选包可由 commit 复现** | **FAIL**：同工作树两次打包 hash 相同（确定性 PASS），但从 `222e38a` 正常 checkout 打包得 `433AA74F…` ≠ 候选 `F7C6E74E…` |
| BOM 退化红例 | PASS（A 的 `test/task-toast-script.test.js` 断言 BOM 字节 + 真实 `Parser::ParseFile`） |
| `toast.ps1` 行为面（Tag/Group/Sound/Show/退出码语义） | PASS；且**回答了用户指南 PENDING-6**：`default` → `<audio src="ms-winsoundevent:Notification.Default"/>` |

**不可复现的根因（诚实归因，不甩锅）**：候选包内的 `toast.ps1` 是该文件的 **git blob 原样（LF，5775 B）**，
而正常 checkout 会按 `.gitattributes` 的 `eol=crlf` 得到 CRLF（5892 B）。因此候选包不是由
"`git checkout 222e38a` + `npm pack`"得到的。**D 不主张候选包功能有误**（lib 与全部其他运行文件都与干净构建一致），
但 R4 的"固定 SHA 全員引用一致"目前建立在一个**无法由源码复算的 hash** 上。

---

## 6. 文档校正（R2-D 第 6 条）

`docs/design/task-notification-user-guide-draft.md` 已按实现事实更新：

| 校正点 | 处理 |
|---|---|
| **默认主完成/错误 `true` 是用户修订需求** | ✅ 把"默认值张力（请 A 决策）"整段改为**【已裁决，不再开放】**，明确默认开箱即"审批+完成+错误（静音）"，场景 ① 变为"需显式关闭两个新开关"；**并写明无需再次询问用户** |
| **子代理永久禁用** | ✅ §1 与 PENDING-4 均写明两字段保留但**强制无效**，旧开关 `true` 也零通知零进程（D 的 T3-4 验证） |
| **主审批透明、未执行操作不猜命令** | ✅ 保持"工具名不是命令、不拼接未核实字段"约束；审批卡片实测仅展示宿主工具名 |
| **当前宿主 `0.1.5-rc.2` 仅记录不兼容** | ✅ 标注为只读记录、**本轮只支持 0.1.7-rc.2**、**不自动升级生产** |
| **PENDING 不抹掉** | ✅ §7.3 改为"已关闭 ✅ / 仍开放 ⏳"双标记表，**13 → 17 条**（保留全部旧编号并追加 R2 新增 4 条） |
| **旧 0.3.1 附件不重发不替换** | ✅ 保留 `package-repro-review.md` 的结论与"不重发"建议 |

---

## 7. 阻断 / PENDING 总表（R2-D 第 7 条）

### 7.1 已关闭

| # | 原阻断/PENDING | 关闭依据 |
|---|---|---|
| 1 | R1 报的"既有 21 项 2 处过时断言" | §2.1：A 已在 `a3b6ae9` 修好，D 在 `222e38a` 基线复跑 **31/31** 确认 |
| 2 | **真实 `AgentRegistry` 服务注入**（R2-D 明列的发布阻断） | §3：`agent-registry.test.js` **7/7**，真实服务 + 真实 `register()` 效果链 |
| 3 | 用户指南 PENDING-1（默认值张力） | §6：用户修订需求已裁决 |
| 4 | 用户指南 PENDING-3（新字段默认值与投影） | 代码已落地 + D 的 T3-8 投影断言 |
| 5 | 用户指南 PENDING-4（弃用字段与告警） | 代码已实现 + D 的 T3-4 断言 |
| 6 | 用户指南 PENDING-12（`dataDir`） | 实现保留，集成测试全走隔离 `dataDir` |
| 7 | 用户指南 PENDING-6（`default` 音 XML 写法） | §5：候选包实测 `default` → `<audio src="ms-winsoundevent:Notification.Default"/>` |

### 7.2 仍 PENDING（不由 D 关闭）

| # | PENDING | 归属 | 说明 |
|---|---|---|---|
| P-1 | **审批卡片独立 text 布局未同步** | **A + C** | **发布阻断**（R2 门禁 R2"布局可读"）。候选包 `<text>` 仅 2 个。D 未实机，需 C 确认 `\n` 是否折行 |
| P-2 | **候选包不可由 commit 复现** | **A** | `toast.ps1` LF vs checkout CRLF；建议打包前归一 + 加换行门 |
| P-3 | **`package.json` description 仍称 `parallel subagents`** | **A** | 与"子代理整体关闭"矛盾 |
| P-4 | **无换行门** | **A** | `test/`+`.github/` 无 CR/LF 断言；BOM 门已有红例 |
| P-5 | **`snapshotEvents` 弃用新调用** | **A（契约修订）** | 行为已验证正确；API 选择归 A。D 提议 `ctx.sessionTitle.get(session)` 优先 |
| P-6 | `Aborted` 措辞把取消类终态说成"用户取消" | A（契约措辞） | 无用户可见影响（该分支静默） |
| P-7 | 真实主/子会话实机（R3） | **C** | **5 条通道测试不得当作真实会话通过**（R2 派发书 §当前裁决 4） |
| P-8 | 最终固定包 SHA、逐字节核验、Release | A | 候选为"待修订候选"，不得作为签收包 |
| P-9 | 远端 CI 全绿（R1） | A | D 无 push 权限，只做本地门 |
| P-10 | 生产升级/回滚演练 | A（需用户决定） | 本轮不动生产 |

### 7.3 D 明确不代签的范围

- **D 不签署 C 的实机结论**：C 尚未交接；R2-D 第 7 条的"审 SHA/作用范围/恢复记录"**保持 PENDING**。
- **D 不签收候选包**：§5 的三条 FAIL 未关闭前，候选包不可作为最终实机签收包。
- **D 不代 A 改源码**：§7.2 的 P-1…P-6 均由 A/B/C 以"具体最小证据"修复，D 只提供红例与证据。

---

## 8. 边界与复现命令

### 8.1 边界

- 全部自动层测试**只 mock spawn**：**未运行任何真实 Windows 通知、未运行 wscript、未改 HKCU**。
- **未修改** A/B/C 的源码、脚本、`package.json`、README/CHANGELOG（唯一例外是把 A 自己的
  `harness.mjs` 恢复为 A 的已提交版本）。
- **未创建/发布任何 Release、未 push、未打 tag、未合并分支**。
- **未删除任何文件**（作业单与协调者均要求保留工作树与未提交素材）。

### 8.2 复现命令

```powershell
# ① 基线 worktree（detached at 222e38a，干净）
git -C D:\codex\dsh-approval-center worktree add D:\codex\dsh-r2-base --detach 222e38afaff6eb10245598776f4c34726a65700f

# ② 基线门（A 已提交基线，正确树）
cd D:\codex\dsh-r2-base ; npm run test:unit          # 196/196
                          npm run test:integration   # 31/31

# ③ D 的独立用例（对基线 lib）
$env:DSH_PLUGIN_ENTRY = "D:\codex\dsh-r2-base\lib\index.js"
cd D:\codex\dsh-notify-D
node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 test/integration/task-notifications.test.js  # 23/23
node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 test/integration/host-publication.test.js    # 12/12
node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 test/integration/agent-registry.test.js      #  7/7
node --import ./test/integration/hooks/register.mjs --test --test-concurrency=1 test/integration/session-title.test.js       #  7/7

# ④ 打包复现性（两次应相同；与候选包不同）
cd D:\codex\dsh-r2-base ; npm pack --pack-destination . ; npm pack --pack-destination .
```
