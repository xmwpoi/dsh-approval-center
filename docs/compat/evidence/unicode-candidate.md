# 跨代码页 Unicode 候选包：固定输入与 G3

日期：2026-09-30。包由 `77cd166a8f42246132effe6222b19ede3b0ef818` 构建；运行修复 commit `637163f667769307d02e68fdfa71f864a38d5b94` 已通过 [远端 CI](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36707444272)：98/98 单测、21/21 目标版集成，0 fail/skip。

| 项 | 值 |
|---|---|
| 候选包 | `D:\codex\dsh-approval-center-unicode-candidate\dsh-approval-center-0.3.1-rc.1.tgz` |
| SHA256 | `7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A` |
| version / peer | `0.3.1-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2` |
| 包清单 | 19 文件；解包与构建树 19/19 SHA256 相同 |
| 隔离安装 | `D:\codex\dsh-approval-center-unicode-candidate\install`；npm install 成功（4 packages） |
| 安装比对 | 安装产物与 tarball 19/19 SHA256 相同 |
| 入口 | ESM import 的 `Config` 与 `apply` PASS，未调用 apply |

三个受影响脚本的 SHA256：

| 文件 | SHA256 |
|---|---|
| `scripts/approval-toast.ps1` | `5427527D6ECEFA7AEEBB38282964FDB8323F14E8EA741C1BFFB761658D05D290` |
| `scripts/approval-uri-handler.ps1` | `0E14FBD3EDB469B11D01DA2BC49C8F51F0EEC2357F00E5F87A2E809B238D3CE3` |
| `scripts/approval-uri-handler.vbs` | `91CD8E832496D082B2E4F1EE45556658E15ADABB5EBEF921D5FFCD50B506E842` |

安装使用 `--ignore-scripts --omit=peer`，仅验证插件归档安装、文件完整性与入口，**未安装完整 DSH CLI**；C 的实机宿主须继续使用含 peers 的精确 `0.1.7-rc.2` 隔离宿主。包构建的 prepare/tsc 成功；未运行本地 wscript/通知测试，未写 HKCU/生产 profile。

G3 包完整性与入口烟测 PASS；新包 G2 仍 PENDING。C 必须按此 SHA 复测中文+空格 StateDir 的 VBS 主路、PS 回退、ASCII 与强杀清理，不能引用旧 SHA 的 G2。
