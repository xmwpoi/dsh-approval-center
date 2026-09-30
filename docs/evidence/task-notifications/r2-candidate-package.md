# R2 固定候选包（Agent A）

日期：2026-09-30。commit `6f5daf75e09cec4ea1b79bee29b73f47a6f974ce`（分支 `adapt/dsh-018-notify-a`）。

## 1. 候选包

| 项 | 值 |
|---|---|
| 文件 | `D:\codex\dsh-notify-A-pack\repro1\dsh-approval-center-0.4.0-rc.1.tgz`（`repro2` 下有第二份，逐字节相同） |
| 大小 | 见下方复现命令输出 |
| **SHA256** | `98F6CBE873DCCE894A68C7DCCBE7B9B6120212870436CD88F83D330EC35563C6` |
| 版本 | `0.4.0-rc.1`（**候选**，未打 tag、未发 Release） |
| peer | `@deepseek-ai/dsh: 0.1.7-rc.2`（未变） |
| 运行时依赖 | 仅 `schemastery ^3.18.0`（零新增） |

### 旧候选作废

| 候选 | SHA256 | 状态 |
|---|---|---|
| R1 包 | `F7C6E74E887A32D6C16B2668466E2E24C3255DC3E684EFAA0743CDA173A2F113` | **superseded**，不得用于实机签收 |
| **R2 包（本包）** | `98F6CBE873DCCE894A68C7DCCBE7B9B6120212870436CD88F83D330EC35563C6` | 待 C 实机 |

作废原因：R1 包不含 D 的 fixture/测试、不含标题冷读裁决、不含脚本完整性/换行门，
且其 `toast.ps1` 为 LF 换行。**旧 C 包（F651C267…）同理作废**——它只证明当时 sender 通道，未覆盖 A 整合代码。

## 2. 可复现性（R2 §7：两次干净构建）

方法：从同一 commit `6f5daf7` 用 `git worktree add --detach` 两次干净检出，
各自 `npm ci --ignore-scripts`（锁定依赖）→ `npm run build` → `npm pack`。同一 Node v24.20.0 / npm 11.19.0。

| | build 1 | build 2 |
|---|---|---|
| tgz SHA256 | `98F6CBE8…63C6` | `98F6CBE8…63C6` |
| **逐字节一致** | **是** | — |
| 解包内容差异 | **0** | — |

（25 个文件按 `相对路径:SHA256` 比对，无差异。**同 SHA 可复现是本次实测结论**，不是宣称。）

## 3. 源码 → tgz 一致性

对 `scripts/*.ps1`、`scripts/*.vbs`、`lib/*.js`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`package.json`
逐文件比对工作树与解包内容 SHA256：**0 处不一致**。

### 入包脚本字节级核验（R2 §6 门）

| 脚本 | BOM | CRLF | 裸 LF | nonAscii |
|---|---|---|---|---|
| `toast.ps1` | 是 | 117 | **0** | 1921 |
| `approval-toast.ps1` | 是 | 421 | **0** | 9108 |
| `approval-uri-handler.ps1` | 无（纯 ASCII） | 40 | **0** | 0 |
| `approval-uri-handler.vbs` | 无（纯 ASCII） | 138 | **0** | 0 |

PS5.1 `Parser::ParseFile`：0 语法错误。**协议逐字节未动**：`scenario="reminder"`、`activationType="protocol"`、
`dshapproval:approve|reject/$id` 参数、退出码 0/1/2/3/4、`requestToken` 均与基线一致。

## 4. 复现命令

```powershell
$base = '6f5daf75e09cec4ea1b79bee29b73f47a6f974ce'
git -C 'D:\codex\dsh-approval-center' worktree add --detach <dir> $base
cd <dir>
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm pack
Get-FileHash .\dsh-approval-center-0.4.0-rc.1.tgz -Algorithm SHA256
# 期望：98F6CBE873DCCE894A68C7DCCBE7B9B6120212870436CD88F83D330EC35563C6
```

## 5. 该 commit 的自动门

`typecheck` exit 0；`build` exit 0；`test:unit` **209/209**；`test:integration` **61/61**（0 fail 0 skip）。
门禁构成与"含真实进程用例"的如实标注见 [r2-automatic-gate.md](./r2-automatic-gate.md)。

## 6. 签收边界

- **本包可用于**：C 的 T6 Windows 独占实机验收（须新开独占窗口）。
- **本包不代表**：已发布、已实机验收、或"用户已看到通知"。通知 API 成功只代表已提交给 Windows。
- 发布决定权在用户；上一版 `v0.3.1-rc.1` 的 Release/tag/附件保持不变。
