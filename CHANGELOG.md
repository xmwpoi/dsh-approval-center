# Changelog

## 0.4.0-rc.1（未发布，候选）

**通知范围收窄为主对话：关闭全部子代理通知。**

### 破坏性变更

- **移除子代理通知**：`subagent/start`、`subagent/end` 的发送监听已删除。
  旧字段 `notifyOnSubagentStart` / `notifyOnSubagentEnd` 保留为**弃用兼容字段**，
  即使旧配置写 `true` 也**强制不生效**（仅在挂载时限频告警一次），
  不会产生任何通知或 PowerShell 进程。请从 profile 配置中删除这两个字段。

### 新增

- **主对话本轮完成通知**（`notifyOnTurnEnd`，默认 `true`）：主会话完成一次实际执行的
  一轮时提示"本轮回复已完成"。只在宿主 `turn/end` 的真实终态为 `completed`、
  且该轮确有 `step/start` 时发送；热加载中途接入、未观察到 step 的轮次首版不补发。
- **主对话本轮异常通知**（`notifyOnTurnFailure`，默认 `true`）：`error` / `blocked` /
  `max-tokens` 分别提示"本轮执行出错 / 受阻 / 达到输出上限"，**不谎报成功**。
- **`taskNotificationSound`**（`silent` 默认 / `default`）：任务通知默认静音，
  可显式改用系统默认提示音。审批通知的声音行为**不变**。
- **`taskNotificationShowTitle`**（默认 `true`）：设 `false` 时只显示会话短 ID。
- **独立 `NotificationService`**：不借用审批队列；任何通知异常**不改变**审批结果、
  模型结果或 SQLite 审批记录。含 1 个串行发送 worker、待发上限 100、单条看门狗 10 秒、
  溢出丢弃最新并限频告警；**不自动重试**（WinRT 已接收而进程超时时重试会重复响铃）。
- **有界 TTL 去重**：key = `sessionId + turn`，TTL 24h、容量 4096，容量淘汰后不承诺永久
  exactly-once；不新增通知 SQLite 表，不承诺跨进程严格去重。
- **通知隔离**：任务通知固定 `Group='dsh-task'`、Tag 为 key 哈希的前 16 位十六进制，
  与审批 `dsh-approval`、旧结果 `dsh-result` 互不干扰。

### 变更

- **主审批卡片改为固定安全信息优先的结构化三 `<text>`**（R5）：标题"需要你审批 · 批准仅本次"
  （**固定**，不含工具名）→ **decisionSummary**（`拒绝不执行；<N>秒后自动拒绝|批准`，
  排最前且**不参与截断**）→ **contextSummary**（`任务：…` / `操作：…` / `原因：…`，
  各字段独立限宽 20/20/36 码点）。批准明确写作**本次允许**（不是永久授权）；
  `timeoutAction=approve` 时如实写"自动批准"，绝不沿用拒绝文案；
  原因缺失显示"宿主未提供审批原因"；摘要超限时显式标记"（摘要，详情见 DSH）"。
  **工具名不是命令**，卡片不拼接未核实的命令或参数。审批的 URI 参数、`requestToken`、
  退出码、超时动作与审计语义**均未改变**。旧调用（结果回执/手动脚本）不传新参数，走 legacy 路径。
- **审批只认领主会话**：先按公开面解析请求对应的真实 Session，再以
  `header.origin === 'subagent'` 判定。子代理审批与**身份无法可靠确认**的请求一律不认领
  （不入队列、不建审计记录、不弹窗），`next()` 恰一次交宿主其他应答者，
  **绝不静默自动批准或拒绝**。
- **子代理事件在入队前过滤**：不占队列位、不建去重项、不产生发送进程。
- 隐私：完成/错误通知只含任务名与固定文案，不含回答正文、工具命令、提示词、凭据、
  绝对目录或原始异常堆栈；文本按 **Unicode 码点**截断，不切坏代理对。

### 已知限制

- "完成"指**主会话完成一次实际执行的一轮**，不代表用户所有任务目标已达成，
  也不代表后台子代理都已结束。
- 通知 API 成功只代表**已提交**给 Windows；系统关闭通知、勿扰/专注模式或权限限制
  都会让横幅不出现，**不保证用户看到或听到**。
- 第一版任务通知**没有**批准/拒绝按钮，**没有**"点击打开特定任务"的跳转。
- 热加载中途未观察到 `step/start` 的轮次**不补发**完成提醒；卸载时丢弃待发通知，
  **不补播历史**。
- 旧子代理通知**不自动批量清除**（此前随机 tag 无法可靠归属，不用 `History.Clear`
  清掉主审批记录）；关闭的是后续发送，已有历史请手动清除。

## 0.3.1-rc.1（GitHub 预发布，2026-09-30）

- 将宿主 peer 精确限定为 DSH `0.1.7-rc.2`；保留现有 Windows 通知架构。
- 对齐 `displayReason` 展示、审批队列取消/卸载、通知定向清理与 SQLite 单实例审计恢复；审计结算失败时不放行，也不显示“已批准”。
- GitHub Actions 修复后通过 98/98 单测、21/21 目标版真实宿主非交互集成（0 fail、0 skip）；首轮 CI 的 95/98 失败记录保留在仓库证据中。Unicode 候选的受影响 Windows 通知/URI 实机复测已由 C 签收；V16 完整真实子代理会话、大批次实机及生产升级后回装演练仍待完成。

### 重打包（T6 收口 + ISSUE-1 修复）

版本号维持 `0.3.1-rc.1`，但**入包文件已变更**，故此前的候选包 SHA256 作废，须以本段对应的重打包产物为准。

- **ISSUE-1（T6 实机发现，基线既有缺陷）后续修正**：首轮修复把 `<id>.dir` 映射改写为 ANSI，在中文本机代码页实机通过，但英文 Windows CI 无法用 ANSI 表示中文私有 `StateDir`。现改用带 BOM 的 UTF-16 LE，并让 VBS/PowerShell 处理器与清理路径显式按同一格式读取；远端 Windows CI 和受影响实机路径均通过。
- **`-CleanupToken` 定向清理补测**：中文私有 `StateDir` 下经映射双清（`.pending` + 通知），新增 `test/dialog.unicode-mapping.test.js` 5 项回归测试并纳入 `test:unit`（93 → 98 项）。
- **T6 实机证据归档**：`docs/compat/evidence/windows/t6/`（S1–S14 + E 系列、环境基线、恢复自检）。
- **发布文档**：补齐项目介绍、固定版本下载/安装、SHA256 校验、升级/回滚与验证边界。仅文档重打包须核运行文件与已验收候选一致，Release 附件 SHA 以该次发布校验清单为准。

## 0.3.0

**破坏性变更：删除 WinForms 模态对话框，审批改为完全走 Windows 通知中心。**

### 变更

- **审批范围＝完全镜像系统判断**：插件只对 `approval/request` 收到的请求弹通知，
  不自行放宽或收紧策略。出厂 `tools` 从 `['pwsh*','write','edit']` 改为 `['*']`，
  避免将来出现新请求源时被漏掉。
  （背景：本部署 `workspace-write` + `ask` 下，唯一的请求源是模型显式沙箱提权
  `sandbox_permissions` + `justification`；工作区外的写入是**直接拒绝**、不是询问。）
- **只保留"必须问"的审批通知**：`notifyOnSubagentEnd` / `notifyOnSubagentStart` /
  `notifyOnApprovalResult` 三个 schema 默认值全部改为 `false`（此前完成通知与结果回执
  默认为 `true`，与"只在需要审批时打扰我"冲突）。想要回执可显式开启。
- **挂载期校验 `.vbs` 处理器**：`APPROVAL_URI_HANDLER_VBS` 纳入 `assertScriptsUsable`，
  防止打包事故让点击回传静默失效。
- **删除对话框通道**：`scripts/approval-dialog.ps1`、`showApprovalDialog`、
  `mapExitCode` 的 3=dismissed 分支、配置项 `approvalUi` 全部移除。
  屏幕中央不再弹出任何窗口。
- **审批通知重写**：新增 `scripts/approval-toast.ps1` +
  `scripts/approval-uri-handler.ps1`。
  - `scenario="reminder"`：通知停留到用户处理为止（普通 toast 约 5–10 秒离屏，
    这是旧 SnoreToast 路线拿不到按钮结果的根因）。
  - `activationType="protocol"`：未打包 Win32 应用收不到 WinRT 的
    `ToastNotification.Activated`（实测订阅成功但事件永不触发），改由 Windows 唤起
    已注册的 URI 方案 `dshapproval` → 处理器写状态文件 → 脚本轮询。
  - 首次运行在 HKCU 注册 URI 方案与 AUMID，无需管理员。
- **移除 `node-notifier` 依赖**（以及随之而来的 SnoreToast 二进制、worker 线程隔离、
  `@types/node-notifier`）。主线程不再有任何第三方运行时依赖，只剩 `schemastery`。
- 退出码契约改为：`0=批准 1=拒绝 2=超时 3=结果异常 4=投递故障`。
  新增看门狗（`timeoutSec + 15s`）强制回收卡死的子进程。
- `assertScriptsUsable` 改为校验 `approval-toast.ps1` / `approval-uri-handler.ps1`
  （以及开启通知时的 `toast.ps1`）。
- 测试脚本 `test/dialog.test.js` → `test/approval.test.js`；npm script
  `test:dialog` → `test:approval`。
- 出厂 `cordis.patch.yml` 去掉 `approvalUi`，补上 `timeoutAction: reject`。

### 已知限制（新）

- 探测不到"划掉通知"：收不到 WinRT `Dismissed` 事件，用户直接关闭通知时要等
  `timeoutSec` 到期才按超时结算。
- 超时后会把通知从操作中心移除，避免留下点了没反应的死按钮。

### 修复

- **通知从未被真正移除**（本轮最严重的隐藏缺陷）：`History.Remove(tag, appId)` 的双参重载
  只会去**空 Group** 里找，而我们的通知没有 Group → 每次都抛 `0x80070490 Element not found`，
  而 `try/catch` 把它静默吞掉。于是「启动清扫」与「结算后移除」**从来就没生效过**，实测每跑一次
  就多留一条（17 → 18 → 19）。现在给通知设显式 `Group='dsh-approval'`，改用三参重载
  `Remove(tag, group, appId)`，实测结算 17 → 17 → 17，点击后 tag 也确实消失。
- **结果回执此前无 Tag 也无 Group**：`toast.ps1` 的通知永久无法单独删除，且与审批混在同一桶里。
  现设 `Tag` + `Group='dsh-result'`，与审批（`dsh-approval`）分开管理；清扫审批时不会误删回执。
- **僵尸 reminder 通知**：`scenario="reminder"` 不会自动消失（这正是它能当审批用的原因），
  但本进程一旦在结算前被强杀——宿主重启、看门狗回收、父进程中断——屏幕上就留下一条永久弹窗
  （实测被中断的测试夹具留下了 3 小时）。现在给通知设 WinRT
  `ExpirationTime = timeoutSec + 30s`，交给 Windows 兜底收走（实测 reminder 探针 16 秒后自动
  从通知中心消失），不依赖本进程活到结算。
- **点按钮时闪出控制台窗口**：URI 处理器指向 `powershell.exe`，它是控制台子系统
  （PE subsystem=3, CUI），explorer 拉起时 Windows 会先分配并显示一个控制台窗口，
  `-WindowStyle Hidden` 来不及生效。现改为 `wscript.exe //B //Nologo`（subsystem=2, GUI）
  执行 `scripts/approval-uri-handler.vbs`——不创建控制台，且更快（wscript 32ms 返回、
  约 278ms 落盘，对比 PowerShell 的 400–500ms）。`.ps1` 处理器保留为 VBScript 不可用时的回退。
- **自定义 `-StateDir` 下点击回传失效**：处理器硬编码了默认状态目录，而 `approval-toast.ps1`
  支持 `-StateDir` → 用私有目录时点击写到了别处、审批被误判超时。现在写 `<id>.dir` 映射，
  处理器据此定位（只接受绝对路径，否则回退默认目录）；端到端实测 exit 0。
- **`.pending` 存活标记记录 owner PID**：被强杀会留下标记，纯 `Test-Path` 判定会让那条通知
  永远不被清扫。现在死 PID 视为过期，可被下次清扫回收（空/不可解析的旧格式标记仍按存活
  处理，以免误删历史通知）。
- **并发审批下 URI 方案注册竞争**（出厂 `queueMode: parallel` 直接踩到）：
  多个审批同时执行会并发写同一个注册表键，冲突抛错被外层捕获后整次审批以
  exit 4 失败——实测 4 并发即有 1 个失败（483ms）。现在注册步骤改为
  「值相同就跳过 + 冲突重试 3 次 + 失败不致命」，实测 4 并发与 6 并发均 **0 失败**。
- 插件自身 `node_modules` 清理 + `.npmrc` 增加 `omit=peer`：避免在该目录里跑
  `npm install` 时被自动安装 peerDependency `@deepseek-ai/dsh` 而灌入整棵 DSH
  依赖树（实测 17 → 161 项 / 476 MB）。

## 0.2.0

破坏性语义变更（相对 0.1.0 内部行为），版本号按惯例提升。

### 新增

- **审批结果回执进 Windows 通知中心**：审批结算后发送一条结果通知
  （已批准 / 已拒绝 / 超时自动拒绝 / 超时自动批准 / 弹窗被关闭 / 已取消 /
  渠道不可用），文案与审计语义一致，不谎报"用户拒绝"。新增配置
  `notifyOnApprovalResult`（默认 `true`）。
- **超时可配置自动批准/拒绝**：新增配置 `timeoutAction`（`'reject'` 默认 /
  `'approve'`）。倒计时结束无人应答时：默认自动拒绝（上报 unavailable，
  fail-closed）；设为 `'approve'` 时自动批准（上报 allowed-once）。
  只作用于超时；`dismissed`（用户关窗）与 `unavailable`（渠道故障）永远
  fail-closed。审计库状态保留精确的 `timeout`，可事后区分"用户点的"与
  "超时自动的"。弹窗倒计时文案如实显示"超时将自动拒绝/批准"。
- **`timeoutSec` 默认值 120 → 30**；config 字段从 7 个变为 9 个，覆盖配置时须写全。

### 修复

- **P0 对话框出厂不可见**：宿主以 `windowsHide: true` 拉起 `approval-dialog.ps1` 时，
  `ShowDialog` 创建的顶层窗口不带 `WS_VISIBLE`（实测 0.4→4.0s 十轮轮询全不可见），
  每次提权审批静默超时 → `unavailable` → 拒绝，用户屏幕上看不到任何东西。
  现于 `Add_Shown` 中显式 `ShowWindow($form.Handle, SW_SHOW)` + `SetForegroundWindow`，
  保留 `windowsHide: true`（控制台窗口仍隐藏）。
- **P2 对话框无看门狗**：超时此前完全交给 PowerShell 脚本自身的 `-TimeoutSec`，
  若进程卡住不退出（消息泵阻塞 / 杀而不死），promise 永不 settle。现与 toast 分支
  对齐：`timeoutSec + 10s` 后强制 `child.kill()` 并按 `unavailable` fail-closed。
- **P3 `showApprovalDialog` 的 `child.on('error')` 静默**：缺 powershell.exe 或被
  安全软件拦截时此前 resolve `unavailable` 但无任何告警，现补 `console.warn`。
- **P5 并行无背压**：`queueMode: parallel` 此前 N 个并发提权 = N 个 PowerShell
  进程 + N 个窗口，只受 `timeoutSec` 约束。现加信号量，最多 3 个并发弹窗，
  多余的排队等令牌。

### 变更

- **`engines.node` 从 `>=22.19.0` 提升为 `>=24.0.0`**：`src/store.ts` 依赖免 flag 的
  `node:sqlite`（Node 22 早期需要 `--experimental-sqlite`）。pnpm 对 `engines` 只警告不强制，
  低于 24 会在挂载期才失败。
- 默认审批 UI 从 toast 改为 dialog（toast 仅作 best-effort，Windows 通知速率限制下不可靠）。
- 退出码语义重定义：`0=批准 1=拒绝 2=超时 3=用户关闭 4=基础设施故障`，
  超时不谎报"用户拒绝"。
- 新增 `peerDependencies: { "@deepseek-ai/dsh": ">=0.1.7-rc.0" }`
  （可满足区间；不可满足的 peer 会让 DSH 跳过整个 bundle）。
- 文件写审批拦截修正为真实工具名 `write`/`edit`（`fs*` 匹配不到任何工具）。
- 移除已无用的 `@types/node-notifier`（主线程不再静态 import node-notifier）。
- `files` 增列 `CHANGELOG.md`；新增 `prepare`（git 安装也能构建）与 `test`
  （`tsc --noEmit`）脚本。
- 新增 `src/queue.ts` 并发上限（`maxConcurrent`，默认 3）并钳到 `>=1`。
- 挂载期脚本校验强制 PowerShell 以 UTF-8 输出，使语法错误正文可读
  （此前按 CP936 写入、父进程按 UTF-8 解码会得到乱码）。
- `showApprovalDialog` 的结算改为幂等，且 abort 已结算后看门狗不再打印
  误导性的"进程超过 Ns 未退出"告警（仍会强杀卡死的子进程）。

## 0.1.0

初始版本。
