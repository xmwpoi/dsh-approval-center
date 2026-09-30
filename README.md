# dsh-approval-center

**DeepSeek Harness (dsh) 插件 — 审批中控台**

Windows 专用。在多个子代理并行运行时，拦截需要人类审批的高风险操作（执行命令 `pwsh`、
写文件 `write`/`edit` 等，取决于 `tools` 配置），以 **Windows 通知中心通知**的形式弹出
带「批准 / 拒绝」按钮的申请；并在子代理任务完成时发通知。**不弹任何窗口**——
审批全程在通知中心完成。

> `0.3.1-rc.1` 候选包仅声明兼容 DSH `0.1.7-rc.2`。目标版真实宿主非交互集成测试已通过；Windows 通知中心与安装/回滚实机验收仍在进行。下面的 `v0.3.0` 安装示例是已发布版本，不代表本候选包已发布。

## 功能

| 功能 | 触发事件 | UI 形式 |
|---|---|---|
| **高风险操作审批** | `approval/request` waterfall | Windows 通知中心通知（带「批准 / 拒绝」按钮） |
| **审批结果回执** | 审批结算后 | Windows 通知中心通知（可关） |
| **任务完成通知** | `subagent/end` | Windows 通知中心通知 |
| **任务启动通知** | `subagent/start` | Windows 通知中心通知（可选） |

## 关键机制一：为什么必须 `prepend`

`approval/request` 是 cordis waterfall，**先注册的应答者先认领**。dsh 自带的
`dsh-api-remotes`（Web UI 审批应答者）监听同一事件——浏览器在线时它会抢先认领
并转发到网页审批面板，本插件（按默认 bundle 顺序排在最后）将永远收不到请求。

因此插件以 `{ prepend: true }` 抢先注册；未匹配 `tools` 的请求仍通过 `next()`
转交 Web GUI，两边共存（例如只拦截 `pwsh*` / `write` / `edit`，其余审批继续走网页面板）。
注意 `tools` 里要写**真实工具名**——文件写操作叫 `write`/`edit`，没有 `fs*` 这种工具。

## 关键机制二：为什么用「protocol 激活 + reminder」

这两点都是从实测限制倒推出来的，缺一个审批就走不通：

**1. `scenario="reminder"` —— 否则通知几秒后就消失。**
普通 toast 约 5–10 秒就离开屏幕。这正是 node-notifier / SnoreToast 路线**无法用于审批**的
根因：SnoreToast 在通知离屏时即退出，它靠命名管道回传按钮结果的通道随之关闭，
之后你在操作中心再点按钮也没有回传通道（实测反复得到 `dismissed`，从未拿到按钮结果）。
`reminder` 让通知**停留到用户处理为止**，审批窗口不再受系统通知时长限制。

**2. `activationType="protocol"` —— 未打包应用收不到 WinRT 的点击事件。**
实测在 PowerShell 里 `add_Activated` / `add_Dismissed` 订阅成功（正常返回
`EventRegistrationToken`），但事件**永不触发**——这是未打包 Win32 应用的已知限制
（要收事件得注册 COM 激活器）。因此改为：按钮携带
`dshapproval:approve/<id>` 这样的 URI，由 Windows 唤起已注册的 URI 处理器
（`scripts/approval-uri-handler.ps1`）把决定写进状态文件；`scripts/approval-toast.ps1`
只轮询该状态文件。

副作用是**不再需要 node-notifier / SnoreToast**（已从依赖里移除），也不需要
把它隔离到 worker 线程里。

## 安装

推荐用 DSH 自带的插件管理器。下面三种方式都**不需要**手动 clone 或构建。

### 方式 A：从 GitHub 安装（推荐）

```powershell
dsh plugin --profile web add github:xmwpoi/dsh-approval-center
```

或在 Web 侧栏 **插件 → 添加插件** 里填同一串。pnpm 会把包拉进 profile 的
`node_modules` 并自动构建，**装完不需要保留任何源码目录**。

`dsh plugin add` 会自动应用本包的 `cordis.patch.yml`（`dsh.bundle.patch`）并写入
`dsh.profile.bundles`——**装完不要再手动往 profile 的 cordis.patch.yml 里加
insert，否则插件会挂载两次**（两个监听器抢同一 waterfall，完成通知还会发两遍）。

钉住某个 tag 或提交：

```powershell
dsh plugin --profile web add github:xmwpoi/dsh-approval-center#v0.3.0
```

### 方式 B：从 Release 压缩包安装

没有 git、或连不上 `github.com` 时用这条。压缩包已含 `lib/`，**不跑任何构建脚本**：

```powershell
dsh plugin --profile web add https://github.com/xmwpoi/dsh-approval-center/releases/download/v0.3.0/dsh-approval-center-0.3.0.tgz
```

### 方式 C：源码目录（**仅开发者**）

改 `src/` 时用这条。代价是 pnpm 用 `link:` 直接从源码目录加载，
**必须先手动构建，而且装完不能移动或删除该目录**：

```powershell
git clone https://github.com/xmwpoi/dsh-approval-center
cd dsh-approval-center
npm install && npm run build     # 见下面两条说明

# 只在有多个 DSH_HOME 时才需要显式指定；装错目录会 exit 0 但完全无效
$env:DSH_HOME = '<你的 DSH_HOME，例如 D:\dsh-home>'
dsh plugin --profile web add "C:\path\to\dsh-approval-center"
```

> **`link:` 依赖不走 `prepare`**：pnpm 对本地目录依赖既不安装 devDependencies、
> 也不运行 `prepare`，所以 `npm install && npm run build` 必须由你手动做一次。
> 不改 `src/` 的话可以跳过构建——仓库里已提交编译产物 `lib/`。

> **`.npmrc` 里的 `omit=peer` 只对 npm 生效**。pnpm 11 起 `.npmrc` 只读认证与注册源
> 设置，所以用 pnpm 时必须依赖仓库里的 `pnpm-workspace.yaml`（`autoInstallPeers: false`），
> 否则 pnpm 会去补齐 peer `@deepseek-ai/dsh`，把整套 DSH 依赖树（140+ 个包 / ~476 MB）
> 拖进 `node_modules`。

### 前提与排错

- **Node ≥ 24**（`node:sqlite` 免 flag）。`package.json` 的 `engines` 只警告不强制。
- `dsh plugin` 硬依赖 PATH 上的 `pnpm`（找不到会 exit 127 并提示 `pnpm was not found`）。
- **装错目录会 exit 0 但完全无效**——`dsh plugin` 的目标由 `$DSH_HOME` 决定。
  默认安装不用设它；只有在你有多个 DSH_HOME 时才需要显式指定。
- **本机没有 `dsh` 命令时**（源码 checkout 的开发机），把 `dsh plugin ...` 换成
  `node <dsh-cli>\lib\bin.js plugin ...`，把 `dsh --profile ... --dump-config` 换成
  `node <dsh-cli>\lib\bin.js --profile ... --dump-config`。
- 方式 A 安装时 pnpm 可能拦下本包的构建脚本（`prepare`）。DSH 会列出待批准的包并提供
  **允许这些脚本并重试**——照做即可，那不是出错。

装 pnpm（首选 corepack）：

```powershell
corepack enable pnpm
# corepack 不可用时，可退回缓存里的 pnpm.cjs 做离线 shim：
#   node "%LOCALAPPDATA%\node\corepack\v1\pnpm\<版本>\bin\pnpm.cjs" %*
# 注意：%APPDATA%\npm 必须在 PATH 上，否则 dsh plugin 依然找不到 pnpm。
pnpm --version   # 必须打印版本号
```

### 装完需要重启 `dsh web`（除非 profile 开了 HMR）

`dsh.profile.bundles` 只在启动时组合一次；profile 没开 HMR 时配置变化要重启才生效
（开了 HMR 才会热重组）。`patchReload` 在当前 DSH 构建里没有任何代码读取。

> ⚠ **重启前必须先结束宿主进程**：如果启动器（例如本机的
> `start-dsh-web.ps1`）在"端口已被占用"时只是打开浏览器然后退出，你会以为重启了、
> 其实旧进程还在跑旧代码。

### 手动挂载（不经 CLI）

把本包 `cordis.patch.yml` 里的 insert 复制进目标 profile 的 `cordis.patch.yml` 即可。

### 核验与卸载

```powershell
dsh --profile web --dump-config | Select-String 'dsh-approval-center'
# 只应出现一次
```

卸载：Web 侧栏 **插件 → dsh-approval-center → 卸载**。

> 首次运行注册的 URI 方案（HKCU `dshapproval`）与 AUMID 不会随卸载自动移除——
> 它们只在 Windows 唤起审批按钮时被用到，留着不影响其他功能。

## 配置

> **⚠ config 是整体替换、不做深合并**（`dsh-app-boot` 的 patch 语义：
> "config is replaced wholesale, not deep-merged"）。只写一两个字段，其余字段会被
> **schema 默认值**补齐，而不是保留本包出厂值——例如只写 `timeoutSec`，
> `tools` 会变回 `['*']`（**拦截全部审批，Web GUI 审批面板随之消失**）。
> 要覆盖就**把字段写全**。

覆盖出厂配置用 **id 定向补丁**（不要用 `insert`，那会挂载两次）：

```yaml
# profile 的 cordis.patch.yml：按 id 覆盖，不要写 insert
- id: approval-center
  name: dsh-approval-center
  config:
    timeoutSec: 60                     # 超时视为无人应答（fail-closed），不是"用户拒绝"
    timeoutAction: reject              # reject=超时自动拒绝（默认，安全）；approve=超时自动批准（危险）
    tools: ['*']                       # 完全镜像系统判断：认领全部工具的审批请求
    queueMode: parallel                # serial=串行；parallel=并列（信号量上限 3）
    notifyOnSubagentEnd: false         # 默认关：只保留"必须问"的审批通知
    notifyOnSubagentStart: false       # 默认关
    notifyOnApprovalResult: false      # 默认关（想要审批结果回执就改 true）
    dataDir: ''                        # 默认 $DSH_HOME/approval-center
```

> `tools` 里的 `write` / `edit` 是**文件写操作的真实工具名**（`read`/`write`/`edit`/`read_image`
> 都来自 `dsh-tool-fs`）。写成 `fs*` 或 `files*` 匹配不到任何工具——审批会静默漏过去。
> 核验办法：`dsh --profile <name> --dump-config | Select-String dsh-approval-center`，
> **只应出现一次**。

## 退出码语义（approval-toast.ps1）

| 退出码 | 含义 | 上报 harness | 审计库状态 |
|---|---|---|---|
| 0 | 用户点「批准」 | allowed-once | approved |
| 1 | 用户点「拒绝」 | rejected | rejected |
| 2 | 窗口内无人应答（超时） | `timeoutAction: reject` → unavailable（fail-closed）；`approve` → allowed-once | timeout |
| 3 | 结果内容异常 | unavailable | unavailable |
| 4 及其他退出码 | 投递/进程故障 | unavailable | unavailable |
| — | 请求方中止（AbortSignal） | cancelled | cancelled |

与官方语义对齐：`unavailable` = "本渠道未产生决策"（模型收到 deny）；`cancelled`
专指请求方主动撤回（AbortSignal），不用于超时。"没人应答"与"用户拒绝"严格区分，
审计记录不会说谎。

## 已知限制

- **只能探测「点了按钮」，探测不到「划掉通知」**：未打包应用收不到 WinRT 的
  `Dismissed` 事件（见关键机制二），所以用户直接关闭通知时本插件不会立刻知道，
  要等到 `timeoutSec` 到期才按超时结算。
- 超时后脚本会把该通知从操作中心移除（避免留下"点了没反应"的死按钮）；因此**不要
  在超时之后再去点**，那时按 URI 仍会写入状态文件，但审批流程已经结束。
- **`reminder` 通知不会自动消失**（这正是它能当审批用的原因）。若本进程在结算前被强杀
  （宿主重启 / 看门狗回收 / 父进程中断），屏幕上会留下一条僵尸审批——实测留下过 3 小时。
  现在会给通知设 WinRT `ExpirationTime`（`timeoutSec + 30s`），由 Windows 兜底收走；
  另有「启动时清扫死标记」作为第二道保险。极窄的窗口内仍可能残留一条，手动点 ✕ 即可。
- 挂载期会校验 `approval-toast.ps1` / `approval-uri-handler.ps1` / `approval-uri-handler.vbs`
  （开启通知时还有 `toast.ps1`）：缺文件、空文件、含非 ASCII 却无 BOM 都拒绝挂载。
  **注意**：在受限文件沙箱下，脚本的 PowerShell 语法检查会因 EPERM 降级为告警
  （字节级检查仍生效）——插件跑在未受限的宿主进程里，正常路径不会遇到。
- 通知中心必须可用：系统关掉通知、专注助手（Focus Assist）拦截、或短时间弹太多被
  系统限流时，通知可能不显示——此时审批会以 `unavailable` fail-closed（不会误批）。
- 首次运行会在 HKCU 注册 URI 方案 `dshapproval`（指向本包的
  `scripts/approval-uri-handler.vbs`，由 `wscript.exe` 运行；VBScript 不可用时自动回退到
  `scripts/approval-uri-handler.ps1`）与 AUMID `Dev.DSH.ApprovalCenter`，均无需管理员。
  **移动插件目录后需重新触发一次注册**（下次审批会自动覆盖）。
- **通知中心里只有 `dsh-approval` 组的是「待你审批」**；`dsh-result` 组是审批结果回执
  （默认已关）。两组分开管理，清理审批时不会误删回执。
- 审批状态文件放在 `%LOCALAPPDATA%\dsh-approval-center\`，审批结束即删除。
- 告警走宿主 **stderr**（启动 `dsh web` 的那个终端 / 启动器的日志文件），**不会**
  出现在 Web GUI 或会话记录里。
- 非 Windows 上本插件会以启动告警被跳过（`apply()` 主动抛错，DSH 把可选 entry 记为未激活，
  其余插件树照常运行）。需要 **Node ≥ 24**（`node:sqlite` 免 flag）。

## 运行测试

```bash
npm install
npm run build

# 弹出通知中心审批（可选参数是超时秒数）；请点通知上的「批准」或「拒绝」
npm run test:approval -- 60
```

脚本会同时打印**审批结果**和**上报 harness 的结果**（如 `timeout → unavailable`），
并以退出码区分这一轮有没有产生结论（`0` = 批准/拒绝，`1` = 超时/故障）。
建议分别验证：点**批准** → `allowed-once`；点**拒绝** → `rejected`；**什么都不点** → `timeout`。

## License

MIT
