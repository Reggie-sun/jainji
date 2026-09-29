# Scope And Ownership

本次修复千川生产 adapter 的 QCR-001，并补齐 QCR-002 回归证据。沿用 [Spec](douyin-auto-upload-spec.md) §6–8 与 [Plan](superpowers/plans/2026-09-27-douyin-auto-upload.md) M3；没有改变账号授权、正式产物准入、每组最多九条、全组 ready 后继续、永久 fence、原页面恢复及停在“确定”前的合同。

唯一生产代码 owner 为 `src/main/qianchuan-page-contract.ts` 的 `QianchuanPageSession.guard`。删除整个 frame 的生产账号 ID 查找范围，改为唯一可见 `.account-info-container` 内精确匹配。计划 ID 仍限定当前 drawer，fixture 分支保留原合同；不新增上传队列或恢复入口。测试变更仅在 CDP 测试、生产 HTML fixture 及其 controls 类型中。其他任务的制作、结果页及项目文件修改均保留。

# Findings And Correction

- **QCR-001 / blocking_candidate：** 旧 guard 会把无关计划列表中恰好相同的通用 ID 当成当前账户。先增加 wrongAdvertiser 加 unrelatedAdvertiserId 测试，旧实现实际错误返回 pageOwnership，测试失败；修复后拒绝该场景且零 drop。增加重复账号区域拒绝与正确账号加无关同 ID 仍允许的验证。真实六账号页只读核实均存在一个可见账号区域及一个目标 ID，未猜测 selector。
- **QCR-002 / non_blocking：** 新增真实 adapter、service、store 组合的隔离测试。21 个测试产物按原准入进入上传，第二组一个新文件行永久不出现：第一组九条 READY，第二组九条 UNKNOWN，末组三条未选择；18 个 fence 落盘并在恢复前后字节不变。调用继续只读核查，不新增 drop、页面点击或第三组；重读 store 仍保留未知状态和 fence。使用测试字节与模拟 completed JobStore，该测试本身不证明 FFmpeg 产物或真实平台上传。

# Verification

2026-09-29 Linux 当前 working tree：

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck` / `npm run build` | exit 0 | 包含保留的其他任务 working-tree 修改；非单提交发布包 |
| CDP uploader、service、store、integration、page-contract 五个测试文件 | 101/101 PASS | 原生 Chrome 的隔离 fixture 与本地状态验证 |
| `scripts/douyin-upload-smoke.mjs` | PASS，12 条正式 FFmpeg 输出，组大小 1/9/2，12 个 fence | 独立 Electron userData；生产 selector 分支；重启零重新选文件；确认点击 0；真实账号未使用 |
| 六账号现有页面只读身份检查 | 6/6 唯一账号区域及精确 ID | 无导航、文件选择或确认 |
| 当前源码 guard 对现有计划页只读执行 | 蝴蝶贴、滴耳康、肥皂、热敷贴通过 | 氨糖膏、眼贴无匹配现有计划页，未创建页面；不宣称这两个计划通过 |
| AOCI | Verify / Check aligned；Guide complete=true、next_action=none | 仅更新页面合同条目及其基线，不代表完整系统认知已验证 |

桌面首次使用系统 FFmpeg 时因能力不足被前置检查拒绝；改用简辑已配置的 `/home/reggie/Applications/jianji/runtime/usr/bin/ffmpeg`、对应 ffprobe 和 runtime library path 后通过。桌面报告 `/tmp/jianji-qianchuan-smoke-5Q9HVl/report.json`；相关日志 `/tmp/qianchuan-blocker-{tests,build,desktop}.log`；只读证据 `/tmp/qianchuan-account-region-live-20260929.json`、`/tmp/qianchuan-current-guard-live.json`。临时文件可能被清理，本记录保留最低结论。

# Required Review Resolution

原生产 adapter 的三次 Kimi 调用历史不变，invocation 为 `79443295-64db-4acf-88f8-2318bbb55bc2`、`ec6040c1-a253-4dd1-9fe1-108680cce01a`、`ce573efb-8b0b-483e-8125-ad8034a0260a`。没有第四次调用，也没有将部分输出或浏览器成功当作审查通过。

依当前 `SUBAGENTS.md` 的 Repeated Kimi Failure Fallback，由同一个 read-only `reviewer_xhigh` 原生代理 `/root/qianchuan_required_review` 接手。第一轮发现 QCR-001/002；本次为原生阶段第 2/3 轮 targeted re-review，八分钟上限，不运行测试、修改文件或派生代理。快照 `/tmp/jianji-qianchuan-native-review-20260929-r2` 的 manifest SHA-256 为 `c54202b762219d491768f136ef3f42a0a1b4d19c63bcb869df9c1a8e6c4f790c`；包含精确源码、diff、适用 spec/plan、测试/构建日志与只读账号区域证据。

审查返回 finding set 为空。Parent 根据失败复现、修复后的 101 项测试、真实账号区域证据和最终 diff，裁决两项已解决；required engineering review 的运行阻塞解除。原生审查不声明 Docker/Kimi route proof，也不代替生产上传验收。审查后生产源码与测试字节保持对应快照。

# Delivery Boundary

本次没有新增真实视频上传，没有改账号设置、真实 ledger 或 fence，没有点击确认、发布或广告设置；未知历史文件仍不能重传。Windows 按用户要求未验证。源码及本地构建已包含修复，但未替换已安装发布包，也未重启用户正在运行的简辑窗口，旧进程不自动获得新主进程代码。

Repository 无专用 session-record skill，本记录保存修复、审查和分层验证结果；不修改全局 memory。上述结果取代旧生产 adapter 记录中“因无有效审查回执阻塞”的当前状态，旧记录继续作为当时的历史证据。

# Installed Update And Verification

用户随后明确要求“更新然后验证”。2026-09-29 已切换 `/home/reggie/Applications/jianji/launch.sh` 到 `releases/qianchuan-20260929-fd56869/jianji`，保留原 release 和 `launch.before-fd56869.sh`。正常退出旧开发进程后，从新启动器打开真实桌面，核对运行 executable、renderer 的 `app.asar` 路径与归档 SHA；通过界面重新打开原“一条根”项目，39 条素材与六账号设置可读。启动及恢复没有制作或上传；221 条持久上传记录的 task 身份与 outcome 在重启前后保持一致。

安装产物是原已安装 batch-upload 包加本次已审 guard 的定点修复，不声称是完整 `fd56869` checkout 重建。尝试在临时源码归档中独立构建该 commit 时，`batch-production-controller.ts:93` 引用的 `usesModel` 类型尚在其他任务的未提交修改里，typecheck 拒绝；未接管该源码或把其他未提交代码装入软件。原包内所有文件路径和内容逐一比较，只有 `dist-electron/main.cjs` 的账号 guard 片段变化；该片段来自当前构建、对应已审 source diff，另以完整前后缀比较和 JavaScript 编译检查证明没有其他 bundle 变化。文件的 unpack/executable/link 元数据保持一致；归档工具为原已解包文件的祖先目录增加 unpack 标志，不改变文件解包位置或字节。

首次候选重打包的字符串替换误解释正则中的 `$`，造成主进程语法错误，两个测试未出现窗口；此候选未切换启动器。已改为字面片段拼接、增加语法及归档比较后，重新运行以下测试，均使用最终安装目录中的原样包：

| Installed check | Result |
| --- | --- |
| `douyin-upload-smoke.mjs --packaged` | PASS；12 条正式输出，1/9/2 分组、12 个 fence、包内 Playwright attach、重启零重复选择，确认 0 |
| `batch-qianchuan-upload-smoke.mjs --packaged` | PASS；17 条正式输出，其中 12 条 READY；两账号分组分别 1/9 与 2；只导出项、未知阻断后续账号、模板草稿不变及重启防重传通过，确认/广告设置 0 |
| User desktop | 新安装包进程已运行，能力 ready，六账号可用，原项目 39 条素材恢复 |

两套 smoke 均为独立 userData、Chrome profile、合成视频及本地 fixture；不等同于六个真实账号全量上传验收。真实桌面验证使用临时 loopback CDP 参数，未写入 launcher；没有点击上传继续、确认或发布。

最终 `app.asar` SHA-256：`fd04404e0d3d770246984ea0c2721f942aafe42448be2815fe0565d442ff6c5e`；主 bundle SHA-256：`a00c222a524eb19de33fccec4189e68dcdcbb86efedd9dcb2264787345bba2b3`。归档差异证据 `/tmp/jianji-release-fd56869-package.json`；普通/批量报告分别为 `/tmp/jianji-qianchuan-smoke-qMQ87r/report.json`、`/tmp/jianji-batch-upload-smoke-5Pz3FW/report.json`；真实运行报告 `/tmp/jianji-fd56869-installed-verification.json` 与项目恢复报告 `/tmp/jianji-fd56869-restored-project.json`。本次无新源码语义，沿用上节有效审查与精确差异证明，没有增加 Kimi 或 native review 轮次。完整源码独立打包仍需其他任务完成其类型提交；已交付安装修复不依赖该未提交代码。
