# R3 固定候选包（Agent A）

日期：2026-09-30。**source commit `c90a1a50cbadf75d5560a305988388da95fac023`**
（分支 `adapt/dsh-018-notify-a`；该 commit 的远端 CI 全绿，见 §5）。

> 本轮**只收口候选，不发布**：不合并、不打 tag、不发 0.4.0 Release。

## 1. 候选包

| 项 | 值 |
|---|---|
| 文件 | `D:\codex\dsh-notify-A-pack\r3c\dsh-approval-center-0.4.0-rc.1.tgz`（`r3d` 下有第二份，逐字节相同） |
| **SHA256** | `CC9163564185347EFDDC44C5DC2BEBA24C9B5F80372780E3A2322308EB006B9B` |
| 大小 | **81918 bytes** |
| source commit | `c90a1a50cbadf75d5560a305988388da95fac023` |
| 版本 | `0.4.0-rc.1`（候选） |
| peer | `@deepseek-ai/dsh: 0.1.7-rc.2` |
| 运行时依赖 | 仅 `schemastery ^3.18.0`（零新增） |

### 哪个包给 C 用

> **C 使用本包 `CC916356…B9B`**（source commit `c90a1a5`）。
> **不得**用 `98F6CBE8…` 或更早的包签收 layout（R3 派发明确禁止）。

### 候选沿革

| 候选 | SHA256 | 状态 |
|---|---|---|
| R1 | `F7C6E74E887A32D6C16B2668466E2E24C3255DC3E684EFAA0743CDA173A2F113` | superseded（历史保留，不删除） |
| R2 | `98F6CBE873DCCE894A68C7DCCBE7B9B6120212870436CD88F83D330EC35563C6` | **superseded**（无 B 的 4 修复/32 对抗例、无 C 布局、无 D 新套件、无 lock 修正） |
| C 旧包 | `F651C267…` | superseded（只证明当时 sender 通道，未覆盖 A 整合代码） |
| **R3（本包）** | `CC9163564185347EFDDC44C5DC2BEBA24C9B5F80372780E3A2322308EB006B9B` | **当前唯一有效候选** |

> 已发布的 `v0.3.1-rc.1` Release / tag / 附件**保持不变**，不替换、不删除。

## 2. 可复现性（R3 §8：两次干净 checkout + 锁定 Node/npm）

方法：`git worktree add --detach` 从 `c90a1a5` 两次干净检出 →
各自 `npm ci --ignore-scripts`（用修正后的 lock 锁定依赖）→ `npm run build` → `npm pack`。
工具链：**Node v24.20.0 / npm 11.19.0**（CI runner 同为 Node 24）。

| | build 1（`r3c`） | build 2（`r3d`） |
|---|---|---|
| tgz SHA256 | `CC916356…B9B` | `CC916356…B9B` |
| **逐字节一致** | **是** | — |
| 大小 | 81918 | 81918 |

**同 SHA 可复现是本次实测结论**，不是宣称。

> 与 `717044a` 的候选 SHA **相同**是预期结果：`c90a1a5` 只改了测试文件
> （`test/dialog.unicode-mapping.test.js`，不入包），运行时代码/脚本/布局未变，
> 故包内容逐字节不变。**这也是"包由源码唯一决定"的一个正面证据。**

## 3. 源码 → tgz 一致性

对 12 个入包文件（4 个脚本、6 个 `lib/*.js`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`package.json`）
逐文件比对工作树与解包内容 SHA256：**0 处不一致**。

### 入包条目清单（21 项）

```
package/LICENSE
package/lib/dialog.js          package/lib/dialog.d.ts
package/lib/host-contract.js   package/lib/host-contract.d.ts
package/lib/index.js           package/lib/index.d.ts
package/lib/notifications.js   package/lib/notifications.d.ts
package/lib/queue.js           package/lib/queue.d.ts
package/lib/store.js           package/lib/store.d.ts
package/package.json
package/CHANGELOG.md
package/README.md
package/cordis.patch.yml
package/scripts/approval-toast.ps1
package/scripts/approval-uri-handler.ps1
package/scripts/approval-uri-handler.vbs
package/scripts/toast.ps1
```

### 入包脚本字节级核验（R3 §6 门）

| 脚本 | BOM | CRLF | 裸 LF | 说明 |
|---|---|---|---|---|
| `approval-toast.ps1` | 是 | 538 | **0** | C 的布局版；含中文必须有 BOM |
| `toast.ps1` | 是 | 117 | **0** | 任务通知发送器 |
| `approval-uri-handler.ps1` | 无 | 40 | **0** | 纯 ASCII（BOM 非必需） |
| `approval-uri-handler.vbs` | 无 | 138 | **0** | **必须**纯 ASCII（wscript 按 ANSI 读取） |

- **完整性门**：剥 BOM 后必须还有非空白字节 —— 拦下 R1 的 3 字节 BOM-only 假成功事故。
- **非空行为门**：CI 的 `assert script encodings, CRLF line endings and PowerShell syntax` 步骤
  已随本轮 CI **实际执行并通过**（见 §5）。
- **协议逐字节不变**：`scenario="reminder"`、`activationType="protocol"`、
  `arguments="$scheme:approve|reject/$(Escape-Xml $Id)"`、退出码 0/1/2/3/4、`requestToken` 均未改动。

## 4. 复现命令

```powershell
$base = 'c90a1a50cbadf75d5560a305988388da95fac023'
git -C 'D:\codex\dsh-approval-center' worktree add --detach <dir> $base
cd <dir>
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm pack
Get-FileHash .\dsh-approval-center-0.4.0-rc.1.tgz -Algorithm SHA256
# 期望：CC9163564185347EFDDC44C5DC2BEBA24C9B5F80372780E3A2322308EB006B9B
# 大小：81918
```

## 5. 远端 CI（R3 §7）

| 轮次 | run | headSha | 结果 |
|---|---|---|---|
| 首轮 | [36745467011](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745467011) | `717044a` | **FAIL**（`check` 在 `test:unit` 249/250，EPERM 清理 flake）→ 记录已保留 |
| 修复后 | [36745878868](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36745878868) | `c90a1a5` | **SUCCESS**：`check` ✅、`integration` ✅ |

- 本地 ref 与远端 ref 一致：均为 `c90a1a50cbadf75d5560a305988388da95fac023`。
- Draft PR：<https://github.com/xmwpoi/dsh-approval-center/pull/3>（**draft，未合并**）。
- 首轮失败根因与修复见 [r3-automatic-gate.md](./r3-automatic-gate.md) §7。

## 6. 签收边界

- **本包可用于**：C 的 T6 独占静音实机（须**新开**独占窗口）。
- **本包不代表**：
  - 已发布 / 已合并 / 已打 tag；
  - 布局的**实际可读性**已验收（行数预算 ≠ 像素高度；中文长标题、显示缩放、系统截断未验）；
  - 真实主会话完成/错误、真实子代理零通知的**实机**结论（缺真实会话条件时保留 PENDING）；
  - "用户已看到通知" —— 通知 API 成功只代表**已提交**给 Windows。
- 运行时代码/脚本/布局若在实机后发生任何变更，**必须重打包并安排受影响路径的实机复测**。
