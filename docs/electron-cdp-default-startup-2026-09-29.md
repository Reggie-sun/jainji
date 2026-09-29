# Electron CDP Default Startup

## Goal And Scope

用户要求简辑普通启动就能供本机 CDP 自动化连接，不能让用户手动添加启动参数。
本次只修改干净的 `src/main/index.ts` 启动入口，新增独立打包回归 driver，并维护对应 AOCI 条目及基线。
当前工作区其他制作、覆盖和 UI 未提交修改继续归原任务；没有创建 worktree。

## Implementation

单实例 owner 获得锁后、Electron `ready` 前，主程序强制设置 `remote-debugging-address=127.0.0.1`；
未提供 `remote-debugging-port` 时使用动态端口 `0`。现有测试 driver 的显式端口继续有效。
正常桌面入口和直接运行可执行文件均不需要用户传入调试参数。
Agent 从对应 `userData/DevToolsActivePort` 读取当前端口；端口不硬编码。
这是现有 renderer 和 preload 的 CDP 接入，不增加 IPC、Node inspector、队列或上传执行 owner。

`scripts/electron-cdp-smoke.mjs` 在独立 profile 中直接启动实际包；默认用同一 profile 完成两次正常启动及关闭，
读取真实 renderer 的既有 preload 状态并截图。Linux 读取实际 TCP listener，证明只有 loopback。
`--fixed-port` 仅为兼容回归：传入显式端口和外网监听地址，仍验证实际 listener 只绑定本机。

## Fresh Verification

| Evidence | Result |
| --- | --- |
| 旧包无调试参数启动，`/tmp/jianji-default-cdp-smoke-VqzujQ/report.json` | 能启动但缺 CDP，回归为 FAIL |
| 当前工作区 `npm run typecheck` | exit 0 |
| 受影响 lifecycle、knowledge startup、upload recovery、diagnostics | 4 files / 23 tests PASS |
| 已封存兼容源码上下文的 `npm run build` | exit 0，包含 typecheck、renderer、main 和 preload 构建 |
| Code Harness，`20260929T141248Z-459a06d1` | 7 个必需组全部 PASS |
| 新包无参数冷启动及同 profile 重启，`/tmp/jianji-default-cdp-smoke-X5hTli/report.json` | 两次 CDP、preload、正常退出及锁释放 PASS；listener 均为 `127.0.0.1` |
| 新包显式端口及外网地址输入，`/tmp/jianji-default-cdp-smoke-ARtgML/report.json` | 显式端口保留；实际只监听 `127.0.0.1` |
| 完成本机 helper 配置后，user-session 内隔离 profile 的普通启动和重启，`cdp-startup-evidence/clean-session-smoke-report.json` | 两次 PASS；端口 41457/35261；均为回环 listener，preload 就绪，正常退出并释放锁 |
| 新包普通制作上传 fixture，安装目录的 `cdp-startup-evidence/upload-smoke-observed-report.json` | 12 个真实 FFmpeg 正式输出；本地 fixture 上传 PASS；分组 1/9/2；重启不重选；确定点击 0 |
| 新包批量制作上传 fixture，`cdp-startup-evidence/batch-smoke-observed-report.json` | 17 个正式输出、12 READY；两账号隔离、未知结果暂停下一账号；确定与广告设置点击均为 0 |
| 当前工作区最终 `npm run typecheck` | exit 0；包含另一任务已提交的连接准备模块，未将其装入本次包 |
| 原桌面入口普通启动，`cdp-startup-evidence/live-identity.json` | 实际新包 renderer；主进程仅有 executable 参数；动态端口 36321，仅监听 `127.0.0.1` |
| 实际 renderer 沙箱，`cdp-startup-evidence/live-sandbox.json` | PID namespace 已隔离，`Seccomp=2`、`NoNewPrivs=1`、有效 capabilities 为 0 |
| 原项目及上传树，`cdp-startup-evidence/data-preservation.json` | 原项目除 `updatedAt` 外完全一致；全部 306 个上传文件 SHA256 原样保留 |

fixture driver 结束时会清理临时目录；上面的普通与批量报告是 driver 打印的完整 JSON，
已按原日志字节封存，manifest 保留来源日志及 SHA256，没有重造已删除的临时报告。

构建上下文为 `/tmp/jianji-default-cdp-build-20260929-iyfh8fxa/verification`，
复用上轮已核验安装来源，只替换本次启动入口。构建前旧入口与当前 HEAD 字节完全相同。
当前工作区未提交的其他任务源码没有混入安装包。

## Package Identity

- Base: `qianchuan-recovery-name-20260929-c5a5dcf9`。
- Installed: `/home/reggie/Applications/jianji/releases/cdp-default-20260929-00e98131`。
- `app.asar` SHA256: `00e981313c8c3e72fdac40d9e13ed78421828f22612fbabb73d6c4d2b86220fb`。
- Installed candidate main SHA256: `14797668c731a3ae365bf44f7757397a070037bfaad2c5381d43f50a585b5e44`。
- Source index SHA256: `3245ab44e552103c97eaac0e32cca9ee4ef4eea5769e46b21d27901388bc25c4`。

封存来源证明 `/tmp/jianji-default-cdp-package-proof.json`：仅改动 main 中两条已构建的启动设置，
逆向删除后与原 main 全字节相同；2160 个其他 archive 文件及其元数据保留。
完整新构建与实际包的差别仅为本次两条启动设置，以及构建目录深度改变产生的依赖 debug 路径；
实际包保留原依赖字节及原 debug 路径。原产品自定义名称和上传恢复修复均保留。

## Independent Review

Risk Gate 为 `KIMI_REVIEW_REQUIRED`：新增默认控制 listener 若错误绑定外网，会通过真实可信 renderer
越过本机操作边界。Linux socket 回归通过后，仍独立核对启动顺序及开关覆盖行为。
只读 review 绑定 exact source、preload、driver、diff、构建和实际包证据；Parent 负责裁决。

两轮均为受管 Kimi `deep / k3[1m] / max`、有限 `kimi-maximum-v1`，计入本单元最多三轮预算：

- r1 seal `d70711f3-5a45-447d-b461-5c3df28bbc5e`，invocation `8b0062eb-a4fc-4471-93af-5d9f6a583efd`：
  已发出 2 个 provider requests，362.22 秒后 response body transport 故障，`OUTCOME_UNKNOWN`；没有可采用的完整报告，保留失败 receipt。
- 调查后将未改变的 source 投影为精确启动、窗口、bootstrap 与退出范围，其余 preload、driver 和上下文完整保留。
  r2 seal `f0521b77-18b9-49b7-9c8e-8a979bf12451`，invocation `b37f3e3c-c043-49fb-8883-7d64ce7304f1`：
  2 requests、229.97 秒、`PARSED / exit 0`；7 个完整 Read 的 SHA 与当前源码一致，mechanical route proof 为 `IDENTITY_VERIFIED`。

Parent 根据源码、构建、真实 listener 与 fixture 裁决两个 non-blocking finding：
`F-CDP-01` 的 Windows 实机验证按用户明确要求豁免，不声称 Windows 验收；
`F-CDP-02` 的空值及空格形式 CLI 输入不属于无参数启动或既有 driver 使用的兼容范围。
没有 blocking finding；source gate 已关闭。实际安装问题仍由下方桌面证据核验，不能由 `PARSED` 代替。
源码在 review 后没有变化；本机 helper 配置属于安装纠正，未改变 listener、IPC 或权限合同。
未派发新 native reviewer；此前上传恢复单元的三次 Kimi 失败及 native fallback 轮次保留，未重置或借用。

## AOCI

首次完整读取 188 条索引并完成 10/10 Challenge。稳定源码只产生 `src/main/index.ts` 一个管理候选。
原子 Apply 1/1 更新该条目及源码基线；Verify、Check、Guide 全部 exit 0，`governance_aligned=true`，
Guide `complete=true / next_action=none`。新增 driver 与本记录按现有策略 observe，不扩大索引范围。
桌面验收及本记录稳定后再次执行 Verify、Check、Guide，全部 exit 0，仍 aligned、complete、next action none；
管理源码没有新变化，因此没有重复 Maintain 或扩大索引范围。
恢复上下文时按合同重新完整读取 189 条、3 块、约 22693 tokens，Challenge 9/10，
交付确认及严格证明通过，索引覆盖率 100%；框架掌握度自评 85%，不代表完整源码或运行实况知识。
新增的另一任务连接准备条目不属于本次成果。
共享 `aoci.code.txt` 和 `.aoci/baseline.json` 中该任务的未提交维护按用户既有 ownership 决定保留，
不将整文件混入本次源码提交。本次启动条目和基线已经维护；共享资产的提交仍留待原任务按归属处理。

## Desktop Acceptance

关闭旧实例前重新核实没有活动制作、模型、导出或上传，没有未保存编辑。
备份目录为 `/home/reggie/Applications/jianji/.backups/cdp-default-20260929-00e98131`；
原启动器、旧包、原项目和 306 个上传文件的 SHA 均保留。没有覆盖或恢复上传账本。
`launch.sh` 仅把 executable 改为新版本；`.desktop` 沿用原入口，没有调试或禁用沙箱参数。

实际桌面会话首先暴露 `chrome-sandbox` 为 `reggie:reggie / 0755`，触发 Chromium 的 SUID helper fatal。
隔离进程此前可用，不能替代这个桌面结果；环境变量 helper 选择在本发行二进制中也未生效。
本机已有 `/opt/google/chrome/chrome-sandbox`，所有父目录均为 root 所有且不可由普通用户写入，
helper 为 `root:root / 4755`，SHA256 `4f21eddabe22d24f83b907f9404cb331135acf2d5064292aed106c7794578cb3`。
本次新 release 的 helper 原字节移入私有备份，原路径链接到这个现存可信 helper；没有更改系统权限或 AppArmor。
该本机复用方向参照 [Chromium 的 AppArmor 与 SUID helper 说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)，
最终采用 sibling helper 链接的行为由实际启动、PID namespace 和 seccomp 证明。
它是本机 Linux 安装配置；没有把跨发行环境的可用性当作已验证。

通过用户桌面会话的 `gio launch` 执行原 `.desktop` 文件，实际进程 PID 1479794、argv 只有新 executable；
renderer URL 精确指向新 `app.asar`，动态 CDP port 36321，仅监听回环。
临时 user service 只承载桌面进程生命周期，不添加任何应用参数，未设置开机自启。
经既有项目 owner 恢复氨糖膏后 reload renderer，避免旧 React 名称草稿；界面及 owner 均显示已保存，10 个素材原样保留。
全局上传 251 条仍为 READY 41、PENDING 190、NEEDS_HUMAN 20；第十一条仍为 `MAY_HAVE_UPLOADED`，永久 fence 不变。
桌面截图已直接查看；沙箱与 CDP 是实际运行包证据，未进行新的真实制作或平台文件选择。
安装来源、两轮 reviewer receipt、Parent 裁决、完整 Code Harness receipt、桌面身份、截图、
数据保留和最终治理检查封存在该 release 的 `cdp-startup-evidence`；`evidence-manifest.json` 逐文件记录 SHA256。
候选时的 `installed:false` 来源证明原样保留，实际安装状态另由 `installed-identity.json` 证明。

## Evidence Limits

以上为 Linux 单元、代码 Harness、真实打包软件及隔离 fixture 证据。
不使用用户真实账号重试未知上传，不确认或发布，不修改广告设置。
CDP 能力不改变第十一条未知结果及历史 fence，也不代表真实平台上传或成片人工验收通过。
Windows 按用户要求未做实机验证。
