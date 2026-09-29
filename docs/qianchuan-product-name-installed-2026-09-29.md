# Qianchuan Product Name Installed Delivery

## Goal And Result

用户要求更新正在使用的 Linux 安装版，使作品页账号设置支持更换产品名称、保留原 Chrome 连接。已原子切换桌面 launcher，启动最终安装程序，重新打开更新前项目，并展开“产品名称”输入框。没有修改真实账号名称、点击上传继续、确认或发布。

源码行为与测试见 [Implementation Record](qianchuan-product-name-2026-09-29.md)，安装授权见 [Implementation Plan](superpowers/plans/2026-09-29-qianchuan-product-name.md#authorized-installed-delivery)。

## Installed Artifact

- 原 release：`/home/reggie/Applications/jianji/releases/qianchuan-20260929-fd56869`，完整保留。
- 新 release：`/home/reggie/Applications/jianji/releases/product-name-20260929-preserved-7c667d3`。
- 桌面入口：`/home/reggie/Applications/jianji/launch.sh`；保留原运行库及 FFmpeg 环境，仅更换 executable 路径。
- 完整关闭应用后的备份：`/home/reggie/Applications/jianji/.backups/product-name-20260929-7c667d3`，含原 launcher 和 userData。
- `app.asar` SHA-256：`995a30011d999e561e2bb07501cf0a5baa00baa9b740d4449c7f01ef57bd382e`。
- 主 bundle SHA-256：`5754d93576783e0bb67e07bd970b09177230a0def6fa768555c0fa5ef8193cb4`。

安装包使用原 release 的 runtime、依赖及资源。构建输入来自与原安装 renderer 字节相同的既有冻结源码 `/tmp/jianji-qianchuan-batch-upload-20260929`，恢复原包已部署的账号区域 guard，再叠加 `7c667d315c8377c57abe79ac4caf38d1ae4e5965` 的五个名称相关源码文件；逐文件核对这五份源码与 commit 字节相同。没有将其他会话当前未提交源码装入安装包，不声称这是完整 Git checkout 重建。

构建主 bundle 与原包比较：除两处名称模块外，其余 114 个源码模块保持相同；依赖的构建目录诊断名称仅多一级 `../`。安装时仅替换原主 bundle 中 `src/shared/qianchuan-account.ts` 和 `src/main/qianchuan-account-settings.ts` 两段，核验结果与新构建的诊断路径归一化后字节相同；通过 JavaScript 编译检查。其他主进程模块、项目 schema、上传逻辑和原账号 guard 保留原字节。renderer 来自冻结输入完整 Vite 构建，覆盖三个已提交界面文件。

归档逐路径、内容和文件 metadata 核对：2158 份文件内容不变；改变 `dist/index.html` 和 `dist-electron/main.cjs`，renderer JS 由 `index-DNJen7pl.js` 换为 `index-Dydvm2kt.js`。preload 和 CSS 不变；七份 Codex 解包文件的字节与 unpack/executable/link metadata 保持一致。首次归档的 unpack pattern 未命中绝对文件路径，metadata 校验拒绝该候选；纠正为精确目录规则后重新归档和验证，未启动失败归档。

## Compatibility Incident And Recovery

最初曾尝试从干净 `7c667d3` 归档完整重建，并为其暂时收窄 `usesModel` 类型；该候选通过隔离账号测试，但遗漏原安装包已部署的 `LatestProductionSchema.usesModel` 能力。短暂启动后，打开原项目被严格 schema 拒绝，原主文件被现有 Store 隔离为 `.corrupt-*`。

Parent 正常退出该候选，核对唯一对应保留副本，并以独占创建方式恢复原项目主文件、同步文件及目录，保留隔离副本。恢复时 SHA-256 为 `0ae503828ce78ce8d2d995c3baeb94b9da99babf17a4285e5dfaa80b846745f2`，原 `.bak` 仍存在。随后撤销本任务临时类型修改，改用原安装冻结基线。最终候选通过 `ProjectStore.readSnapshot` 在只读路径解析真实项目；之后才使用真实应用重新打开。

最终原项目 ID 和 10 条素材恢复，155 个 completed、100 个 failed 导出状态与更新前一致，制作无运行任务，批量状态仍 finished。重新打开及界面草稿持久化后，主文件仅 `updatedAt` 改变，其余 JSON 内容逐项相同；保留原内容副本及备份。账号设置编辑器的原计划草稿相同。

## Verification Evidence

最终冻结输入的 `npm run build` 正常退出，内含 `npm run typecheck`；3144 Fluent 和 70 custom 贴纸文件校验通过。八份受影响账号、发现、上传 UI、Service、Store、批量制作及详情测试正常退出：180/180 PASS。

使用最终安装 executable 运行隔离 Electron settings smoke，报告 `/tmp/jianji-account-smoke-NxHM1S/report.json`：真实 preload/IPC、浏览器关闭时改名且目标保留、非法及重复名称拒绝、取消不保存、发现失败保留草稿、重启恢复均通过。模拟账号之外没有真实账号 attach；uploads、confirmations、adSettingChanges 均为 0。

真实桌面只读及导航验证：main PID `714889` 的 executable 和 renderer `app.asar` URL 均指向最终 release，重新核对 ASAR SHA。六账号可读；“作品”页展开“滴耳康 · 账号设置”，`#qianchuan-product-name` 可见，并显示“只改产品名称时，保留当前 Chrome 连接和千川计划”。截图已实际查看，没有保存真实更名。

更新前后 `userData/douyin-upload` 的全部 306 份文件逐字节哈希相同，零新增，包含账号映射、账本、永久 fence；当前项目九个 PENDING 和一个 NEEDS_HUMAN 状态不变。没有启动制作、导出、上传或商业模型调用。Windows 实机与真实账号上传不属于本次安装证明。

主要本机证据位于 `/tmp/jianji-product-name-update-20260929`：`build-preserved.log`、`tests-preserved.log`、`preserved-package-report.json`、`project-offline-validation.json`、`installed-preserved-smoke.log`、`installed-final-verification.json`、`live-field-verification.json` 及实际界面截图。包含用户项目身份的详细状态留在私有本机文件，不提交仓库。

## Delegation And Risk Gate

本次安装更新的受管只读 Kimi 调用 `9dfd0b42-8ace-4221-8ed7-47b19ac06159`，sealed contract `0d42a749-e3d9-490d-a6ae-ce44cf8f8f0c`，qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 为 PARSED、两次 wire 请求，均有 authenticated endpoint 的 IDENTITY_VERIFIED 记录；Docker containment qualified，synthetic proof 与 live identity 分开记录。工作范围只读检查冻结源码的重启上传边界，不能读取真实 userData、执行浏览器或授权接受。Parent 另行核对真实账本版本及完整字节，修复安装基线兼容问题；PARSED 不充当验收或最终 review。

在上述最终安装 snapshot、测试、逐模块与归档差异、真实项目恢复证据后，Parent 裁决 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求额外 implementation review；新增名称行为沿用已记录 Risk Gate，安装不新增生命周期、权限或上传语义；安装兼容风险已有真实项目只读解析及打开、剩余模块一致性和真实文件哈希证据，没有同时成立的重大后果和实质验证缺口。未默认叠加 native reviewer。

## AOCI And Record Boundary

本次没有新的受管理业务源码修改：临时类型改动已撤销，已提交的五个名称源码不再改写。运行 AOCI Verify、Check、Guide；结构有效，但完整治理仍有其他会话拥有的 `src/main/douyin-upload-service.ts` 和 `src/main/qianchuan-page-contract.ts` 两项 stale。没有接管其源码或更新其 baseline，不能宣称整个共享工作区 AOCI 已对齐；剩余维护由对应变更 owner 完成。安装产物使用冻结基线，不依赖这两项当前修改。

上下文刷新完整交付 188 条索引，host delivery 已确认；Attestation 因请求 schema 字段不匹配未建立严格证明，停止格式重试，不声称完整系统认知可靠。后续判断均绑定当前源码及安装证据。

已评估 substantial installed delivery 的 session-record 要求：仓库无适用 dedicated session-record Skill，本记录承载安装结果、兼容恢复与验证边界；不写全局 memory。仅提交本记录与本任务计划，保留其他会话的源码、测试、文档及用户项目删除状态。
