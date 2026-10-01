# dsh-approval-center

**DeepSeek Harness（DSH）的 Windows 审批与主对话通知插件。**

在 Windows 通知中心处理 DSH 的人工审批，并接收主对话本轮完成、出错、受阻和达到输出上限的提醒。子代理通知全部关闭，减少并行任务带来的提示音干扰。

插件只处理宿主已经要求审批的操作，不扩大工具权限，也不把“本轮回复结束”视为整个任务目标完成。

> **当前版本：`0.4.0-rc.1` 预发布版，适配精确版本 DSH `0.1.7-rc.2`。**
> 通过 GitHub Releases 分发，未发布到 npm。Windows 11、100% 缩放的横幅和通知中心展开态已实测；其他环境的验证边界见下文。

## 下载

- [预发布页面与更新说明](https://github.com/xmwpoi/dsh-approval-center/releases/tag/v0.4.0-rc.1)
- [插件安装包 dsh-approval-center-0.4.0-rc.1.tgz](https://github.com/xmwpoi/dsh-approval-center/releases/download/v0.4.0-rc.1/dsh-approval-center-0.4.0-rc.1.tgz)
- [SHA256 校验清单](https://github.com/xmwpoi/dsh-approval-center/releases/download/v0.4.0-rc.1/SHA256SUMS.txt)
- [上一发布版 0.3.1-rc.1](https://github.com/xmwpoi/dsh-approval-center/releases/tag/v0.3.1-rc.1)

安装请选择 `.tgz` 附件。GitHub 自动生成的 Source code 压缩包是源码，不能替代已构建的安装包。

## 运行要求

| 组件 | 要求 |
|---|---|
| 系统 | Windows，通知中心可用；本版实测 Windows 11 26100、100% 缩放 |
| DSH | **`0.1.7-rc.2`，精确版本** |
| Node.js | **≥24**，需要 `node:sqlite` |
| 插件管理器 | PATH 上可用的 `pnpm` |
| 通知脚本 | Windows PowerShell 5.1；审批回传优先使用可用的 VBScript / wscript |

`0.1.5-rc.1` 仅有观察性回归，不构成双版本支持。更旧 Windows 上 attribution 提示的兼容行为尚未实测。

## 功能与通知范围

| 类型 | 行为 | 默认 |
|---|---|---|
| 主对话审批 | 通知上点击批准或拒绝；展示任务、操作、原因、批准范围与超时动作 | 开启，匹配全部工具的审批请求 |
| 主对话完成 | 显示“本轮回复已完成” | 开启，静音 |
| 主对话异常 | 分别显示出错、受阻、达到输出上限 | 开启，静音 |
| 主对话审批结果回执 | 审批结算后提醒 | 关闭 |
| 子代理通知 | 启动、完成、错误、审批及结果均不由本插件发送 | **始终关闭** |

旧开关 `notifyOnSubagentStart` / `notifyOnSubagentEnd` 即使设为 `true` 也无效。子代理审批交回宿主其他应答者处理，本插件不会因此自动批准或拒绝。宿主和其他软件自己的通知不受本插件控制。

任务通知默认静音；**审批通知及结果回执不受 `taskNotificationSound` 控制**，审批当前没有独立静音开关。

## 安装

先检查环境，以下示例使用 `web` profile；其他 profile 请替换名称：

```powershell
dsh --version
node --version
pnpm --version
```

### 固定 Release 安装

```powershell
dsh plugin --profile web add https://github.com/xmwpoi/dsh-approval-center/releases/download/v0.4.0-rc.1/dsh-approval-center-0.4.0-rc.1.tgz
```

也可在 DSH Web 的“插件 → 添加插件”中填写同一个 `.tgz` URL。包内包含 `lib/`，无需克隆或手动编译。

### 本地校验后安装

下载 `.tgz` 与 `SHA256SUMS.txt`，对照清单核验文件名及完整 SHA256：

```powershell
Get-FileHash -LiteralPath 'C:\Downloads\dsh-approval-center-0.4.0-rc.1.tgz' -Algorithm SHA256
dsh plugin --profile web add 'C:\Downloads\dsh-approval-center-0.4.0-rc.1.tgz'
```

安装会自动应用包中的 bundle patch。**不要再手动添加 insert**，否则会挂载两个实例。通常需停止旧宿主进程，再重新启动 `dsh web`；仅打开旧网页不算重启。

```powershell
dsh --profile web --dump-config
```

在完整配置中确认 `id: approval-center` 只有一个。首次主审批会注册当前 Windows 用户的 `dshapproval` URI 与通知应用标识；同一用户的多个安装共享注册，避免并行改指向不同目录。

如果使用多个 DSH_HOME，安装前明确设置正确的 `$env:DSH_HOME`；默认安装不必设置。安装成功但没有效果时，首先排查 profile、DSH_HOME 与实际运行的宿主进程。

## 配置

安装 bundle 的出厂配置与 schema 默认值不同：出厂 `timeoutSec: 60`、`queueMode: parallel`；schema 为 30 秒、serial。

**profile patch 的 config 是整体替换，不是深合并。** 修改时使用 id 定向补丁，完整列出需要的字段，避免缺省字段回到 schema 默认值。以下与出厂行为一致，并显式写出审计目录选项：

```yaml
# 目标 profile 的 cordis.patch.yml；不要另写 insert
- id: approval-center
  name: dsh-approval-center
  config:
    timeoutSec: 60
    timeoutAction: reject
    tools: ['*']
    queueMode: parallel
    notifyOnTurnEnd: true
    notifyOnTurnFailure: true
    taskNotificationSound: silent
    taskNotificationShowTitle: true
    notifyOnApprovalResult: false
    dataDir: ''
```

| 字段 | 说明 |
|---|---|
| `timeoutSec` | 待审批时长，单位秒 |
| `timeoutAction` | `reject` 默认超时不放行；`approve` 为真实超时自动批准，请确认风险后才设置 |
| `tools` | `['*']` 匹配全部工具；支持 `bash*` 等前缀模式，未匹配请求交回宿主 |
| `queueMode` | `serial` 串行或 `parallel` 并行；并行最多 3 个活动审批 |
| `notifyOnTurnEnd` | 主对话本轮完成提醒 |
| `notifyOnTurnFailure` | 主对话出错、受阻、达到输出上限提醒 |
| `taskNotificationSound` | `silent` 默认静音；`default` 使用系统默认提示音，仅控制任务通知 |
| `taskNotificationShowTitle` | `true` 显示会话标题；`false` 显示会话短 ID |
| `notifyOnApprovalResult` | 主对话审批结果回执，默认关闭 |
| `dataDir` | 留空使用 `$DSH_HOME/approval-center`，未设 DSH_HOME 时使用 `~/.dsh/approval-center` |

工具名请以实际宿主为准，文件工具为 `write` / `edit`，不是 `fs*`。本插件优先认领匹配的主审批，未匹配或身份无法可靠确认时交回其他应答者。

## 审批卡片与结果含义

卡片固定写明“需要你审批 · 批准仅本次”，并显示“拒绝不执行；60秒后自动拒绝”等真实动作。任务、操作、原因分别最多 20 Unicode 码点（含省略号）；发生截断时显示独立的“（摘要，详情见 DSH）”。工具名不是完整命令，操作详情请回 DSH 核对。

批准仅允许本次请求，不是永久授权。完整原始审批原因保留于 SQLite 审计中；展示摘要不替代审计原文。

| 情况 | 处理 |
|---|---|
| 用户批准 | `allowed-once`；审计 `approved` |
| 用户拒绝 | `rejected`；审计 `rejected` |
| 真实超时 | 审计 `timeout`；按配置放行或不放行 |
| 请求方撤回 | `cancelled` |
| 插件卸载、非法输入或渠道故障 | `unavailable`，不会谎报成用户拒绝 |

审计插入失败不弹审批；批准后审计结算失败降级为渠道不可用。划掉通知不等于拒绝，插件通常需等到超时才能结算。

## 任务通知的边界与隐私

“完成”表示主会话完成一轮实际执行的回复，不代表整个项目目标达成或所有后台代理已结束。主动取消不发送完成通知；出错、受阻与输出上限各有独立文案。

通知正文不包含回答全文、命令参数、提示词或原始错误堆栈。会话标题可能含用户自行输入的信息，锁屏展示由 Windows 控制；隐藏标题可设置 `taskNotificationShowTitle: false`。冷启动未收到标题事件时回退短 ID。

任务通知不提供点击跳转；进程内有界去重，不承诺跨重启严格去重。热加载中途未观察到执行步骤的轮次不补发完成提醒，卸载丢弃待发通知，不补播历史。

## 升级、备份与回滚

1. 处理未决审批，停止当前 DSH 实例，记录旧版本、安装来源与 profile。
2. 备份 profile 的配置、package/lock/patch 文件与审计目录。停机复制 `approvals.db`，如存在 `-wal` / `-shm`，一并复制；运行中备份须使用 SQLite backup，不能只复制主 DB。
3. 在正确 profile 卸载旧插件，安装新 `.tgz`，确认仅一个实例，重启宿主。
4. 核验批准、拒绝、完成/异常提醒及审计终态，确认旧历史可读。
5. 如需回滚，先停止新版并备份升级后的数据，再恢复旧 profile 与安装来源；不要直接让旧版打开尚未备份的审计库。

同一 `dataDir` 只允许一个活跃实例；多个 profile/宿主请配置独立数据目录。旧版 `0.3.0` 会把残留 pending 改为 timeout，回装前尤其需要备份。生产升级后完整回装演练尚未执行。

首次注册的 URI 与 AUMID 不随插件卸载自动删除。回滚后应核验注册指向有效安装；不要在运行中删除锁文件或清理其他实例的通知。

## 验证与已知限制

- R11 运行代码的 Windows CI：**282/282 单测、120/120 集成，零 fail/skip**。
- Windows 11 26100、100% 缩放：原失败输入在横幅及通知中心展开态均可见摘要提示；17 例横幅覆盖长度边界、长任务/工具、emoji/XML、自动批准文案与真实批准/拒绝/超时回传。
- 新包参数门 9/9、生产非法输入 4/4；非法输入 exit4、零副作用，不误报为用户拒绝。
- 确定性模型的真实主 AgentLoop→Windows 通道已有证据；它不代表生产模型体验。新包任务通知通道另做最小静音冒烟。
- **未测**：125%/150% 缩放、更旧 Windows 的 attribution 行为、真实 child 委派、生产模型体验、20 路大批次实机及生产升级后回装演练。
- 系统关闭通知、勿扰/专注模式、权限限制或限流可能让通知不出现；提交成功不等于用户实际看到或听到。
- VBS 不可用时走 PowerShell 回传，可能短暂闪现控制台窗口。
- 超时/撤回后通知会清理；进程强杀时依靠定向清理及过期时间兜底。不要点击已结束请求的旧按钮。

## 开发与反馈

```powershell
git clone https://github.com/xmwpoi/dsh-approval-center
cd dsh-approval-center
npm ci
npm --prefix test/integration ci --ignore-scripts
npm test
```

自动集成使用 mock 发送通道，不投递通知。人工 `npm run test:approval -- 60` 会真实弹审批，需独占桌面并备份/恢复共享注册。源码目录安装前必须构建，安装后不要移动该目录。

请在 [Issues](https://github.com/xmwpoi/dsh-approval-center/issues) 提供插件/DSH/Windows/Node 版本、缩放比例、安装方式、脱敏日志及复现步骤。不要上传 API key、完整生产 profile 或审批数据库。

## 许可证

[MIT](LICENSE)。本项目是 DSH 插件，非 Windows 或 DeepSeek 的官方通知客户端。
