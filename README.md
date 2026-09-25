# dsh-approval-center

**DeepSeek Harness (dsh) 插件 — 审批中控台**

Windows 专用。在多个子代理并行运行时，拦截需要人类审批的高风险操作（执行命令 `pwsh`、
写文件 `write`/`edit` 等，取决于 `tools` 配置），以 **Windows 通知中心通知**的形式弹出
带「批准 / 拒绝」按钮的申请；并在子代理任务完成时发通知。**不弹任何窗口**——
审批全程在通知中心完成。

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

插件未发布 npm，用本地路径安装。三个前提：

1. **`dsh plugin` 的目标由 `$DSH_HOME` 决定**，装错目录会 exit 0 但完全无效；
2. `dsh plugin` 硬依赖 PATH 上的 `pnpm`（找不到会 exit 127 并提示 `pnpm was not found`）；
3. **需要 Node ≥ 24**（`node:sqlite` 免 flag）——`package.json` 的 `engines` 只警告不强制。

而且本地路径安装走 pnpm 的 `link:`，DSH 会**直接从源码目录加载**——所以必须先构建：

```powershell
# 0) 只有开发者需要：改完 src/ 之后重新构建
#    仓库里已包含编译产物 lib/，普通使用者克隆下来即可用，不需要这一步。
cd C:\path\to\dsh-approval-center
npm install
npm run build

# 1) 确保 PATH 上有 pnpm（`dsh plugin` 硬依赖它）。首选 corepack：
corepack enable pnpm
#    若 corepack 不可用，也可以退回 corepack 缓存里的 pnpm.cjs 做离线 shim：
#      node "%LOCALAPPDATA%\node\corepack\v1\pnpm\<版本>\bin\pnpm.cjs" %*
#    注意：%APPDATA%\npm 必须在 PATH 上，否则 dsh plugin 依然找不到 pnpm。
pnpm --version   # 必须打印版本号

# 2) 指向正确的 DSH_HOME，再安装
$env:DSH_HOME = '<你的 DSH_HOME，例如 D:\dsh-home>'
node <dsh-cli>\lib\bin.js plugin --profile web add "C:\path\to\dsh-approval-center"
```

`dsh plugin add` 会自动应用本包的 `cordis.patch.yml`（`dsh.bundle.patch`）并写入
`dsh.profile.bundles`——**装完不要再手动往 profile 的 cordis.patch.yml 里加
insert，否则插件会挂载两次**（两个监听器抢同一 waterfall，完成通知还会发两遍）。

核验是否只挂了一次：

```powershell
node <dsh-cli>\lib\bin.js --profile web --dump-config | Select-String 'dsh-approval-center'
# 只应出现一次
```

手动挂载（不经 CLI）：把本包 `cordis.patch.yml` 里的 insert 复制进目标 profile
的 `cordis.patch.yml` 即可。**装完必须重启 `dsh web`**——`patchReload` 在当前 DSH
构建里没有任何代码读取，`dsh.profile.bundles` 只在启动时组合一次。

> ⚠ **重启前必须先结束宿主进程**：如果启动器（例如本机的
> `start-dsh-web.ps1`）在"端口已被占用"时只是打开浏览器然后退出，你会以为重启了、
> 其实旧进程还在跑旧代码。

> 插件目录被 `link:` 引用，**装完不要移动或删除**它。

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
