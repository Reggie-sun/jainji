# Windows Acceptance Spec

## Status And Scope

- 状态：Ready for execution；尚未执行 Windows 实机验收。
- 2026-09-15 补充：Windows x64 自动化、隔离静默安装及内置引擎检查已执行，见 [0.1.2 验证记录](windows-verification-0.1.2.md)。下列目标机人工用例仍需执行。
- 日期：2026-09-14。参考代码 HEAD：`a6c85531ecc4ac39373a0459be4d605bc7185a64`。
- 目标：验证简辑安装版在目标 Windows 电脑上的安装、连接、视频包装、成片完整性与失败恢复，形成可复现的问题记录。
- 编写时工作区存在未提交的产品行为改动；此 HEAD 不代表这些改动已包含在安装包中。测试前必须记录实际构建 commit、额外改动及安装包 SHA256；换包后重新标记受影响用例。
- 本 spec 不授权开发者调用用户账号、消耗模型额度、提交真实反馈或删除用户数据。实机测试由用户操作；真实模型测试先以少量短素材执行。
- 本文是验收要求，不是功能已经实现或测试通过的证明。以 [AGENTS.md](../AGENTS.md) 和当前代码为约束；README 中“中文短角标”等旧描述不作为验收标准。

## Environment Record

| Item | Actual value |
| --- | --- |
| 安装包名称、版本、构建 commit、是否含额外改动、SHA256 | 待填 |
| Windows 版本、build、x64/ARM64 | 待填；不同架构独立记录，不推定支持 |
| CPU、内存、GPU、显卡驱动 | 待填 |
| 屏幕分辨率与缩放 | 待填；至少验证实际使用的缩放比例 |
| FFmpeg / ffprobe 版本及路径 | 待填 |
| 中文字体、应用显示的编码器与并发数 | 待填 |
| 连接方式、协议、模型、推理档位 | 待填；禁止记录 Key/token |
| 输入/输出所在磁盘、可用空间 | 待填 |
| 测试日期、执行人 | 待填 |

## Installation Preparation

1. 使用 Windows 本机构建的 NSIS 安装包。若自行构建，在 Windows 的项目目录执行下列命令；构建机需要 Node.js 22，安装包使用者不应需要另装 Node.js 或 Codex。

   ```powershell
   npm ci
   npm run typecheck
   npm test
   npm run package:win
   Get-ChildItem .\dist -Filter *.exe
   Get-FileHash -Algorithm SHA256 "实际安装包路径.exe"
   ```

   安装包通常输出至 `dist`，记录实际输出路径。依赖必须在目标平台安装，不能用 Linux 的 `node_modules` 代替 Windows 依赖。测试如跳过媒体用例，应保留跳过原因。

2. 安装包当前不内置 FFmpeg。准备含 H.264、AAC、`drawtext`、`overlay` 的 FFmpeg 构建，保留其许可证；同时提供 `ffprobe.exe`。可将两者放到 `%APPDATA%\jianji\tools\ffmpeg\bin\`，或配置系统 `PATH`。也可通过 `JIANJI_FFMPEG_PATH` / `JIANJI_FFPROBE_PATH` 指定绝对路径，随后从继承这些环境变量的进程启动应用。
3. 核对 `%WINDIR%\Fonts\msyh.ttc` 存在。安装引擎或字体后重启应用。硬件编码器是否可用，以应用启动试编码结果为准。
4. 创建专用测试输入、输出目录，例如 `C:\Jianji Test\中文素材\` 和 `C:\Jianji Test\输出\`。所有取消、故障、删除测试仅使用副本。
5. 准备 3 段约 5–15 秒的小视频：竖屏带音频、横屏带音频、无音频；包含中文文件名和空格，至少两种分辨率/帧率。另备损坏视频、透明 PNG、带自有文字的 JPG、非图片文件各一份。MOV/MKV/WebM、4K、高帧率、旋转元数据或可变帧率素材按实际业务追加，不混入首轮排障。

## First Pass

先完成 W01–W07、W09、W11；确认能安装、正确输入价格、完成一次真实出片并播放，再执行故障和恢复测试。连接测试也可能消耗额度；首次制作建议 1 条素材、1 个版本。

## Test Cases

每项记录 `PASS / FAIL / BLOCKED / NOT_RUN`，附截图、脱敏错误或成片路径。P0 为首轮必要项；P1 为完整验收项；条件不具备时标记 BLOCKED，不计为通过。

| ID | Priority | Stage | Action | Acceptance |
| --- | --- | --- | --- | --- |
| W01 | P0 | n/a | 用普通 Windows 用户安装、启动、关闭、再次启动安装版 | 无白屏或崩溃；记录安装/签名提示原文；不要求用户安装 Node.js/Codex；能正常退出 |
| W02 | P0 | n/a | 在专用测试环境中先不提供引擎，再安装 FFmpeg/ffprobe 并重启 | 缺引擎时明确提示且禁止出片；配置后识别成功，显示编码器与并发；不能将缺失引擎伪装成功 |
| W03 | P0 | n/a | 在实际屏幕缩放下浏览连接、素材、规则模板、上传贴纸、作品列表 | 关键按钮、价格输入、错误提示可见可操作；缩小窗口后可滚动访问，无关键控件被遮挡 |
| W04 | P0 | n/a | 配置实际使用的 API 或 ChatGPT；选择模型/档位，重启后检查 | 连接和选择正确恢复；API Key 不回显；ChatGPT 登录能从系统浏览器完成，使用应用独立登录目录；文本连接成功不算视觉测试通过 |
| W05 | P0 | n/a | 导入中文/空格路径的正常视频，再导入损坏视频 | 正常文件元数据和预览可用；坏文件明确失败，不导致整个应用不可用；源文件未修改 |
| W06 | P0 | n/a | 价格依次留空、只填空格、填 `免费`、`19.999`、`19.9元膏药`，尝试开始；再填 `19.90` 和 `19.9元2支` | 非法值在制作前拒绝，不发起制作请求；合法值可继续；纯金额带人民币符号，含“元”按输入展示；切换模板/模式不改价 |
| W07 | P0 | n/a | 1 条视频、1 个版本、手填价格，真实模型自动制作 | 模型分析→排队→导出→完成可追踪；成功产物可播放；只添加居中手填价格和允许的贴纸/滤镜，不生成装饰短句；允许不选贴纸或保留原色 |
| W08 | P1 | n/a | 选择不同价格样式，切换手动/自动模式；分别制作少量样片 | 价格内容保持一致；手动选择有效；预览与输出遵守相同布局约束；价格无缺字、方框、乱码或异常裁切 |
| W09 | P0 | n/a | 在未连接模型时上传 PNG/JPG；重复上传；尝试上传非图片；手动选用并制作 | 合法素材导入且重启保留；相同图片复用；非法文件拒绝；上传不改变价格；自有文字可保留，但不能成为居中价格来源 |
| W10 | P1 | n/a | 3 条素材，期望 4 条，确认显示 6 条后制作；另输入超容量数量但不启动大批次 | 向上取整结果明确，实际为每素材 2 个版本；每个版本独立导出，同批价格一致；超过当前上限 250 的实际数量被阻止，不以历史导出条数占本次额度 |
| W11 | P0 | n/a | 对 W07 成片执行下节媒体验收并播放完整视频 | 尺寸/时长/帧率/音频符合原素材；顺序不变；没有黑帧、明显卡顿、音画错位；记录人工观看结论 |
| W12 | P1 | n/a | 制作过程中尝试切换连接；在分析阶段取消，再正常退出/重启 | 请求期间不能切换连接；取消停止对应工作；重启不自动继续未完成分析或发起新模型请求；不误伤其他程序进程 |
| W13 | P1 | n/a | 对专用样片在导出中取消，检查目录和状态 | 任务不标完成；不发布未验证成片；临时文件不能当最终成果；源视频和已有输出不变 |
| W14 | P1 | n/a | 使用不可写输出位置制造导出失败；恢复可写条件后执行导出重试 | 错误明确；重试复用冻结方案和素材，不重新调用模型；重新生成包装才产生新模型请求。无法观察请求次数时记录未验证 |
| W15 | P1 | n/a | 在隔离测试连接上使用错误 Key/模型；请求期间断网 | 显示脱敏错误，不静默换模型、重试请求或用固定方案假装成功；恢复网络后由用户明确重试 |
| W16 | P1 | n/a | 保存项目、关闭、重开；检查素材与历史记录；重新选择输出目录 | 项目可读取，项目文件不含 Key；重试使用冻结任务；缺失原素材等条件明确报错，不伪造完成 |
| W17 | P1 | n/a | 历史任务引用上传贴纸后，从库中删除该贴纸，再重试历史导出 | 新制作不再选到已删除贴纸；价格不变；历史冻结素材仍能支持重试；不要求模型重新设计 |
| W18 | P1 | n/a | 输出目录放置哨兵文件，重复执行小批次；导出前后比较源文件/哨兵哈希 | 不覆盖源视频或已有文件；新结果路径可辨识；完成状态只对应验证后的最终输出 |
| W19 | P1 | n/a | 在本机实际 GPU 下完成小批次，再在有条件的 CPU-only 环境运行 | 各环境分别记录真实编码器/并发、耗时、失败情况；CPU 编码为单路。未测 NVIDIA/AMD/Intel 不得互相代替验收，无需为此禁用系统驱动 |
| W20 | P1 | n/a | 打开问题反馈，填写测试草稿、预览脱敏、关闭并重开 | 草稿交互正常，无凭据暴露；真实提交会创建公开 Issue，仅由用户明确决定后单独测试；未提交则传输链路记 NOT_RUN |
| W21 | P0 | 1 | 在 NSIS 安装版首次启动后，检查 `%APPDATA%\jianji\connections\`；用任意 API Key + 模拟 endpoint；启动最小视觉模型请求 | 凭据明文保存在该目录（不写入项目文件、不写入环境、不写入浏览器存储）；ChatGPT 登录走应用独立 `userData`；三个角色各自可设模型与档位而不互相覆盖；运行中切换连接被拒绝 |
| W22 | P1 | 2 | 在隔离 fixture 模型上 1 视频 1 版本手填价格；运行中尝试切换连接 | 模型抽 3 帧（0.1/0.5/0.85 处各一张）→ 本地中心 + 四角 → FFmpeg 渲染 → 输出验证通过；运行中切换连接被禁用；非法价格在 IPC 入口拒绝；非法方案显式失败且不重试不切换 |
| W23 | P1 | 4 | 覆盖关闭的自动补角；「启用覆盖」开关在规则模板页 CoverStickerPanel 可见且默认关闭 | 每角归属明确（源贴纸角 vs 补齐角），补齐时段在导出前可被补帧/放大，每窗口执行 1 次、主管最多 3 次；超时显式失败，不静默重试 |
| W24 | P1 | 5 | 在含视觉模型 fixture 上开启自动覆盖；制作 1 视频 1 版本 | 视觉连接返回近似覆盖框并定框 → 主管样片渲染 → 修订反馈保留 → 非法/未改变画面的修订不能转通过；样片最多 5 次检查、2 次修订；新覆盖层以白色不透明底板渲染；不可用视觉模型时在调用前拒绝制作 |
| W25 | P1 | 6 | 在隔离 fixture 上先识别一张原贴纸 → 复用同源其他批次 → 删除源再识别 | 复用位置只在带专用标记的已完成模板复用、精确源身份相同；事实有疑议时显式阻断；近似覆盖方案与原贴纸事实分开 |
| W26 | P1 | 7 | 进 `coverReview.*` 系列 IPC 完成「识别→候选→草稿→预览→批准→出片」 | 草稿落盘独立于项目文件；草稿编辑失效旧预览与批准；独立复核关闭时不能批准/自动改稿；退出/重启后草稿可恢复；草稿未通过批准前不会进入正式队列 |
| W27 | P1 | 9 | 经 `window.jianji.appendProduction` 完成「预填→改文字→追加 2 条→渲染完成→文件校验」 | 展示文字/条数/目录按既有 schema 拒绝；与 `export.retry` 不竞争；零模型调用；输出文件不覆盖已有产物；Path B digest 自校验通过 |
| W28 | P1 | 全部 | 在 NSIS 安装版上按 `batch-video-production-agent-playbook.md` §Windows Adaptation 启动隔离 worker（独立 CDP 端口、独立 `%APPDATA%` 子目录），跑 1 个版本的 Path B 完整链路 | worker 与用户应用不竞争 userData；CDP `127.0.0.1:<port>` 连接成功并暴露 `window.jianji.*`；W21–W27 同样适用于该 worker；`packaged-runtime-smoke` 继续通过 |
| W29 | P1 | 2 | 选择「本地随机」模式制作 2 素材 × 各 1 版本；全程观察网络面板或日志确认零模型请求 | 每个素材版本四角各 1 款互不重复的随机贴纸（池 = 内置 + 上传）、价格花字来自 `PRICE_STYLES` 随机、滤镜与强度在规则范围内随机；两个素材版本组合不同（允许小概率相同，记录即可）；展示文字仍按共享 schema 在 IPC 入口拒绝空白/超行；规则模板页隐藏模板网格与具体花字选择器；导出文件通过既有验证 |

**测试机制**：W21–W29 与既有 W01–W20 共享同一验证基础。`packaged-runtime-smoke`、`desktop-smoke`、`feedback-smoke` 复用；模型、登录、CC Switch、GitHub 继续用隔离 fixture，遵循 §Environment Record 的禁止项（不消耗真实账号、不提交真实 Issue）。W29 不依赖任何模型 fixture（路径本身零模型调用）。

真实账号只测试用户准备采用的连接路线；其他 API 协议、ChatGPT、不同 GPU 或 Windows 版本分别记未测。不要为覆盖率盲目消耗额度。模型返回非法方案、请求隔离等内部边界可用现有模拟测试补充，不能仅凭界面推定已验证。

## Media Verification

对原视频和最终输出分别执行以下命令。若引擎未在 PATH，使用 `ffprobe.exe` / `ffmpeg.exe` 的实际绝对路径。

```powershell
ffprobe -v error -show_entries "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,sample_rate,channels" -of json "C:\Jianji Test\中文素材\样片.mp4"
ffprobe -v error -show_entries "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,sample_rate,channels" -of json "实际成片路径.mp4"
ffmpeg -v error -i "实际成片路径.mp4" -f null -
```

- 使用作品记录中的最终路径，不选隐藏或包含 `.partial` 的临时文件。完整解码应无错误。
- 核对宽高与帧率。恒定帧率样片的时长差超过一帧时记录为偏差并排查，不直接通过；容器时长与音轨尾部差异应分开解释。可变帧率/旋转素材单独记录，不能仅比较一个字段就宣称保持原样。
- 带音频输入应保留音轨，无音轨输入不应被新增配音。重编码不要求 codec 或文件哈希相同；完整播放确认无截断、重复段、明显音画错位。
- 观看开头、中段、末尾及价格/贴纸覆盖位置，确认原文字保留、价格正确、中文清晰、主体遮挡可接受。机器探测不能替代画面验收。
- 源文件保护可用 `Get-FileHash -Algorithm SHA256 "源文件路径"` 前后比较。

## Result And Exit Criteria

首轮可用：所有 P0 通过，至少一条安装版真实模型→FFmpeg→完整播放链路通过。完整验收：适用的 P1 也通过，条件性项目明确标出未测环境与影响。任一 P0 为 FAIL/BLOCKED/NOT_RUN，不能宣称首轮通过。

源文件/已有输出被覆盖、价格被改写、凭据泄露、未验证产物标完成、取消后继续发起新请求属于阻断问题。保存证据后停止相关场景，避免继续扩大影响。

测试记录模板：

```text
Build / package SHA256:
Windows / GPU / driver / encoder:
Case ID / PASS | FAIL | BLOCKED | NOT_RUN:
Input properties / model / price:
Steps:
Expected:
Actual / exact error:
Evidence (redacted screenshot, probe output, video path):
Reproduction rate:
Remaining unverified:
```

提交问题前遮挡凭据、私有路径及业务素材。最终报告列出通过/失败/阻塞/未测数量，并关联失败项与安装包；不能用 Linux 测试、CI 配置或开发模式成功代替 Windows 安装版实测。

## References

- [Installation and engine instructions](../README.md)
- [Packaging configuration](../package.json)
- [Price schema](../src/shared/decorations.ts)
- [Production capacity and request schema](../src/shared/agent.ts)
- [CI configuration](../.github/workflows/desktop.yml)
- [Windows Agent Lifecycle Verification Spec](superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md) — W21–W29 设计契约
