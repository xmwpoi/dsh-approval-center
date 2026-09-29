# T3 预备：Windows 通道测试矩阵与接口变更请求（Agent C）

日期：2026-09-29。基线：f608abd074315b430a3ab17f26b51129cdd185c7。状态：**T0 未冻结前的只读准备产物**。
本文不宣称任何风险已运行复现；全部条目待 mock 测试与 T6 实机验证。

## 1. 环境探针结论（本机，只读）

| 项 | 结论 | 证据 |
|---|---|---|
| powershell.exe | 5.1.26100.9168（System32） | `where powershell.exe` |
| pwsh.exe | **不存在**（PS7 回退路径不可测，CI 矩阵如需 pwsh 需另行安装） | `where pwsh` |
| wscript.exe | 存在（System32） | `where wscript.exe` |
| VBScript 引擎 | **可用**（烟囱探针写文件成功，探针已删除） | temp probe |
| `dshapproval` URI 注册 | **已指向生产 profile**：`"C:\Users\A\.dsh\profiles\web\node_modules\dsh-approval-center\scripts\approval-uri-handler.vbs" "%1"` | reg query（只读） |
| AUMID `Dev.DSH.ApprovalCenter` | 已注册，DisplayName=DSH 审批中控台 | reg query（只读） |
| 状态目录 `%LOCALAPPDATA%\dsh-approval-center` | 存在但为空（无 .pending/.result/.dir） | ls |
| Node / pnpm / git | v24.20.0 / 12.3.4 / 2.54.0 | --version |
| DSH fixture | 本机 D:\dsh-title-dev\dsh-cli\node_modules\@deepseek-ai\{dsh,dsh-app-boot,dsh-user-approval} 均为 **0.1.7-rc.2** | package.json |
| DSH_HOME / DSH_APPROVAL_DEBUG | 未设置 | env |

**T6 关键约束（实测证据）**：生产 URI 注册指向 `C:\Users\A\.dsh\profiles\web\...`。
实机测试若需改注册，必须先记录该值、测后恢复；期间生产插件的审批回传会被重定向。
建议 T6 使用独立 Windows 用户或 VM；若必须同用户，测试时段内生产实例会受影响，须事先征得用户同意。

**共享克隆冲突记录**：D:\codex\dsh-approval-center 主 worktree 已被切到 `adapt/dsh-017-host`（A 在用）。
C 已按计划书改用独立 worktree `D:\codex\dsh-approval-center-c`（分支 `adapt/dsh-017-windows`）。请 A 知悉并同样使用 worktree。

## 2. T3 测试用例矩阵（对齐计划书 V 编号）

全部为 mock/静态测试（`test/dialog*.test.js`，node:test 运行器，Node 24 内置）。
"实机" 列的用例推迟到 T6，此处只定义自动层。

| 用例 ID | 覆盖 V 编号 | 内容 | 层级 | 状态 |
|---|---|---|---|---|
| D-01 | V01/V02 | exit 0→allowed-once；exit 1→rejected（mock child exit 事件） | mock | 待实现 |
| D-02 | V03 | exit 2→timeout；timeout 在 index.ts 映射为宿主 unavailable（A 的映射，不在此测） | mock | 待实现 |
| D-03 | V05 | exit 3 / exit 7 / exit null→unavailable（fail-closed，不伪造 rejected） | mock | 待实现 |
| D-04 | V05 | child 'error' 事件（缺 powershell/被拦截）→unavailable | mock | 待实现 |
| D-05 | V05 | spawn 同步抛出→unavailable，异常不逃出 promise | mock | 待实现 |
| D-06 | V06 | signal 入队前已中止→cancelled，且**不 spawn** | mock | 待实现 |
| D-07 | V06/V07 | 展示中 abort→kill 被调用、结果 cancelled、只结算一次 | mock | 待实现 |
| D-08 | V07 | abort 后晚到 exit / exit 后晚到 abort / watchdog 后晚到 exit：首个终态不被覆盖 | mock | 待实现 |
| D-09 | V03 | 看门狗：timeoutSec+15s 无 exit→kill + unavailable（fake clock，不真等） | mock | 待实现 |
| D-10 | V08 | 并发 20 个 showApprovalToast（mock child）：互不串号、全部结算、无悬挂 | mock | 待实现 |
| S-01 | V17 前置 | .ps1 非 ASCII 必须带 BOM；.vbs 必须纯 ASCII（对仓库真实脚本） | 静态 | 待实现 |
| S-02 | — | assertScriptsUsable 负例：缺文件 / 空文件 / ps1 无 BOM 含中文 / vbs 含非 ASCII →抛错（临时目录夹具，不触碰 scripts/） | 静态 | 待实现 |
| S-03 | — | PowerShell 5.1 Parser::ParseFile 语法门禁对真实脚本 PASS（powershell.exe 而非 pwsh） | 静态 | 待实现 |
| S-04 | V17 | 中文/空格路径：脚本经带空格+中文的临时目录被 ParseFile 解析通过 | 静态 | 待实现 |
| R-01 | V06 实机部分 | token 定向清理入口：按 token 清本人通知/状态文件，可重复调用 | mock→实机 | **阻塞：等 T0 签名** |
| R-02 | V14 实机部分 | 卸载/重载时活动 worker 的通知被定向清理（依赖 A 的接线） | 实机 | **阻塞：等 T5** |

## 3. 本轮已实现（不依赖 T0、不改公共类型）

1. `showApprovalToast(req, deps?)`：新增**可选**第二参数 `deps`（`spawn`/`setTimer`/`clearTimer` 可注入）。
   生产路径不传 deps，行为与基线完全一致；现有调用方（index.ts）无需改动。
2. `assertScriptsUsable(files, baseDir?)`：新增**可选** baseDir，供负例测试用临时目录，不再被迫写真实 scripts/。
3. `test/dialog.test.js`（D-01…D-10）与 `test/dialog.scripts.test.js`（S-01…S-04）。
4. 运行方式：`node --test test/`（node:test 内置运行器）。建议 A 在 T5 把 `test:unit` 指到它。

## 4. 需要 A 在 T0 冻结的接口（变更请求，未实现）

### CR-1：单请求 token 与定向清理（计划书 §3.3）

```ts
// 请求 A 冻结：DialogRequest 增加可选 token（由 index.ts/queue 层生成并贯穿审计）
interface DialogRequest {
  // ...现有字段不变...
  /** 插件内部请求 token（Node 生成）；传入后脚本用它作 toast tag 与状态文件名，
   *  使取消清理可以按 token 定向。缺省时脚本沿用随机 GUID（手动脚本兼容路径）。 */
  token?: string
}
// C 侧将新增导出（签名待 T0 确认）：
export function cleanupApprovalNotification(token: string, stateDir?: string): void
// 语义：spawn approval-toast.ps1 -CleanupToken <token>；幂等、可重复；
// 只清该 token 的通知(tag)/.pending/.result/.dir，绝不 History.Clear、不碰其他组。
```

需要 A 明确：
- token 生成方（建议 index.ts 的 processOne，与 requestId/audit 关联）与传递链（queue→dialog）。
- abort 时 dialog 内部直接调用清理，还是由 A 的外层协调器统一调用（建议：dialog 在 abort 路径内联调用，A 的生命周期接线只负责卸载时的兜底遍历）。
- token 与 requestId 的关系（建议：token = requestId 的派生 hex，避免两套 ID）。

### CR-2：VBS/PS 处理器需感知 token

`approval-uri-handler.{vbs,ps1}` 目前按 `<id>.result` 写回；token 作为 `<id>` 后无需改动处理器，
但需确认 T0 冻结的"关闭原因映射"不要求处理器写入更多字段。

## 5. 已知限制

- 本机无 pwsh，PS7 相关矩阵无法验证（现有脚本面向 5.1，不受阻）。
- T6 实机（V01/V02/V03/V06/V08 小批次/V09/V10/V14/V16–V18/V20）全部未执行；等待 T5 自动门 + 独占测试时段。
- 生产 URI 指向 `.dsh` 生产 profile（见 §1）；任何注册表操作前先备份该值。

## 6. 执行结果（2026-09-29，本机）

- `pnpm typecheck`（tsc --noEmit）：**PASS**
- `pnpm build`：**PASS**
- `node --test test/dialog.test.js test/dialog.scripts.test.js`：**20/20 PASS**
  - D-01…D-11 全过（退出码映射、fail-closed、spawn 异常、abort 三态、看门狗 fake-clock、20 并发、监听不泄漏）
  - S-01…S-04 全过（真实脚本 BOM/ASCII、负例夹具、PS 5.1 Parser 对真实脚本及中文+空格路径解析通过）
- 实机项（R-01/R-02、V01–V20 实机部分）：**未执行**，等待 T0/T5。

