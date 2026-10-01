# R5 固定候选包（Agent A）

日期：2026-10-01。**source commit `2b0c2baf1430a8a9b39ae7ce92a93e456c221340`**
（分支 `adapt/dsh-018-notify-a`；远端 CI run 36829521382 success）。

> 本轮**只收口候选，不发布**：不合并、不打 tag、不发 0.4.0。

## 1. 候选包

| 项 | 值 |
|---|---|
| 文件 | `D:\codex\dsh-notify-A-pack\r5c\dsh-approval-center-0.4.0-rc.1.tgz`（`r5d` 同，逐字节） |
| **SHA256** | `0358FC7FB529870F3F9B5C66FB265547E612F224D1A34CAD89B83174CD998528` |
| 大小 | **86436 bytes** |
| source commit | `2b0c2baf1430a8a9b39ae7ce92a93e456c221340` |
| 版本 / peer / 依赖 | `0.4.0-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2` / 仅 `schemastery ^3.18.0` |
| 可复现 | 两次独立干净检出（`r5c`/`r5d`）**逐字节相同** |

### 候选沿革

| 候选 | SHA256（前 16） | 大小 | 状态 |
|---|---|---|---|
| R1 | `F7C6E74E887A32D6` | 77254 | superseded |
| R2 | `98F6CBE873DCCE89` | 78493 | superseded |
| R3 | `CC9163564185347E` | 81918 | superseded |
| R4 | `C6C7C84E68489EE6` | 82467 | **superseded**（旧布局，C 实测渲染 FAIL） |
| **R5** | **`0358FC7FB529870F`** | **86436** | **当前唯一有效候选** |

> **所有旧包历史保留，不删除、不重命名。** C 的实机验证必须用 `…\r5c\…`。

## 2. R5 变更（运行时代码 + 脚本）

| 变更 | 说明 |
|---|---|
| **R4C-D1 修复**（R4） | `toast.ps1` `-notmatch`/`-ne` → `-cnotmatch`/`-cne`（区分大小写） |
| **R4C-D2 修复**（R4） | `dialog.ts` key 类型守卫移到 `taskNotificationTag()` 之前 |
| **R5 §3 结构化字段** | `DialogRequest` 新增可选 `decisionSummary?` / `contextSummary?`（成对提供） |
| **R5 §3 sender 传参** | `spawn` 参数数组追加 `-DecisionSummary` / `-ContextSummary`（仅成对时） |
| **R5 §3 脚本 XML** | `Build-ApprovalToastXml` 新增结构化分支：title → decision → context 三个 `<text>`；title 不吸收正文、decision 不参与截断、context 独立限宽 |
| **R5 §3 限宽** | `approvalTask` 20 / `approvalToolName` 20 / `approvalReason` 36 码点（替换旧 60/40/100） |
| **legacy 兼容** | 旧调用（结果回执/手动脚本）不传新参数走 legacy 单 `Message` 路径；只给其一同退 legacy 并告警 |

## 3. 接口冻结

```ts
// src/dialog.ts（A）
interface DialogRequest {
  title: string; message: string; timeoutSec: number
  timeoutAction?: 'reject' | 'approve'; signal?: AbortSignal; requestToken?: string
  decisionSummary?: string   // ★ R5 固定安全信息（成对才走结构化路径）
  contextSummary?: string    // ★ R5 动态摘要（成对才走结构化路径）
}
// src/notifications.ts（B）
interface ApprovalCard {
  title: string              // 固定："需要你审批 · 批准仅本次"
  decisionSummary: string    // 固定安全信息，不截断
  contextSummary: string     // 动态摘要，各字段独立限宽
  message: string            // 兼容：decisionSummary + '\n' + contextSummary
}
```

**PS 侧**：`-DecisionSummary <string>` / `-ContextSummary <string>` 独立参数。
脚本据此构造 3 个 `<text>`。**不成对**回退 legacy 并 `Write-Warning`。

**协议不变**：`scenario="reminder"`、`activationType="protocol"`、approve/reject 参数、
退出码 0/1/2/3/4、`requestToken`、`ExpirationTime`、`CleanupToken` 3 参 `Remove` —— 全部保留。

## 4. 复现命令

```powershell
$base = '2b0c2baf1430a8a9b39ae7ce92a93e456c221340'
git -C 'D:\codex\dsh-approval-center' worktree add --detach <dir> $base
cd <dir>; npm ci --ignore-scripts --no-audit --no-fund; npm run build; npm pack
Get-FileHash .\dsh-approval-center-0.4.0-rc.1.tgz -Algorithm SHA256
# 期望：0358FC7FB529870F3F9B5C66FB265547E612F224D1A34CAD89B83174CD998528（86436 bytes）
```

## 5. 门禁

| 项 | 结果 |
|---|---|
| `typecheck` / `build` | exit 0 |
| `test:unit` | **264/264**（0 fail 0 skip） |
| `test:integration` | **79/79**（0 fail 0 skip） |
| 远端 CI | run 36829521382 **success**（source `86eb2d2` = CHANGELOG 更新前；CHANGELOG 仅改文案不影响结构化逻辑） |
| 脚本字节门 | `approval-toast.ps1` BOM+CRLF 579/裸 LF 0；`toast.ps1` BOM+CRLF 121/裸 LF 0；PS5.1 0 语法错误 |
| 结构化 `-ValidateOnly` | exit 0，`textNodes=3 actionNodes=2`，decision 排最前，context 独立 |
| legacy `-ValidateOnly` | exit 0，`textNodes=1` |
| 单侧回退 | exit 0 + `Write-Warning`，走 legacy |

## 6. 签收边界

- **本包可用于**：C 的 R5 实机渲染验证（须新开独占静音窗口）。
- **本包不代表**：布局可读性已验收。R4 的 E3 截图已证明旧布局在长内容下丢行；
  R5 结构化修复**尚未经新包实机渲染确认**。**不能从 XML 证明像素可见。**
- 真实主/子会话 PENDING。通知 API 成功 ≠ 用户看到。不合并、不打 tag、不发布。
