# Windows Adaptation Spec

## Status And Authority

- 日期：2026-10-10。状态：`DRAFT / SPEC_ONLY`；本轮交付适配规格，不修改产品实现、不打包、不部署、不调用真实模型或千川账号。
- 代码基线：分支 `feat/qianchuan-vps-egress`，commit `a1357b6f606874d5de37c3f8c5dfa1dc950fa821`，`package.json` 为 `0.1.6`。版本号相同不代表与旧 0.1.6 安装包字节或功能相同。
- 工作假设：用户需要当前功能在 Windows x64 安装版中使用；以 Windows 11 x64 为首个资格环境。Windows 10 的具体版本、ARM64、原生 Windows 开发工作流的支持承诺待确定，不以 Electron 能启动推定支持。
- 本文独占本次 Windows 适配增量、阶段准入和新增验收要求。[Windows Acceptance Spec](windows-acceptance-spec.md) 保留通用人工验收清单；[Contract Index](agent-contract-index.md) 指向产品领域合同；历史验证记录只证明对应旧产物。
- 本文不放宽 [AGENTS.md](../AGENTS.md)、既有冻结语义、unknown outcome、安全边界和产品启用条件。后续实施前重新核对源码漂移；本轮不生成 implementation plan，也不授权通过关闭安全检查来消除平台错误。

## Goal

普通 Windows 用户安装简辑后，无需另装 Node.js、Codex、FFmpeg 或 Python，即可完成已经开放的本地视频制作功能；千川账号、浏览器、上传、清理及 VPS 出口须在各自平台能力取得资格后可用。最终完整适配必须包含这些已开放功能，不能以“安装成功”或“本地导出成功”替代。

允许分阶段交付本地制作能力，前提是界面明确展示尚不支持的功能及原因，主进程继续拒绝相关副作用；阶段性交付不得标记为全部 Windows 适配完成。

## Scope

| Area | Required target | Boundary |
| --- | --- | --- |
| 安装与升级 | Windows x64 原生构建、NSIS 安装、升级、启动和正常退出 | 安装不依赖开发目录、系统 Node.js 或管理员方式运行应用；不承诺本轮代码签名采购 |
| 本地制作 | 导入、模板、手填文字、贴纸、边框、手动真实图案覆盖、批量制作、追加、冻结重试和导出 | 保留原制作 owner、并发、数量和媒体合同 |
| 模型与自动覆盖 | API、应用独立 ChatGPT、自动识别及当前已开放 Hybrid | 保留型号、视觉能力、取消、H4 同字节准入；旧 strict/proof 研究不随适配启用 |
| 本机千川 | 账号配置、专用 Chrome、计划读取、分组上传、原页核查、清理及本地人工处置 | 不新增发布确认；没有平台资格时显式阻断 |
| VPS 出口 | A：本机 Chrome 经 SSH SOCKS；B：Windows 客户端连接 Linux 远端 Chrome | B 的远端 worker 保持 Linux；不扩展为 Windows VPS worker |
| 定时执行 | Windows 用户会话内的系统定时启动及原清理调度 | 不要求开机、唤醒、未登录后台运行或补执行错过的清理 |
| 数据兼容 | 同一 Windows 用户升级、旧项目/冻结任务读取、权限错误与损坏恢复 | 不自动迁移 Linux Chrome 登录目录、凭据或历史平台授权；跨机路径迁移不在本次范围 |

## Current Code Evidence

以下为源码核对结果；“已有实现”不等于当前基线在 Windows 实机验收通过。

| ID | Current behavior / gap | Source owner and implication |
| --- | --- | --- |
| B01 | 已有 NSIS、FFmpeg/ffprobe、字体和 Codex 打包配置 | [package.json](../package.json)、[prepare-win-ffmpeg.mjs](../scripts/prepare-win-ffmpeg.mjs)：准备脚本明确限定 Windows x64，固定 FFmpeg 8.0.1 及哈希；无需重建打包体系 |
| B02 | 已有 Windows 二进制、字体和 Codex 路径分支 | [platform.ts](../src/main/platform.ts)、[ffmpeg.ts](../src/main/ffmpeg.ts)、[model-connections.ts](../src/main/model-connections.ts)：`.exe`、Windows PATH、字体、`app.asar.unpacked` 和独立应用目录已处理；仍需验证最终包 |
| B03 | 已有跨平台 CI，但配置存在不证明当前执行通过 | [desktop.yml](../.github/workflows/desktop.yml) 配置 Ubuntu/Windows 的 typecheck、test、build；[release.yml](../.github/workflows/release.yml) 打包上传，未包含最终安装版完整业务验收 |
| B04 | 已有 Windows 安装版 smoke 和旧版本证据 | [packaged-runtime-smoke.mjs](../scripts/packaged-runtime-smoke.mjs)、[installed-acceptance-smoke.mjs](../scripts/installed-acceptance-smoke.mjs)、[0.1.6 record](windows-verification-0.1.6.md)；旧证据未覆盖本基线新增千川、VPS、人工覆盖及 Hybrid 全链路 |
| B05 | 千川私有配置明确拒绝 Windows | [qianchuan-account-config.ts](../src/main/qianchuan-account-config.ts) 的 `readPrivateJson` 返回 `PLATFORM_UNQUALIFIED`；当前 UID/mode、`O_NOFOLLOW` 和前后文件身份检查需要 Windows 等价能力 |
| B06 | 上传账本权限和持久屏障明确拒绝 Windows | [douyin-upload-store.ts](../src/main/douyin-upload-store.ts) 的 `secureUploadDirectory`、`strictSyncDirectory`；不能只删 `win32` 分支或把目录同步替换为空操作 |
| B07 | 专用 Chrome 生命周期限定 Linux | [qianchuan-browser-manager.ts](../src/main/qianchuan-browser-manager.ts)、[qianchuan-browser-discovery.ts](../src/main/qianchuan-browser-discovery.ts)、[qianchuan-browser-process.ts](../src/main/qianchuan-browser-process.ts)：Linux 可执行文件候选、进程发现及 Python/pidfd 身份固定退出机制不能直接搬到 Windows |
| B08 | 两种 VPS 模式的客户端有 Linux 路径依赖，B 还受前置平台门阻断 | [qianchuan-egress-runtime.ts](../src/main/qianchuan-egress-runtime.ts) 使用 `/usr/bin/ssh`、`/usr/bin/curl` 及 POSIX 环境；[qianchuan-remote-transport.ts](../src/main/qianchuan-remote-transport.ts) 使用 `/usr/bin/ssh`；`QianchuanBrowserManager.ensure/control/existingConnection` 在 remote-browser 分支前检查 Linux。只改 SSH 路径不够，调整模式准入仍须保留本地账本及账号资格 |
| B09 | 系统定时启动只支持 Linux | [qianchuan-scheduled-launch.ts](../src/main/qianchuan-scheduled-launch.ts) 生成用户 systemd 单元，Windows 状态为不支持；应用内调度与 OS 启动是不同职责 |
| B10 | 普通导出与冻结 PNG 的文件系统能力不同 | [paths.ts](../src/main/paths.ts) 的正式输出支持 hardlink 失败后独占复制；[shape-cover-freeze.ts](../src/main/shape-cover-freeze.ts) 的 `publishShapeCoverPng` 使用 hardlink，没有同样后备；不能把成片 exFAT 支持外推到冻结素材目录 |
| B11 | 部分持久层已有 Windows 特例，不能作为平台提交屏障证明 | [source-sticker-knowledge-store.ts](../src/main/source-sticker-knowledge-store.ts) 对 Windows 跳过目录 sync；[store.ts](../src/main/store.ts) 与 [paths.ts](../src/main/paths.ts) 另有发布/恢复策略；这些不授予上传或删除的 durable fence 资格 |
| B12 | Python 几何路线不等于当前 Hybrid 生产路线 | [source-mask-static-geometry.ts](../src/main/source-mask-static-geometry.ts) 的 Linux/Python/OpenCV 固定 worker 属于 strict/proof；[shape-cover-hybrid-h3.ts](../src/main/shape-cover-hybrid-h3.ts) 直接调用 TS discovery、mask extraction、motion、shape search 和 FFmpeg seam，未调用该 worker；本次不因此新增 Python 安装依赖 |
| B13 | 开发辅助入口含 POSIX 命令 | [Makefile](../Makefile) 使用 shell、`env -u`、`/tmp`；[dev.mjs](../scripts/dev.mjs) 已有 Windows 进程分支。Windows 构建使用 npm/PowerShell，不能宣称现有 `make frontend` 原样兼容 |

启动接线也须验证：[index.ts](../src/main/index.ts) 捕获上传 store 加载失败后仍调用 `restoreConfig`、`beginProduction` 并继续构建应用。本轮只确认这条接线存在，不能仅凭 catch 推定整个 Windows 启动和本地制作已安全降级。

## Architecture And Ownership

复用既有领域 owner，只在操作系统能力边界增加最小适配。平台差异不得散落为 renderer 特判，也不另建 Windows 队列、批准、凭据库或上传账本。

| Platform boundary | Existing owner | Required change contract |
| --- | --- | --- |
| 程序与资源定位 | `platform.ts`、`ffmpeg.ts`、`model-connections.ts` | 按运行平台、架构及 packaged/dev 状态解析；不依赖 cwd；运行时缺件准确拒绝 |
| 私有文件与屏障 | `qianchuan-account-config.ts`、`douyin-upload-store.ts`、`qianchuan-browser-bindings.ts` 及清理持久层 | 提供可验证的 Windows 文件身份、访问控制、排他创建与持久提交；业务状态转换留在原 owner |
| Chrome 身份和进程 | `qianchuan-browser-manager.ts`、`qianchuan-browser-discovery.ts`、`qianchuan-browser-process.ts` | 平台实现负责查找/固定进程和正常退出；账号、profile、CDP 与任务保护仍由原 owner 判断 |
| SSH 与出口探测 | `qianchuan-egress-runtime.ts`、`qianchuan-remote-transport.ts` | 平台化受信二进制定位和进程生命周期；A/B 协议、出口租约及未知结果不变 |
| 定时启动 | `qianchuan-scheduled-launch.ts` | Windows Task Scheduler adapter 只启动应用；原 `qianchuan-video-library-schedule.ts` 持有授权、当天 claim 和结果 |
| 能力呈现 | `index.ts`、`shared/desktop.ts` 及相关设置组件 | 在已有公开状态中表示实际能力和阻断原因；主进程在副作用前重核，不能只禁按钮 |

实现时对有多个调用方的 OS primitive 建立内聚模块；不继续把权限、进程发现和系统任务注册塞入 `index.ts` 或已过大的领域文件。不为一次调用建立泛用插件框架。

## Requirements

### R01 — Installation And Resources

1. 在 Windows x64 从锁定依赖原生构建。安装包包含当前平台 Codex、FFmpeg/ffprobe、所有实际使用的离线字体/贴纸/边框资源及许可证；校验目标平台二进制，禁止使用 Linux `node_modules` 交叉替代。
2. 从快捷方式、资源管理器及非仓库 cwd 启动，普通用户可完成制作；安装目录只承载只读程序资源，写入使用应用 userData、项目或用户明确选择的输出目录。
3. 对不存在/损坏的内置引擎、字体、Codex、资源 manifest 给出具体错误；不在制作时下载另一套 runtime 或静默换模型。沿用既有显式自定义引擎入口。
4. 同用户升级保留项目、连接、上传屏障、清理 pending、冻结贴纸和边框；新进程启动不自动恢复未完成分析、上传或删除。真实用户数据不用于破坏性安装/卸载测试。
5. 无签名构建如实标记；签名、图标和分发策略单独记录，不把 Windows 安全提示处理成要求关闭系统防护。

### R02 — Paths, Persistence And Media

1. 普通媒体操作覆盖盘符、中文、空格、单引号、`&`、大小写别名及系统保留文件名；Windows 不允许的文件名须在创建前拒绝或由既有命名 owner 安全生成。参数以 argv 传递，不拼 shell 命令。
2. 基础资格以本地 NTFS userData、项目、冻结资产及输出为必需环境。允许 exFAT 成片目录时必须验证普通发布后备；需要 hardlink 的冻结目录明确要求可用能力，或在同一冻结 owner 提供等价无覆盖实现，不能写到不支持的目录后伪装完成。
3. UNC、网络盘、OneDrive/同步目录、长路径、junction/reparse point 的支持须逐能力实测。未取得私有身份/持久屏障资格的目录不得承载千川状态；不因普通视频可读就授予私有状态目录资格。
4. 打开句柄占用、磁盘满、权限拒绝、重名竞争、进程中断和损坏状态须有可解释的结果。不得覆盖源片和已有成果，未知提交不当作“未执行”；不以任意清锁恢复。
5. 每素材版本、批量 requestedCount、手填文字开关、边框及手动真实图案覆盖遵循原合同；重试使用冻结字节，不重新分析、选款或重算文字。
6. Windows 实际运行 FFmpeg 及 ArtifactVerifier，验证画布、时长、原帧率、音轨及完整解码。冻结 PNG 从原 userData/项目读回，改字节后必须拒绝；人工播放覆盖全片。

### R03 — Model And Process Lifecycle

1. API、ChatGPT、创作/视觉/复核角色继续由 `ModelConnections` 和 `ChatGPTSession` 独占。API Key 不进入 renderer/项目/日志；ChatGPT 仍隔离在应用目录，不读写全局 Codex 登录。
2. 验证包内实际 Codex runtime 的登录、模型发现、工具禁用、请求、取消、超时及退出。仅参数里写了 `read-only` 或“禁工具”不作为真实能力证据。
3. 仅管理本应用拥有的 FFmpeg、Codex 和 SSH 子进程；不得使用按进程名全局 `taskkill`。账号 Chrome 遵循单独的正常退出合同。取消后不留下继续请求、写出或占锁的本应用后代进程。
4. Hybrid 与人工覆盖各跑自己的 Windows fixture 和安装版路径。Hybrid 未确认角落保持原样，只有 H4 PASS 的同 frozen bytes/binding 角落可以输出；不把 Python 研究验证启用为生产后备。
5. GPU 与并发以实际试编码、并发探测和导出为准；NVENC 不可用时只使用原已验证 CPU 回退，界面说明原因。不因驱动字符串或编码器列表存在而宣布可用。

### R04 — Private Files And Durable Side-Effect Fences

这是千川功能解除 Windows 阻断的前置条件，不能延后到真实上传以后补验。

1. Windows 适配须绑定当前用户 SID、文件/目录实际身份和有效 DACL；拒绝不应读取或写入的其他普通主体、非普通文件及危险 reparse/路径替换。受信系统主体和继承权限的明确规则须在实施设计中冻结并测试；`chmod(0600)` 成功不能代替 DACL 证明。
2. 对账号配置、Chrome 绑定、账本、selection fence、删除 pending、人工处置归档和调度 claim 保留读取大小界、前后身份/字节核验、排他创建、锁及原子状态转换。Windows 实现须证明打开的是核验过的对象，不能单靠一次 `realpath`。
3. 在任何文件选择或平台删除确认之前，永久意图必须达到可恢复的持久提交点。实现设计需明确 Windows primitive、支持文件系统、崩溃恢复判据及 I/O 错误语义；资格未证明时保留 `PLATFORM_UNQUALIFIED`。禁止复制普通媒体目录 sync 的 best-effort/跳过行为。
4. 故障注入覆盖写入前、文件 flush 后、元数据发布前后、组内部分 fence 成功、账本提交前后及重启读取。任何可能已选择/删除但证据不全的结果进入原 UNKNOWN/阻断路径；保留原字节，不删除屏障再试。
5. 若需要平台 helper，必须最小权限、固定协议、版本/哈希绑定、随包交付并验证 ABI/架构；不得要求用户关闭 UAC、防病毒或授予全盘 Everyone 写权限。helper 的具体技术选择不是本 spec 已证明的结论。

### R05 — Chrome And Qianchuan

1. 支持受信 Windows Chrome 定位及当前用户专用 profile；发现和复用前核对用户、实际 executable、进程实例创建身份、profile 和 loopback CDP。缺失或无法唯一归属时明确拒绝，不能把任意可连 CDP 当目标账号。
2. 关闭/重启须在原任务保护门之后，固定原浏览器实例并正常退出；验证退出的是同一实例。PID 重用、身份变化、未退出或未知均拒绝继续；不强杀、不删 Chrome 锁、不复制登录资料、不另建 profile 规避原状态。
3. 只读计划目录、上传、视频库清理和计划素材清理分别取得资格；支持只读操作不授上传/删除权限。账号显示名称保持展示字段，身份仍绑定 advertiserId、adId 和既有 profile。
4. 上传保持原队列、每组最多 9 条、永久 selection fence 先于选择文件、整组 ready 后继续。仅到“待用户在 Chrome 确认”，应用不点击上传“确定”或登记平台接受。
5. UNKNOWN/MAY_HAVE_UPLOADED 只允许既有原页只读核查；新平台实现不得恢复旧授权、自动重传、改写旧 fence 或迁移到其他浏览器。
6. 清理仍使用明确账号/计划集合、原筛选条件和持久删除意图。历史未知素材 ID 永久受保护；`PARTIAL` 可处理合资格其他候选，但不得把人工处置记录解释为平台删除成功或重试权。
7. 验证先使用独立 userData/profile、合成成片、本地页面 fixture；真实上传/删除需另有精确账号和操作范围授权，本 spec 不构成授权。

### R06 — VPS Egress

1. Windows 客户端以受信绝对路径调用经过验证的 OpenSSH 和出口探测实现；若依赖系统可选组件，安装/设置页面必须准确检测并提示。未就绪只阻断相应 VPS 模式，不影响本地制作，也不回退直连。
2. 保留非交互、严格主机指纹、固定 SSH host alias、禁止 agent forwarding、loopback 监听和端口冲突检查；不把私钥内容放入应用配置、renderer、argv 或日志。
3. A 模式同时验证 SOCKS 通道和本机 Chrome 实际出口；保留浏览器防旁路参数约束。B 模式验证远端 Linux worker、远端浏览器和文件映射，Windows 本地成片路径不直接交给远端文件选择器。
4. 通道中断撤销原租约，用户显式重连只恢复连接条件；不恢复上传授权、不新开替代远端窗口、不清 selection fence。断线前后同一文件是否已选择不确定时仍 UNKNOWN。

### R07 — Scheduled Launch And Capability UX

1. Windows OS adapter 使用当前登录用户的 Task Scheduler 任务启动同一安装实例；精确归属、参数引用、任务名冲突及升级后 executable 路径必须可验证。不得覆盖其他程序任务或申请无关提升权限。
2. 只在明确启用后注册/更新；停用删除或禁用本应用拥有的任务。未登录、休眠错过、电脑关闭不补删；启动来源不会授予新的清理授权，重复触发仍由原当天 claim 去重。
3. 区分应用内调度可用、OS 自动启动可用、账号/清理资格可用。只有后两者分别通过才能展示相应成功状态；任务注册成功不等于平台清理成功。
4. 任一可选功能不可用时，错误应落在对应设置/操作处；未选择上传的本地制作保持可用。千川拒绝不得导致白屏或让普通制作必需配置账号。
5. Windows 100%、125%、150%、200% 缩放及窄窗口实测主要操作；批量模板既有同排控件保持可访问，按现有设计横向滚动。不得以 CSS 截断隐藏错误、完整账号/计划识别信息或关键按钮。

## Acceptance Matrix

每项绑定 exact commit、dirty diff（若有）、安装包 SHA256、Windows build、架构、文件系统、执行时间和证据位置。状态使用 `PASS / FAIL / BLOCKED / NOT_EVALUATED`；Linux 模拟 Windows、注入假的 durability、源码测试和旧包记录均不能替代相应实机证据。

| ID | Acceptance | Required evidence |
| --- | --- | --- |
| WA01 | 干净普通用户安装、升级、非仓库 cwd 启动、正常退出；内置资源齐全 | 最终 NSIS 与实际安装目录、资源哈希、无开发 PATH 的 packaged smoke；沿用 W01/W02 |
| WA02 | 当前源码 Windows typecheck、相关测试、build 成功 | CI 或 Windows 原生完整日志；逐项解释 skip，必需功能不能以 skip 通过 |
| WA03 | 无模型/无千川配置仍可单项目、批量、追加、手动真实图案、文字/边框制作 | 最终安装版操作、IPC、冻结模板、真实 FFmpeg、零模型计数、源/成片哈希 |
| WA04 | NTFS 路径与发布、exFAT 输出、重名及占用失败符合 R02 | 中文特殊路径、哨兵文件、故障注入和重启记录；不支持目录有明确拒绝 |
| WA05 | 实际模型连接、角色、自动覆盖、Hybrid 的 Windows 生命周期 | 先隔离 fixture；真实模型另授权后保留实际请求/结果、H4 binding 和取消/退出证据 |
| WA06 | 私有配置与所有副作用持久状态符合 R04 | Windows SID/DACL、reparse/替换竞争、flush/提交故障、进程中断重启；没有资格则所有副作用前拒绝 |
| WA07 | Chrome 启动、复用、读取、关闭、重启精确绑定原账号实例 | 独立 profile fixture、PID 重用/端口占用/身份漂移测试；旁边无关 Chrome 保持正常 |
| WA08 | 安装版千川上传及恢复符合 R05 | 原生文件选择、9 条分组、fence 顺序、UNKNOWN 原页只读；真实平台另授权并止于确认前 |
| WA09 | 库/计划清理及人工处置不破坏历史保护 | fixture 覆盖 frozen 双 ID、pending、保护 ID、PARTIAL、孤立归档和损坏；真实删除独立授权 |
| WA10 | A/B 出口、传输、取消和断线符合 R06 | Windows 本机 A 与 Windows→Linux B 分别记录；出口核查、分片 hash、断线后零重传 |
| WA11 | 定时任务归属、登录条件、停用、升级路径和当天去重符合 R07 | 隔离 Windows 用户任务、重复/错过触发、持久 claim；注册与删除结果分开 |
| WA12 | 界面可操作，成片可观看，资源和进程收尾正确 | 缩放截图及真实交互、全片连续播放/听音、正常退出后的子进程/锁检查 |

[Windows Acceptance Spec](windows-acceptance-spec.md) 的 W01–W30 等通用用例继续适用；若旧清单示例与当前领域合同不一致，按 canonical contract 校正后执行，不复制旧模型、计数或默认值。未来适配测试应登记到原 Harness policy；不建立第二份可执行检查 registry。

## Delivery Gates

| Gate | Exit criteria | Allowed claim |
| --- | --- | --- |
| G0 — Baseline | 当前源代码、依赖、Windows build/架构和本次实际需求被冻结；重新评估 B01–B13 | 适配范围已确定，不声明 Windows 可用 |
| G1 — Local Production | WA01–WA05 的本地/模型路径、WA12 相关项及 Linux 回归完成；不可用千川不阻断本地制作 | 仅已验证本地功能可用，列出真实模型/人工未评估项；缺必需项不算此 gate 完成 |
| G2 — Qianchuan | WA06–WA09 完成；所有平台权限/持久能力真实资格成立 | 对实际通过的千川操作声明可用；fixture 不冒充平台验收 |
| G3 — VPS And Schedule | WA10–WA11 完成；A/B、OS 启动及清理分别有证据 | 仅相应模式和目标环境可用 |
| G4 — Complete Adaptation | 所有适用 WA 项、通用 Windows 清单、最终包测试、Linux 回归及人工观看闭合 | 本 spec 范围的 Windows 适配完成；仍需公开明确的环境限制 |

任何 G2/G3 blocker 都不应触发降低安全门；可以交付清楚标注限制的 G1 阶段包，但完整任务保持未完成。最终包变更须重跑受影响验收并重新绑定哈希。

## Verification Entry Points

后续实施使用现有入口；以下不是本轮已执行记录，也不代替 Harness owned-scope 路由：

```powershell
npm ci
npm run typecheck
npm test
npm run package:win
node scripts/packaged-runtime-smoke.mjs "实际安装目录"
node scripts/installed-acceptance-smoke.mjs "实际安装目录" "隔离证据目录"
Get-FileHash -Algorithm SHA256 "dist\jianji-setup-0.1.6.exe"
```

构建前按现有准备脚本校验固定引擎，媒体测试显式定位目标 FFmpeg；版本改变后使用实际文件名。现有 smoke 覆盖不足的路径要扩展对应原测试 owner，不能把上面数条命令直接当 WA01–WA12 全部完成。跨平台共用逻辑仍做 Linux 回归，required skips/缺件必须显式报阻断。

## Open Decisions And Self-Review

- 目标 Windows 具体 build、GPU、常用输出盘类型及是否必须兼容 Windows 10 待用户/实机信息确定；不阻碍先围绕 Windows 11 x64 NTFS 起草，但阻止外推兼容承诺。
- R04 的 DACL/文件身份/持久提交以及 R05 的固定实例正常退出，需要实施阶段选择并验证具体 Windows primitive；本 spec 规定不变量和资格证据，不预设某个未经验证 API 就能满足。
- 后续明确进入实施时，应在本 spec 的接受范围内生成 durable implementation plan，按 G0–G4 安排；本轮保持 spec-only。
- Self-review：已有 NSIS 和基础 Windows 分支应复用；明确缺口与待实测项已分开；未把旧 strict Python 路线当 Hybrid 依赖；未改变领域语义、模型权限、旧冻结格式或 UNKNOWN 恢复；未新增平台发布/删除授权。
- 本轮证据仅为当前源码、打包/CI 配置与历史记录边界核对、CodeGraph 关系辅助和文档验证。当前基线的 Windows 构建、安装、GPU、真实模型、千川平台行为与人工播放均为 `NOT_EVALUATED`。
