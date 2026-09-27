# Status

2026-09-27：本次实现授权来自用户要求实施 `docs/superpowers/plans/2026-09-27-douyin-auto-upload.md`，随后明确选择“先完成离线实现与验证”。离线 uploader 已接入；**真实抖音页面合同尚未核实，生产自动上传/发布保持阻断**。这里没有真实账号、真实 selector、真实接受状态或真实发布验收的证据。

实施起点是 `788fdbf`。适用 spec SHA-256 为 `b606362daa7e73f6780c644ea86735a4e1976d2f4a336afdc439b183660de710`，适用 plan SHA-256 为 `71e2f995138dbb59afaa5589398d181991ff7031a59351ed31aa49fe449d283a`。历史 frontmatter 的 proposed/not_started 描述规划时状态，不代表本次用户已授权的离线实现验收。

# Production Gate

- `VERIFIED_DOUYIN_UPLOAD_PATHS` 为空，拒绝保存猜测的上传路由。
- `DouyinCdpUploader` 的生产页面合同为空，在 CDP discovery、选文件、填字段或发布动作之前返回 `NEEDS_HUMAN(PAGE_CONTRACT_UNVERIFIED)`。
- 测试页面合同仅由隔离测试构造函数注入；不存在 renderer/config/env 的 fixture origin 放行开关。
- M0 仍需操作人指定专用 Chrome/profile，核实选文件不会直接发布、账号信号、唯一控件、必填字段、处理 ready、一次发布序列、稳定非草稿内容 ID 与同 ID 管理页接受状态。禁止从本地 fixture 推定真实页面结构。
- M6 还需要用户指定账号/profile、一条最终 MP4 和明确真实发布授权。实施本计划、测试通过和开启全局能力均不授权验收时试发真实视频。

# Offline Contract

`DouyinPageContract` 是 adapter 的有限源码合同：上传地址、安全选文件事实、手工 caption 限制、文件/caption/ready/publish、登录/挑战/账号/拒绝信号，以及稳定内容 ID、接受状态和同 ID 管理页定位。只有匹配合同且唯一的目标可操作；不得使用 `.first()` 消除歧义。上传与提交分开，提交只能在 Store 同步完成不可覆盖 marker 后调用一次。

成功必须由受控任务 tab 取得稳定 ID，并通过普通管理页导航重开同 ID，确认 `reviewing` 或 `published` 后保存。草稿、文件进度、跳转、标题相似或 click 返回均不构成接受。重连无法证明原提交页面归属时，仅报告人工核查；不会另开页面重新上传。

HTTP discovery 与返回 WS 分别验证 literal loopback、无凭据、无 query/fragment。HTTP 不跟随 redirect；CDP 通过 uploader 自有的 loopback relay 连接，WS redirect 也不跟随。停止关闭 relay，冻结后续自动动作并保留 Chrome、default context 和人工接管 tab。固定 runtime 为 `playwright-core@1.63.0`；版本升级需重验 detach 与迟到动作。

# Persistence And Recovery

用户数据目录下 `douyin-upload/` 独占上传配置、精确授权、冻结任务、结果与 append-only 提交标记；不修改 Project/ExportTask schema。JSON 复用 `atomicWriteJson`，再显式同步目录；提交 marker 采用 exclusive create、文件 sync 与目录 sync，任一步失败均禁止发布。损坏/未知记录、孤立 marker 或旧备份不能恢复发布许可。

半自动审阅 prepare/approve 入口明确拒绝上传选项，在任何草稿写入或模型执行前停止，避免手工发布文案进入可分享的 `requestJson`。该流程不在本次上传支持范围内。

同 task 视频字节改变被拒绝；已成功或有 marker 的同字节跨 job 去重；不同手工文案不授权再次发布。启动只做本地 reconciliation，旧 pending 不因后来新任务完成而自动执行。人工继续、有 marker 的恢复和取消均不能清除屏障或再次发布。

POSIX 目录要求 0700，状态/marker/log 0600，私有快照 0400。最小日志只在本机，7 天/100 MiB 上限。默认不截图、不保存完整 DOM、network 或 console；目前没有可靠的敏感区域遮挡合同，即使选中诊断也不采集无法保证脱敏的页面。Windows directory durability 与 ACL 尚未实机核实，当前发布屏障在 Windows fail closed；交叉构建不等于 Windows 使用验收。

# Verification Boundary

离线检查组 `douyin-upload` 覆盖共享合同、store、service、两条正式导出边界、页面 port 和 UI。集成故障注入确认：completed save 成功前零通知，save 拒绝时零上传；路径碰撞绑定实际最终文件；通知或 intent 初始化失败不改变导出完成状态；未知结果保持 marker 并仅允许核查。

Kimi 边界调查使用受管 deep route，canonical receipt `f8560d1f-0129-4592-88cd-f8df8142d7d8`，已核对实际 source Read 与 identity；最初输出预算不足的 receipt `13a08a0e-1708-4339-a56b-332a5ca4f3be` 不作为调查完成或验收证据。调查发现的既有 completed-save 失败后错误转移行为已被故障注入固定为零上传；本任务未扩张为导出生命周期重构。

任何离线/fixture 证据都不能升级为真实抖音或人工画面验收。

# Implementation Checkpoint

| Milestone | Current evidence / remaining gate |
| --- | --- |
| M0 | 固定 runtime 与 POSIX marker 故障测试已执行；真实后台页面、目标账号与 Windows durability 未核实 |
| M1–M3 | strict schemas、持久屏障、串行执行、精确授权与两条正式完成通知已实现并通过离线故障注入 |
| M4 | 有限页面 adapter 与离线接受/挑战/漂移/取消测试已实现；生产合同仍为空 |
| M5 | UI/IPC、Harness group、文档、runtime dependency 与 Linux 打包已接入；开发版桌面与真实 packaged attach 通过，记录见下文 |
| M6 | 本机完整回归已执行；真实单条发布与同 ID 后台接受验收未执行 |

# Verification Record

2026-09-27，本机 Linux x64，Node `v22.21.0`、Electron `33.2.1`、`playwright-core@1.63.0`：

- `npm test`：135 files / 1165 tests PASS，3 tests skipped。跳过项为两个 Windows 专用能力测试，以及需要显式 `JIANJI_LIVE_ASSETS=1` 的在线素材测试；没有使用用户模型账号或真实抖音账号。
- `npm run package:linux`：包括 fresh typecheck/build，生成 AppImage、deb 与 `dist/linux-unpacked/`；已检查 `app.asar` 包含 `playwright-core/package.json` 和 `lib/coreBundle.js`。这是构建证据，不代表安装器或 Windows 实机验收。
- 中途 Harness `20260927T075025Z-5d83b404` 的检查组通过，但 smoke helper 在运行期间变化，整体正确返回 `NOT_EVALUATED(workspace-identity)`；该回执不作为最终完成证据。
- 最终 `npm run harness -- code`：`20260927T082851Z-fe20e32d` 为 PASS；已核对最终 receipt 的全部必需检查与 before/after 源码身份一致。新增 `douyin-upload` 组 56 tests PASS；Harness 的 `visualReview=NOT_EVALUATED` 保持明确，不代替上述隔离桌面 smoke 或真实平台验收。
- 新增真实进程退出注入：marker 文件 sync 后、mutable task state 保存前退出，重开记录仍保持可能已提交；不能创建新的发布许可。
- 新增取消注入：relay 启动期间 abort，旧代码仍尝试一次迟到 CDP attach；修正后零 attach，相关测试通过。
- 新增停止与准入交错注入：旧代码会让停止期间完成的 admission 重新加入自动执行集合，后续新成片唤醒旧任务；修正后旧任务保持 PENDING，需要明确继续。
- 桌面 smoke 环境诊断：默认 FFmpeg 4.3.2 缺少 `-fps_mode`；已有 7.0.2 静态版本缺少 `drawtext`，运行时 `ready=false` 正确锁定导出。没有绕过 UI/主进程能力准入。使用配置的 Ubuntu 软件源下载 `ffmpeg` 与 `libavdevice60`，仅解包到 `/tmp/jianji-douyin-ffmpeg-6/`；FFmpeg/ffprobe `6.1.1-3ubuntu5` 经本机 filter/参数/动态依赖核查用于隔离验收，没有安装或替换用户引擎。
- 开发版 Electron smoke：`/tmp/jianji-douyin-upload-smoke-uIjvHE/report.json` 为 PASS。使用合成 2 秒 MP4 实际导出、原 production preload 与 IPC；本次选择默认关闭、切项目与提交后清空，价格和 caption 独立。保存并重开同一项目后上传状态保留；生产实例的 sentinel CDP 请求始终为 0。
- Parent 独立重跑 CDP fixture：`/tmp/jianji-douyin-parent-cdp-cGMgYQ/report.json` 为 PASS，Google Chrome `149.0.7827.53`，独立 profile。本地接受与未知结果两次提交均在 durable marker 之后；同字节去重、unknown resume 不重复发布、challenge 零 marker、停止零迟到发布；detach 后原 tab 与 Chrome 进程仍存在。所有网页发布均仅针对本地 fixture。
- Parent 独立运行真实 Linux packaged Electron：`/tmp/jianji-douyin-parent-packaged-fL4BKS/report.json` 为 PASS。`app.isPackaged=true`，从 `app.asar/node_modules/playwright-core/index.js` 载入 runtime，实际 CDP attach 并导航本地 fixture，然后 detach；原 tab 与 Chrome 仍存在。不是仅查看 asar 文件或从工作区依赖代替打包依赖。
- 完整 packaged smoke：`/tmp/jianji-douyin-upload-smoke-2xKVnp/report.json` 为 PASS，实际 production preload/IPC、真实 FFmpeg 导出、保存并重开同一项目、包内 Playwright attach 与全部 fixture 恢复/取消场景通过；生产 sentinel CDP 请求为 0。中途测试修正仅涉及原生对话框 stub、实际 userData 定位与 serialized Electron evaluation 的 module loader，不放宽生产准入。

# Implementation Review Risk Gate

当前稳定代码身份为 AOCI Guide 的 business-source SHA-256 `a9df2d8cadc66dd5ed20fa872d3ee217c9f5a5d94bdfbed47de43031ff112aae`，起点 `788fdbfaeb25dccbbfe58e1616ecb2929365c6a5`；CDP adapter 当前字节 SHA-256 `32b81a1791b31f6e99d6c9870c9273c0e66e33810c5baf4ae8b80431fafda735`。最终 Harness 另绑定实际源码与测试快照。

Parent 判定本离线 checkpoint 为 `KIMI_REVIEW_NOT_REQUIRED`：用户没有要求此 implementation snapshot 的 Kimi review；生产合同为空且无任何可配置绕过路径，默认生产实例在 discovery 前阻断，当前变更没有可执行的真实账号发布路径；导出保持 canonical queue，上传通知与存储故障已注入验证，未发现重大持久状态损坏路径。剩余实质验证缺口是尚未提供的真实页面/账号和 Windows durability，按 M0/M6 保持阻断；adversarial source review 不能补出这些外部事实。这不预先判定将来启用生产合同的 Review Risk Gate；启用时必须基于新 snapshot、页面与真实接受证据重新判断。

AOCI 只维护本次受影响 Code Entries 与对应 Baseline；Verify、Aggregate Check 与 Guide 均通过，Guide 为 `complete=true / next_action=none`。没有把索引对齐当成运行验收。当前仓库与已安装技能未提供专用 session-record/capture skill；本文件记录本次实施与验证边界，不写入全局 memory。
