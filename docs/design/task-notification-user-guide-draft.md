# 主对话审批 / 完成 / 错误通知：用户说明与配置（README 章节素材草案）

- 编制：Agent D（T3）
- 日期：2026-09-30
- 基线：worktree `D:\codex\dsh-approval-center-d-t3`，分支 `adapt/dsh-017-t3`，commit `4f6e04b`（= tag `v0.3.1-rc.1`，版本号 `0.3.1-rc.1`）
- 依据：`D:\codex\dsh-task-completion-notification-plan.md`（下称"派发书"）
- 状态：**草案，供 Agent A 收口 README 使用。本文不宣称计划中的功能已实现或已通过实机测试。**

## 0. 阅读约定：两个版本的区分

派发书开头写明"本文是开发计划，不代表功能已经实现或通过实机测试"。因此本文每一处都区分：

| 标记 | 含义 | 判定依据 |
|---|---|---|
| **【现 0.3.1-rc.1】** | 当前已发布的 `0.3.1-rc.1` **实际**具备的行为 | 只读核对本 worktree 的 `src/index.ts`、`src/host-contract.ts`、`src/dialog.ts`、`scripts/*.ps1`、`cordis.patch.yml`、`README.md` |
| **【计划 0.4.0-rc.1】** | 派发书 §2.6/§2.7 规定、**尚未实现、未实机验证**的行为 | 派发书原文；`0.4.0-rc.1` 是派发书 §2.7 的"建议下一功能候选版本"，版本字段由 A 在验收后修改 |
| **PENDING** | 无法从现有代码或派发书原文核对的点 | 见 §7.3 |

凡未标注的陈述都**只**来自上述两个来源；本文不补写派发书没有的行为。

---

## 1. 定位与范围

### 1.1 这个插件做什么（【计划 0.4.0-rc.1】的完整定位）

`dsh-approval-center` 把 DSH 主对话需要你介入的三类事件送进 **Windows 通知中心**：

1. **审批请求** —— 主对话发起、需要你批准或拒绝的操作；
2. **本轮回复完成** —— 主对话的一轮回复正常结束；
3. **本轮执行错误** —— 主对话自身出现异常终态。

通知由 Windows 原生通知中心负责排列与折叠；本插件不自绘窗口、不改动审批决策逻辑。

### 1.2 这个插件不做什么（派发书 §1 修订约束）

- **子代理一律不通知。** 子代理的启动、结束、错误、审批请求、结果回执**全部**不由本插件弹通知；子代理错误也不会被转写成父会话的错误通知（派发书 §2.1 末段）。
- **旧的 `notifyOnSubagentStart` / `notifyOnSubagentEnd` 是弃用兼容字段。** 派发书 §1 原文："旧子代理开关仅保留为弃用兼容字段，即使旧配置为 true 也无效……**不能只改默认值而让旧配置继续响铃**"。也就是说：这两个字段即使写成 `true`，也**强制不生效**，不产生任何通知、不拉起任何发送进程。
  - **【现 0.3.1-rc.1】行为不同**：当前版本这两个开关是**真的生效**的（`src/index.ts:204-214` 在 `true` 时注册 `subagent/end`、`subagent/start` 监听并调用 `showToast`）。这是计划版要移除的行为。
- **子代理的审批请求不由本插件认领。** 派发书 §2.7：插件先解析 `req.agent` 对应的真实 Session 并按 `header.origin` 判定；子代理审批及身份无法可靠确认的请求"不被本插件认领，不入审批队列、不创建本插件审批记录、不弹窗"，改为 `next()` 恰一次交宿主其他应答者处理，**绝不静默自动批准或拒绝**。
  - **【现 0.3.1-rc.1】行为不同**：当前版本**不区分主/子会话**——只要 `toolName` 匹配 `tools`，`approval/request` 就被认领（`src/index.ts:199-202`）。
  - **【计划 0.4.0-rc.1】已知边界**：宿主不存在后续渠道时，子代理审批仍可能**在宿主界面**等待人工审批；本插件无法替其他程序禁止通知（派发书 §2.7）。
- **审批结果回执默认关闭**（`notifyOnApprovalResult: false`），仅允许主对话显式启用；子代理结果回执始终禁用（派发书 §1、§2.6）。
- 不新增第三方运行时依赖；继续走 Node → 隐藏 `powershell.exe` 5.1 → WinRT ToastGeneric（派发书 §2.5）。
- 不改动审批 URI 协议、`requestToken`、退出码、超时动作或审计语义（派发书 §2.7 末段）。

### 1.3 "完成"的准确含义（派发书 §2.1 原文）

> 模型完成一次回复，不等于用户所有任务目标已达成，也不等于全部后台子代理都已结束。

因此通知文案使用"**本轮回复已完成**"，**不**无条件声称"项目已完成"。通知表达的是"一次执行结束"，**不**表达"所有数据已落盘"（派发书 §2.2 原文）。

【计划 0.4.0-rc.1】的通知边界（派发书 §2.1）：

| 主会话 `turn/end.data.reason.kind` | 是否通知 | 文案 |
|---|---|---|
| `completed`（且该轮确有 `step/start`） | 是，成功通知 | 见 §3.1 |
| `error` | 是，非成功 | "本轮执行出错" |
| `blocked` | 是，非成功 | "本轮执行受阻" |
| `max-tokens` | 是，非成功 | "本轮达到输出上限" |
| `aborted`（用户取消） | **否，默认静默** | — |
| `interrupted`（历史修复）、`forked`（fork seed）、未知原因 | **否**，不显示成功 | — |

等待审批、单个工具完成、单个 step 完成都**不算**一轮结束（派发书 §2.1）。子代理的 `completed` / `aborted` / `error` / `max-tokens` / `refusal` 及 continuation **均静默**。

---

## 2. 配置

### 2.1 为什么配置必须写全

`dsh-approval-center` 的 `cordis.patch.yml` 文件头已写明（`cordis.patch.yml:15-17`）：

> ⚠ 覆盖本配置时请用「id 定向补丁」而不是 insert，并把字段写全：
> DSH 的 patch 语义是 config 整体替换、不做深合并，缺的字段会落回 schema 默认值
> （例如只写 timeoutSec 会让 tools 变回 `['*']`，即拦截全部审批）。

README 现有"配置"章节（`README.md:190-194`）表达同一约束。**提醒 id 定向补丁会整体替换 `config`，不能只写一个新字段而意外重置 `tools` / `timeoutAction` 等审批设置**（派发书 §2.6）。下面的配置块因此列全所有字段。

### 2.2 完整 profile 配置（可直接复制）

写入**目标 profile 的 `cordis.patch.yml`**（按 `id` 覆盖，不要用 `insert`——`insert` 会挂载两次）：

```yaml
# profile 的 cordis.patch.yml：按 id 覆盖，不要写 insert
- id: approval-center
  name: dsh-approval-center
  config:
    # ---- 审批（本轮不改变审批交互，取值沿用出厂 cordis.patch.yml）----
    tools: ['*']                        # 认领哪些工具的审批请求；'*'=全部，支持 'bash*' 前缀通配
    timeoutSec: 60                      # 审批等待秒数
    timeoutAction: reject               # reject=超时自动拒绝（fail-closed，默认，安全）；approve=超时自动批准（危险）
    queueMode: parallel                 # serial=串行；parallel=并列（信号量上限 3）
    dataDir: ''                         # 审批记录目录；''=默认 $DSH_HOME/approval-center

    # ---- 主对话通知（计划 0.4.0-rc.1 新增）----
    notifyOnTurnEnd: true               # 主对话一轮回复正常结束时通知
    notifyOnTurnFailure: true           # 主对话异常终态时通知
    taskNotificationSound: silent       # silent=静音；default=系统默认提示音
    taskNotificationShowTitle: true     # true=显示会话标题；false=仅显示会话短 ID

    # ---- 审批结果回执 ----
    notifyOnApprovalResult: false       # 默认关；仅主对话可显式开启

    # ---- 弃用兼容字段（保留仅为不打断旧配置；设为 true 也强制不生效）----
    notifyOnSubagentStart: false        # 弃用：子代理启动通知
    notifyOnSubagentEnd: false          # 弃用：子代理结束通知
```

> **结构对照证据**：键路径 `- id: <id>` / `  name: <包名>` / `  config:` / `    <字段>: <值>` 与本仓库 `cordis.patch.yml:18-33` 的 `insert` 块内层结构一致（该文件是 `package.json` 的 `dsh.bundle.patch` 指向的出厂补丁），也与 `README.md:196-211` 的"id 定向补丁"示例一致。`config` 下每个字段名与 `src/index.ts:34-51` 的 `Config` schema 一一对应。

### 2.3 字段说明

| 字段 | 类型 | schema 默认值（`src/index.ts:34-51`） | 出厂补丁值（`cordis.patch.yml:21-33`） | 含义与注意事项 |
|---|---|---|---|---|
| `tools` | `string[]` | `['*']` | `['*']` | 拦截哪些工具的审批请求。`'*'` 全部；`'bash*'` 前缀通配；其余全等匹配（`src/host-contract.ts:39-45`）。**不匹配的请求 `next()` 转交**（如 Web GUI 面板）。写 `fs*` 匹配不到任何工具——文件写操作的真实工具名是 `write` / `edit`。 |
| `timeoutSec` | `number` | `30` | `60` | 审批等待秒数。到期后按 `timeoutAction` 结算。 |
| `timeoutAction` | `'reject' \| 'approve'` | `'reject'` | `reject` | `reject`=超时自动拒绝（fail-closed）；`approve`=超时自动批准（危险，见 §4.4）。**只作用于 `timeout`**；渠道故障（`unavailable`）永远 fail-closed（`src/index.ts:101-104`）。 |
| `queueMode` | `'serial' \| 'parallel'` | `'serial'` | `parallel` | `serial`=串行排队；`parallel`=并列弹出，信号量上限 3（`src/index.ts:41-42`）。 |
| `dataDir` | `string` | `''` | 未写（落回 `''`） | 审批记录目录。`''` 时用 `$DSH_HOME/approval-center`（未设 `DSH_HOME` 时 `~/.dsh/approval-center`，`src/index.ts:77-82`）。同一 `dataDir` 只允许一个活跃实例。 |
| `notifyOnTurnEnd` | `boolean` | **【计划】`true`** | **【计划】新增** | 主对话一轮回复正常结束（`completed` 且有 `step/start`）时通知。 |
| `notifyOnTurnFailure` | `boolean` | **【计划】`true`** | **【计划】新增** | 主对话异常终态时通知（见 §1.3 表格）。 |
| `taskNotificationSound` | `'silent' \| 'default'` | **【计划】`'silent'`** | **【计划】新增** | `silent`=静音；`default`=系统默认提示音。底层见 §3.2。 |
| `taskNotificationShowTitle` | `boolean` | **【计划】`true`** | **【计划】新增** | `true`=通知显示会话标题；`false`=仅显示会话短 ID。隐私影响见 §3.3。 |
| `notifyOnApprovalResult` | `boolean` | `false` | `false` | 审批结算后发结果回执。默认关；**仅主对话可显式开启**。 |
| `notifyOnSubagentStart` | `boolean` | `false` | `false` | **弃用兼容字段。设 `true` 也强制不生效。** |
| `notifyOnSubagentEnd` | `boolean` | `false` | `false` | **弃用兼容字段。设 `true` 也强制不生效。** |

> **【计划 0.4.0-rc.1】字段默认值的确切来源**：派发书 §2.6 原文"新增 notifyOnTurnEnd=true……notifyOnFailure=true……taskNotificationSound='silent'（silent/default）……taskNotificationShowTitle=true（设 false 仅短 ID）"。
> **【已实现并核对】**：`src/index.ts` 的 Config schema 已按上述默认值落地（`notifyOnTurnEnd`/`notifyOnTurnFailure` 默认 `true`，`taskNotificationSound` 默认 `'silent'`，`taskNotificationShowTitle` 默认 `true`），且已由 D 的集成测试用例 T3-8 逐项投影验证。
> **【已裁决，不再开放】**：默认开启主完成/错误通知是**用户的修订需求**，不是待定项——R2 派发书已裁决"主完成/错误默认开启且静音"，**无需再次询问用户**。因此"只看审批"场景 ① 是**需要显式关闭两个新开关**的推荐配置，而非零配置默认；默认开箱行为是"审批 + 完成 + 错误（静音）"。

### 2.4 两个场景配置

> **【已裁决】**：默认值张力已由用户修订需求关闭（见上）。升级后开箱即收到主对话审批、完成与错误通知（均静音横幅）；若只想保留审批，用场景 ① 显式关闭两个新开关。

#### 场景 ①：只看审批，完全安静（推荐）

只保留"必须问"的审批通知，不产生任何完成/错误通知、不发出任何提示音。

```yaml
- id: approval-center
  name: dsh-approval-center
  config:
    tools: ['*']
    timeoutSec: 60
    timeoutAction: reject
    queueMode: parallel
    dataDir: ''
    notifyOnTurnEnd: false              # 关闭本轮完成通知
    notifyOnTurnFailure: false          # 关闭本轮错误通知
    taskNotificationSound: silent
    taskNotificationShowTitle: true     # 无完成/错误通知时此项无实际影响
    notifyOnApprovalResult: false
    notifyOnSubagentStart: false
    notifyOnSubagentEnd: false
```

效果：只剩审批卡片（`dsh-approval` 组）。`timeoutAction: reject` 下超时=自动拒绝，不会放行。

#### 场景 ②：审批 + 完成 + 错误，静音横幅

```yaml
- id: approval-center
  name: dsh-approval-center
  config:
    tools: ['*']
    timeoutSec: 60
    timeoutAction: reject
    queueMode: parallel
    dataDir: ''
    notifyOnTurnEnd: true
    notifyOnTurnFailure: true
    taskNotificationSound: silent       # 静音：不播放系统提示音
    taskNotificationShowTitle: false    # 仅显示会话短 ID（隐私优先）
    notifyOnApprovalResult: false
    notifyOnSubagentStart: false        # 弃用，始终无效
    notifyOnSubagentEnd: false          # 弃用，始终无效
```

效果：审批卡片 + 本轮完成通知 + 本轮错误通知；三者都静音出现；完成/错误通知不显示会话标题，只显示短 ID。

> 想要完成/错误通知**带系统提示音**时，把 `taskNotificationSound` 改为 `default`。审批卡片的声音行为**不在本轮改动范围**（派发书 §2.6："审批请求保留现有声音行为，不在本轮擅自改变审批交互"）。

---

## 3. 通知行为

### 3.1 文案（派发书 §2.3）

| 场景 | 标题 | 正文 |
|---|---|---|
| 本轮完成 | `本轮回复已完成` | `任务：<会话标题>` 换行 `Agent 已完成这一轮回复，请返回 DSH 查看。` |
| 本轮执行失败 | （派发书未单列标题；非成功终态的标题以 T0/A 冻结为准） | `任务：<会话标题>` 换行 `本轮执行失败，请返回 DSH 查看详情。` |

- 会话标题来源：最新 `session/title.data.title` → 取不到时回退 `会话 <短ID>`（派发书 §2.3）。**禁止假设 `session.title` 存在。**
- 原始异常堆栈**不**进通知（派发书 §2.3 原文："不把原始异常堆栈直接塞进通知"）。

### 3.2 静音 vs 系统默认提示音

- `taskNotificationSound: silent` → 通知 XML 使用 Toast `<audio silent="true"/>`（派发书 §2.5）。
- `taskNotificationSound: default` → 使用系统默认提示音。
- 派发书 §2.5：默认任务通知静音，可配置系统默认提示音；依据为 Microsoft 的 [应用通知内容](https://learn.microsoft.com/windows/apps/develop/notifications/app-notifications/app-notifications-content) 与 [`audio` 元素](https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-audio)。
- **【现 0.3.1-rc.1】** `scripts/toast.ps1` 的通知 XML（`scripts/toast.ps1:26-35`）**没有** `<audio>` 元素，也没有 silent 开关，即当前**无法静音**；`taskNotificationSound` 字段当前不存在。

### 3.3 隐私

- `taskNotificationShowTitle: true`（计划默认）→ 通知正文显示会话标题。
- `taskNotificationShowTitle: false` → 仅显示会话**短 ID**，不显示标题文本。
- **锁屏也可能展示正文**——请按"通知正文可能出现在锁屏"来评估会话标题是否敏感（派发书 §2.3："文档提示锁屏也可能展示正文"）。
- 完成 / 错误通知中**不会**出现：完整回答、工具命令、提示词、凭据、绝对目录、原始错误堆栈（派发书 §2.3）。
- **审批卡片是例外**：它允许显示宿主明确提供的操作与审批原因（见 §4）。派发书 §2.3 明确要求"不能与完成通知的隐私规则混淆"。

### 3.4 截断规则（派发书 §2.3）

- 归一化控制字符与换行。
- 任务名：**建议**限制 **60 个 Unicode 字符**；正文限制 **160 字符**。
- 超过以省略号截断；**截断不能切坏代理对**（surrogate pair）。
- XML 转义复用并补充测试。

---

## 4. 审批卡片说明

### 4.1 结构化内容模板（【计划 0.4.0-rc.1】，派发书 §2.7）

```
需要你审批 · <工具名>
任务：<会话标题 或 会话短ID>
操作：<宿主工具名 / 明确操作摘要>
原因：<displayReason 的 zh-CN → zh → reason → en 回退>
选择：批准=本次允许；拒绝=不允许执行
等待：<timeoutSec>秒；超时=<按实际配置自动拒绝/自动批准>
```

字段顺序与派发书 §2.7 原文一致（标题 → 任务 → 操作 → 原因 → 选择 → 等待）。

### 4.2 完整示例（派发书 §2.7 原文示例）

```
需要你审批 · bash
任务：修复登录问题
操作：bash
原因：需要执行沙箱外操作
选择：批准=本次允许；拒绝=不允许执行
等待：60秒；超时=自动拒绝
```

### 4.3 每个字段的含义

| 字段 | 含义 | 注意 |
|---|---|---|
| 标题 `需要你审批 · <工具名>` | 谁在问、问什么工具 | **工具名不是命令**，不假装已展示命令（派发书 §2.7） |
| `任务：` | 会话标题；取不到标题时用会话短 ID | 短 ID 保证能识别来源（派发书 §2.7 末段） |
| `操作：` | 宿主工具名或明确的操作摘要 | 原始请求**没有**工具参数/命令字段时，**不能**额外拼接未核实字段，也**不能**从日志抓取（派发书 §2.7） |
| `原因：` | `displayReason` 按 `zh-CN → zh → reason → en` 回退链取值（与 `src/host-contract.ts:59-67` 冻结的回退链一致） | 原因缺失时显示 `宿主未提供审批原因`。**原始 `reason` 仍用于审计**，中文 `displayReason` 仅用于展示（`src/index.ts:131`、`src/host-contract.ts:15-16`） |
| `选择：批准=本次允许；拒绝=不允许执行` | 两个按钮各自的语义 | **"批准=本次允许"**，**不得**把批准描述成永久授权（派发书 §2.7） |
| `等待：<timeoutSec>秒；超时=…` | 等待时长与超时动作 | 必须按**实际配置**写：`timeoutAction: reject` → "超时=自动拒绝"；`approve` → "**超时自动批准**" |

### 4.4 必须遵守的文案约束（派发书 §2.7）

1. **`timeoutAction: approve` 时必须醒目写"超时自动批准"，不得写默认拒绝文案。**
2. 原因缺失时显示 **`宿主未提供审批原因`**。
3. **工具名不是命令**，不假装已展示命令。
4. **批准 = 本次允许**，不得描述成永久授权。
5. 原因过长可合理截断，但必须**显式标记** **`已截断，请在 DSH 查看完整内容`**。
6. 屏幕空间由系统控制，不保证每行无限展开；禁止隐藏风险、写反按钮，或用无限正文挤掉"选择"的含义。
7. 审批卡片改动**不得**改变 URI 参数、`requestToken`、退出码、超时动作或审计语义。
8. 审批卡片**保留批准/拒绝按钮**（派发书 §2.7）。

> **【现 0.3.1-rc.1】当前审批卡片文案**（供 A 对照差异）：标题 `审批请求 · <toolName>`；正文为 `代理: <短ID>` / `操作: <toolName>` / `原因: <displayReason>`（`src/index.ts:146-158`）。当前**没有**"任务 / 选择 / 等待"三行，也没有"已截断"标记；超时动作虽已由 `approval-toast.ps1` 执行，但当前卡片正文未把超时动作写出来。

---

## 5. 升级与回滚

### 5.1 从 `0.3.1-rc.1` 升级到计划版

前置：`dsh --version` 为 `0.1.7-rc.2`、Node ≥ 24、PATH 上有 `pnpm`（README:19-27、126-127）。

```powershell
# 1) 停止宿主进程（dsh web 未开 HMR 时配置变化必须重启才生效，README:146-153）
# 2) 等当前审批结算后，备份目标 profile 的配置、package/lock/patch 文件及审计目录
# 3) 卸载旧版
dsh plugin --profile web remove dsh-approval-center
# 4) 安装计划版
dsh plugin --profile web add <0.4.0-rc.1 的 .tgz 路径或 Release URL>   # PENDING-2
# 5) 核验只挂载一个实例
dsh --profile web --dump-config | Select-String 'dsh-approval-center'
# 6) 重启宿主
```

- 安装命令形式沿用 README 现有写法（方式 A：`dsh plugin --profile web add <Release tgz URL>`，`README.md:76`；方式 B：先校验 SHA256 再本地安装，`README.md:93-98`）。
- **同一 `dataDir` 只允许一个新版实例**；升级前须先停旧实例，不要新旧混跑（`README.md:177`）。
- **PENDING-2**：`0.4.0-rc.1` 的 tgz 文件名、Release URL 与 SHA256 尚不存在，必须等 A 完成候选构建与签收后填入。派发书 §2.6："现有 0.3.1-rc.1 Release、tag 与附件保持不变"。
- **不新增通知 SQLite 表**；审批数据库 schema 不变（派发书 §2.7 末段 + §2.4："不新增通知 SQLite 表"）。因此升级不需要数据库迁移步骤。
- 备份与 WAL 细节沿用现有清单（`README.md:179-184`、`docs/compat/drafts/store-and-rollback.md`）。

### 5.2 回滚

```powershell
# 1) 停止宿主
dsh plugin --profile web remove dsh-approval-center
# 2) 重新安装 0.3.1-rc.1 的 tgz
dsh plugin --profile web add https://github.com/xmwpoi/dsh-approval-center/releases/download/v0.3.1-rc.1/dsh-approval-center-0.3.1-rc.1.tgz
# 3) 核验实例唯一并重启宿主
```

- 回滚后 `notifyOnTurnEnd` / `notifyOnTurnFailure` / `taskNotificationSound` / `taskNotificationShowTitle` 会被旧版 schema 忽略（旧版 `Config` 不含这些字段，`src/index.ts:34-51`）；旧版**没有**通知去重缓存与通知队列，这些状态也不落盘，无需清理。
- 旧子代理开关在旧版下**会重新生效**——回滚前请把它们保持为 `false`，否则回滚后会重新收到子代理通知。

### 5.3 历史通知不会被自动清除

- 关闭的是**后续发送**。旧子代理通知的既有历史记录**不会**被自动清除（派发书 §2.7 末段）。
- 插件**不使用** `History.Clear` 去清掉主审批记录：此前随机 tag 无法可靠归属（派发书 §2.7 末段）。**已有历史由用户手动清除。**
- 通知组隔离保持不变：`dsh-approval` = 审批请求，`dsh-result` = 旧结果回执，新增 `dsh-task` = 主对话完成/错误通知（派发书 §2.4）。三者分开管理，清理审批时不会误删其他组。

---

## 6. 已知限制

以下每条均来自派发书原文，逐条标注出处。

1. **热加载中途没观察到 `step/start` 的轮次，首版不补发完成提醒**（派发书 §2.2："热加载中途没有观察到 step/start 的轮次首版不补发完成提醒；这个限制写入文档"）。
2. **卸载时停止监听并丢弃待发通知，不补播历史**（派发书 §2.2）。
3. **任务通知没有批准/拒绝按钮，也没有"点击打开特定任务"的跳转。** 派发书 §2.5："第一版通知没有批准/拒绝按钮，没有'点击打开特定任务'的协议跳转，避免与审批 URI 共用解析逻辑。任务跳转及自定义图标后续独立设计。"
   - 此条**只针对完成/错误通知**；审批卡片**保留**批准/拒绝按钮（§4.4 第 8 条）。
4. **去重是有界 TTL 缓存**（建议 24h、最多 4096 项）。容量淘汰后**不提供永久 exactly-once**，也**不承诺跨进程严格去重**（派发书 §2.4）。
   - 同一轮完成/错误只取宿主真实终态一次，不双报；同一 key 在同进程生命周期内最多入队一次。
   - 缓存去重与实际投递都是 best-effort，**无法保证被 Windows 阻止后补发**（派发书 §2.4）。
5. **队列只有 1 个 PowerShell worker，最多 100 条待发；溢出丢弃最新**（派发书 §2.4）。进程 watchdog **建议** 10 秒。
6. **不自动重试。** 派发书 §2.4 原文："第一版不自动重试，因为 WinRT 已接收而进程超时的情形不能证明未发送，重试可能重复响铃。"
7. **系统关闭通知、勿扰/专注模式或权限限制可使横幅不出现。** 派发书 §2.5："发送成功只代表 API 提交，不能保证用户看到或听到。"
8. **大量不同任务由 Windows 自行折叠。** 派发书 §2.4："截图里的'+20 个通知'是系统呈现，不承诺精确复刻数字或外观。"
9. **通知发送自身失败只记录日志，不再发送错误通知**，以免递归弹窗和失败提示音（派发书 §2.3）。
10. 通知异常**不改变**审批结果、模型结果或 SQLite 审批记录（派发书 §2.4）。
11. 通知表达执行结束，**不**表达"所有数据已落盘"（派发书 §2.2）。
12. 保留现有 AUMID 与应用显示名，第一版不更名、不改 URI（派发书 §2.5）。

---

## 7. 给 A 的落地备注

### 7.1 README 需要**删除**的旧内容

| 位置（`README.md`） | 内容 | 处理 |
|---|---|---|
| 第 5 行 | 介绍里的"以及可选的任务启动/结束通知" | 删除，改为"主对话审批 + 本轮回复完成 + 本轮执行错误" |
| 第 7 行 | "任务通知和结果回执需在配置中开启" | 改写（计划默认开启完成/错误通知） |
| 第 31-36 行（"功能"表） | `审批结果回执` / `任务结束通知`（`subagent/end`）/ `任务启动通知`（`subagent/start`）三行 | **删除子代理两行**；结果回执行标注"默认关，仅主对话可开启"；新增"本轮回复完成"/"本轮执行错误"两行 |
| 第 83 行 | "……两个监听器抢同一 waterfall，完成通知还会发两遍" | 保留机制说明，但"完成通知"措辞需按新语义调整 |
| 第 204-211 行（配置示例） | `notifyOnSubagentEnd` / `notifyOnSubagentStart` 注释"默认关：只保留必须问的审批通知" | 替换为 §2.2 的完整配置块；弃用字段注明"即使 true 也强制不生效" |
| 第 207 行注释 | `notifyOnApprovalResult: false  # 默认关（想要审批结果回执就改 true）` | 补"仅主对话可开启" |
| 第 238 行 | "子代理事件文案有自动覆盖" | 与"子代理一律不通知"冲突，需改写 |
| 第 258-259 行 | "`dsh-result` 组是审批结果回执（默认已关）" | 补充 `dsh-task` 组说明 |
| 第 9 行 | "当前预发布：`0.3.1-rc.1`" 横幅 | A 在验收后按新版本号改写 |

### 7.2 README 需要**新增**的章节

1. **定位与范围**（§1）：一句话定位 + "不做什么"（子代理全静默、弃用字段强制无效）+ "完成"的准确含义。
2. **完整 profile 配置**（§2）：§2.2 的完整块 + 字段表 + 两个场景。
3. **通知行为**（§3）：文案、静音/默认音、隐私（含锁屏提示）、截断规则。
4. **审批卡片说明**（§4）：模板 + 示例 + 字段含义 + 文案约束（尤其 `timeoutAction=approve` 的"超时自动批准"）。
5. **升级与回滚**（§5）：含"不新增通知 SQLite 表""历史不自动清除""不用 `History.Clear`"。
6. **已知限制**（§6）：整节并入现有"验证与已知限制"。

### 7.3 PENDING 清单（R2 更新：已关闭项标 ✅，仍开放项标 ⏳）

> 更新说明（R2）：以下状态以 **A 已提交基线 `222e38af…`** 与 **候选包 `F7C6E74E…`** 的实测为准。
> 原则：**已关闭的不抹掉记录，仍开放的不过期**。

| ID | PENDING 项 | 状态 | 依据 |
|---|---|---|---|
| ~~PENDING-1~~ | 场景 ① 是否为"默认推荐" | ✅ **已关闭** | 用户修订需求已裁决"主完成/错误默认开启且静音"（R2 派发书 §当前裁决 1）。默认值 `true/true` 是需求，不是待定项；见 §2.3/§2.4。 |
| PENDING-2 | `0.4.0-rc.1` 版本号、tgz、Release URL、SHA256 | ⏳ 开放 | 候选包 `F7C6E74E…`（77254 B）已存在但为**待修订候选**（R2 派发书 §当前裁决 3），不得作为实机签收包。 |
| ~~PENDING-3~~ | 四个新字段 schema 默认值与投影 | ✅ **已关闭** | `src/index.ts` 已落地 `true/true/'silent'/true`；D 的 T3-8 集成用例逐项验证投影（含 `-Sound default`、短 ID 回退）。 |
| ~~PENDING-4~~ | 弃用字段保留与弃用日志 | ✅ **已关闭** | `src/index.ts` 保留两字段并打 `@deprecated`，旧开关 `true` 时打印弃用告警且强制无效；D 的 T3-4 用例验证 `true` 仍零通知零进程。 |
| PENDING-5 | 完成/错误通知的标题文案与最终 XML 结构 | ⏳ 开放 | 错误标题已实现为 `本轮执行出错`（D 的 T3-5 验证）；但**审批卡片 XML 布局未同步**——候选包 `approval-toast.ps1:363-365` 仍是 `标题 + 单个 <text>$Message</text>`，与 C 所述独立 text 布局不一致（R2 派发书 §当前裁决 6）。**发布阻断**。 |
| ~~PENDING-6~~ | `taskNotificationSound: default` 的 XML 写法 | ✅ **已关闭** | 候选包 `scripts/toast.ps1:75-77` 实测：`silent` → `<audio silent="true"/>`；`default` → `<audio src="ms-winsoundevent:Notification.Default"/>`；缺省 = 不写 `<audio>`（保持旧结果回执行为）。 |
| PENDING-7 | 审批卡片"操作摘要"取值来源 | ⏳ 开放 | 当前实现用宿主工具名（D 实抓卡片 `操作：bash`），未拼接命令；是否符合"明确操作摘要"待 A 裁决。 |
| PENDING-8 | 会话短 ID 位数与规则 | ⏳ 开放 | 实现为前 8 位（D 的 T-2/T-6 验证 `abcdefgh`/`t6-reloa`）；未在派发书规定，沿用现状。 |
| PENDING-9 | TTL 24h/4096、watchdog 10s 是否最终值 | ⏳ 开放 | 实现为默认 24h/4096/10s（B 的实现 + D 的 P7/P8/P10 探针验证上界），"建议"措辞仍待 A 冻结。 |
| PENDING-10 | 测试计数 | ✅ **部分关闭** | A 基线 `222e38a`：**单测 196/196、集成 31/31**（21 既有 + 10 A 通知用例）；D 独立新增 **23+12+7+7 = 49**（其中与 A 10 用例语义重叠 10 项，去重后新增约 39 项）。矩阵见 `r2-independent-review.md`。 |
| PENDING-11 | 真实主/子会话实机结论 | ⏳ 开放 | 未执行。**5 条通道级测试不得当作真实会话通过**（R2 派发书 §当前裁决 4）。 |
| PENDING-12 | `dataDir` 是否保留 | ✅ **已关闭** | 实现保留 `dataDir`（`src/index.ts` Config），集成测试全部走隔离 `dataDir`。 |
| **R2-新增** | 真实 `AgentRegistry` 服务注入 | ✅ **已关闭（原发布阻断）** | D 新增 `test/integration/agent-registry.test.js`：真实 `AgentRegistry` 服务 + 真实 `register()` 效果链，7/7 通过（仅 id 认领主会话、子代理 next、unknown/服务缺失/已注销 next 恰一次）。 |
| **R2-新增** | `snapshotEvents` 已弃用仍被插件调用 | ⏳ 开放（A 契约修订） | 目标版原文 `@deprecated … new calls are prohibited`（`lib/types/index.d.ts:186-189`）。受支持替代：`SessionTitleService.get(session)`（无弃用标记）。行为上 D 的 T-1/T-2/T-4 已验证现有实现正确；**API 选择归 A 契约修订**，D 不代决。 |
| **R2-新增** | `package.json` description 仍称 "parallel subagents" | ⏳ 开放（A 修） | 候选包 `package.json` 的 description 字节级含 `parallel subagents`（已排除控制台乱码干扰），与本轮"子代理通知整体关闭"矛盾。 |
| **R2-新增** | `scripts/toast.ps1` 为 LF-only，无换行门 | ⏳ 开放（A 修） | 候选包内 `toast.ps1` 为 LF（与提交 blob 一致），而 `approval-toast.ps1` 为 CRLF——同包混用；且 `test/`、`.github/` **没有任何换行门**。影响：`npm pack` 自正常 checkout 会得到不同 hash（实测 `433AA74F…` ≠ 候选 `F7C6E74E…`）。 |

---

## 附录：本文的事实来源与核对证据

| 结论 | 来源 |
|---|---|
| 当前 `Config` 的 8 个字段、默认值与类型 | `src/index.ts:34-62` |
| 当前 `dataDir` 默认解析 | `src/index.ts:77-82` |
| 当前审批卡片标题/正文 | `src/index.ts:146-158` |
| 当前 `approval/request` 认领逻辑（不区分主/子会话） | `src/index.ts:199-202` |
| 当前 `subagent/end`、`subagent/start` 通知**确实生效** | `src/index.ts:204-214` |
| 当前挂载期脚本校验清单 | `src/index.ts:115-121` |
| `displayReason` 回退链 `zh-CN → zh → reason → en` | `src/host-contract.ts:59-67` |
| `tools` 匹配语义（`*` / `prefix*` / 全等） | `src/host-contract.ts:39-45` |
| 审计保存原始 `reason`，`displayReason` 仅展示 | `src/host-contract.ts:15-16`、`src/index.ts:131` |
| 当前结果回执/子代理通知走 `showToast` → `scripts/toast.ps1` | `src/dialog.ts:343-364` |
| 当前 `toast.ps1` 无 `<audio>`/静音开关、Tag 随机 GUID、Group `dsh-result` | `scripts/toast.ps1:26-49` |
| 当前审批通知 Group `dsh-approval`、Tag = requestToken、批准/拒绝按钮 | `scripts/approval-toast.ps1:61`、`scripts/approval-toast.ps1:359-379`、`src/dialog.ts:238-246` |
| 出厂补丁 config 结构与取值 | `cordis.patch.yml:15-33` |
| profile 覆盖须"id 定向补丁 + 字段写全" | `cordis.patch.yml:15-17`、`README.md:190-211` |
| 安装命令形式 | `README.md:73-98` |
| 同一 `dataDir` 单实例、升级前置 | `README.md:177-184`、`docs/compat/drafts/store-and-rollback.md:23-41` |
| 计划版行为、默认值、文案、限制、升级回滚语义 | `D:\codex\dsh-task-completion-notification-plan.md` §1、§2.1–§2.7、§5 N4 |

### 本文未做的事（边界声明）

- 未修改 `README.md`、`CHANGELOG.md`、`cordis.patch.yml`、`src/**`、`test/**`、`package.json`（所有权属 A/B/C）。
- 未启动任何真实通知、未改 HKCU、未 spawn 真实 `powershell.exe`。
- 未做任何实机验证；本文所有【计划 0.4.0-rc.1】条目均为**计划**，不代表已实现或已通过测试。
