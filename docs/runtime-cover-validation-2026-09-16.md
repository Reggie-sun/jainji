# Runtime Integration Validation

## Result

2026-09-16 在 `0ce45b0`（包含 `f92860a`）上完成一次真实素材自动覆盖尝试。连接恢复与独立模型界面验证通过；真实视觉请求收到响应，但跨窗口目标一致性校验失败，未导出。不能宣称成片验收或通用识别准确率通过。

## Isolation

- Worktree：`/home/reggie/vscode_folder/jianji-runtime-validation`，分支 `validation/real-automatic-cover`。
- 使用该工作区独立构建的 Electron 主进程和 renderer；CDP 仅监听 `127.0.0.1:19336`。
- 独立 userData、队列与输出：`/home/reggie/jianji-validation/20260916-cover/`。
- 使用 `bwrap` 将原连接目录和应用自己的 `codex/auth.json` 只读挂载到新 userData；没有复制、打印 API Key，没有读取全局 Codex 登录状态。未更改原应用连接，未重启或关闭原应用。
- 已有视觉选择为 `MiniMax-M3`、Responses、服务商默认档位；保持此选择。创作保持 ChatGPT `gpt-5.6-luna / medium`。
- Chrome MCP 因已有 profile 占用无法连接，使用独立 Electron CDP 验证并保存截图；没有关闭其他浏览器。

## Input

- 原素材：`/home/reggie/电商/马油膏布/素材/竞品详情-抖音电商罗盘.mp4`。
- ffprobe：34.854 秒、720×1280、30 fps，存在音频流。
- 展示文字：`19.9元2支`，直接沿用 `氨糖膏.jianji-project.json` 最新已保存批次的 `templateSnapshot.productPrice`，未由模型生成或改写。
- 单素材、单版本，`clean`，装饰 `mode=agent`；显式设置 `coverSticker.enabled=true`、`trackingMode=agent`。空手动候选，由自动规则选内置素材。
- 未导入其他项目或原实例任务。新实例使用 CPU 单路；本次没有进入媒体导出。

## Live Evidence

证据目录：`/home/reggie/jianji-validation/20260916-cover/`。

| Evidence | Observation |
| --- | --- |
| `connections.png` | 界面同时显示创作和视觉连接、各自模型与档位 |
| `requests.jsonl` | 两次请求均为视觉识别、模型 `MiniMax-M3`；09:05:58.654Z 与 09:06:07.845Z 发出，均收到 HTTP 200 |
| `state.json` | run `b3c0798b-9f08-48ad-98a2-314fffd10204`，唯一 item 为 `failed`，导出 queue 无 batch |
| `result.png` | 作品页显示分析失败及跨窗口关联错误 |
| 独立 `userData/codex/logs_2.sqlite` | 两个创作 turn 均使用 `gpt-5.6-luna / medium`，09:05:52Z、09:05:57Z 记录 sampling token usage |

创作 turn IDs：`01a0a977-03ca-78c1-b5c7-668cc546feb4`、`01a0a977-21f5-73e2-8e4e-e8bc01dafab6`。结合 `agent-runner.ts` 的执行顺序，创作选覆盖贴纸先完成，随后进入视觉识别。样式方案位于识别之后，因此本次未执行，不能声称已真实验证完整样式调用链。

最终错误：

> 模型返回的覆盖追踪结果不合格：重叠抽帧的目标数量或位置不一致，无法唯一关联全部目标。本条未导出，可检查模型后重新生成。

未静默重试、未换模型、未回退创作识别、手动画框或固定方案。请求记录只保存角色、模型、档位、HTTP 状态，不保存请求头、Key 或图片数据。没有保留模型完整坐标响应，因此不能据本次证据进一步区分模型观察差异与匹配阈值问题，也没有据此修改生产代码。

## Verification And Limits

- 独立工作区 `npm run build` 通过（含 `npm run typecheck`）；存在原有 bundle 大小 warning。
- `npx vitest run tests/vision-connection.test.ts tests/connection-store.test.ts` 实际匹配并执行 `connection-store.test.ts`，11/11 通过；没有名为 `vision-connection.test.ts` 的测试被执行。
- 真实视觉服务返回响应不等于识别结果合格；此次正确停在本地一致性检查。
- 输出目录 `output/` 为空。没有成片路径，没有本次导出 FFmpeg exit、成片 ffprobe、成片抽帧或人工播放验收。
- 白色底板、多目标最终覆盖、轨迹冻结、导出重试不重新识别或换款，本次均未到达验证阶段；之前模拟 smoke 不能替代真实成功成片证据。
- 尚无可归因的代码缺陷，不修改生产代码、不扩展架构。后续需人工决定是否再次运行或显式更换视觉模型；不能将本次失败自动转为另一模型的成功尝试。
- 仓库未声明专用 session-record skill；本报告保留本次 runtime integration 结果。

## Main Fix Follow-up

用户报告 `(16).mp4` 的 JSON 格式失败与 `(17).mp4` 的跨窗口关联失败后，授权直接在 main 修复并允许重启。之前合并的 `61539a2` 只有本报告，没有程序源码变化。检查 `蝴蝶贴.json` 的 538 个已保存批次均未含覆盖图层，最近成功批次不能作为自动覆盖路径此前通过的证据。

新的真实诊断响应保存在 `/home/reggie/jianji-validation/20260916-fix/`，没有复制 Key；仅在进程内读取现有视觉配置。原素材 1.75 秒的两次响应均识别左右角标，但框高分别为 `0.08/0.09` 与 `0.04/0.05`；检查原抽帧确认该画面只有这两个角标。原 IoU 阈值误拒绝这组有限包含框。另一个单测证明原逐目标算法会拒绝“局部候选不唯一、整体一一对应唯一”的情况。

修复内容：保留 IoU 规则，补充近包含且宽高比例各不低于 1/2 的候选；只接受全局唯一的完整匹配。数量不一致、无匹配或多个完整匹配仍失败。重叠帧保存两次框的并集，采样聚合保留合并结果，避免丢弃任一观察到的范围。真实响应离线回放已从失败变为通过，不调用模型或重试。

`(16).mp4` 的另一真实响应对底部 emoji 同时产生明显位移，仍正确拒绝；新增该反例防止把“修复”扩大为无条件接受。JSON 错误未在此次 7 个真实诊断窗口中复现，原失败响应也未留存，故尚未确定并修复该错误的根因。错误提示新增时间窗口，JSON 失败额外显示响应字符数；不泄露模型原文，不猜补 JSON，不自动重试。

Verification：62 项相关测试通过；`npm run build`（含 typecheck）通过。真实 FFmpeg 集成覆盖合并范围保留与输出媒体；隔离 Electron/IPC/FFmpeg 视觉连接 smoke 通过，产物为 `/tmp/jianji-vision-smoke-u3fRgY/output/source_edited.mp4`（模拟服务，不是用户素材）。尚无修复后的真实完整素材成片或人工验收，不能声称两类问题均已解决。

独立 `reviewer_xhigh` 结论为 `accept with concerns`：无 blocking issue；确认唯一匹配与记录响应回放，保留 JSON 根因及完整实片验收未完成的限制。最终 diff 由主线程复核。

## Repeated Failures And Rejected Experiment

后续用户报告 `(16)` 在 1.75–3.50 秒、`(17)` 在 3.50–5.25 秒、`(15)` 在 24.50–26.25 秒仍因跨窗口关联失败而整批停止。不能把上一轮局部几何回放通过视为这些真实素材已修复。

本轮尝试了保留共享抽帧、只续接明确身份、将未匹配的旧新框分别保留的方案。68 项相关测试、build/typecheck、隔离 Electron/IPC/FFmpeg smoke 均通过；初次 independent review 为 `accept with concerns`。随后完整真实媒体验证提供了反证，该实验已全部撤回，未作为生产修复提交。main 的生产逻辑恢复到 `d5372ea`；未匹配的数量/几何仍明确失败。

真实测试使用独立 userData 和输出目录 `/home/reggie/jianji-validation/20260916-cover-fix/`，只读挂载应用现有连接和登录文件，不复制 Key，不改原创作配置。创作仍为 `gpt-5.6-luna / medium`，视觉仍为 `MiniMax-M3 / 服务商默认`，手动内容仍为 `19.9元2支`。每份素材只做一次新制作，无模型重试或自动切换。

| Source | Model / media result | Visual result |
| --- | --- | --- |
| `(16).mp4` | 22 个视觉窗口完成，20 条冻结覆盖轨迹；407 个模型观测框全部几何覆盖。实验成片 38.778 秒、720×1280、30 fps、H.264/AAC，7,039,649 bytes | `contact16.png` 约 2 秒处底部表情漏盖；模型框定位不准确，画面验收失败 |
| `(17).mp4` | 已越过原 3.50 秒失败点，但第 14 个窗口（22.75–24.50 秒）明确返回 `status=uncertain`，本条无输出 | 正确停止，未绕过不确定性 |
| `(15).mp4` | 20 个视觉窗口完成，13 条冻结覆盖轨迹；292 个模型观测框全部几何覆盖。实验成片 34.877 秒、720×1280、30 fps、H.264/AAC，7,553,563 bytes | `contact15.png` 约 25 秒后原角标仍可见；画面验收失败 |

两个实验成片均经过队列文件验证、独立 ffprobe、FFmpeg 全流解码（exit 0）及 Electron 静音整段播放（ended=true、无 media error）。这仅证明媒体有效，不代表覆盖成功。对应任务为 `08c29e27-20d8-466b-948b-521af10159ef`、`a43a259e-2380-4b6b-9abe-2fb257a623cf`。冻结模板包含原手动文字与 `opaqueBackground=true`；未进行本轮真实导出重试。

关键反证：`response-50.json` 对 24.50 秒返回 3 个目标；`response-51.json` 对同一画面及整个 24.50–26.25 秒窗口返回 `status=ok`、0 个目标，`response-52.json` 后续仍为 0。实际角标仍在。仅保留旧框一个采样间隔不能修复后续漏检；继续放宽关联条件会把失败变成漏盖。同数量也不保证可靠：`(16)` 的同帧底部框偏移导致实际露出。

证据包含 `state-16.json`、`state-17.json`、`state-15.json`、`requests.jsonl`、`response-1.json` 至 `response-56.json`、`observations-16.json`、`observations-15.json`、两张 contact sheet 与本地任务记录。实验 MP4 在上述证据目录的 `output/` 下，文件名分别为 `竞品详情-抖音电商罗盘 (16)_edited.mp4` 和 `竞品详情-抖音电商罗盘 (15)_edited.mp4`；均为未通过画面验收的诊断产物。

独立 `reviewer_xhigh` 根据新增真实证据 scoped re-review 改为 `reject`：不发布未匹配观测直接放行的实验，恢复数量及几何无法可靠关联时的拒绝。当前 blocker 是所选视觉模型在这些素材上的漏检、定位差异和明确不确定，而非 FFmpeg。下一步需明确选择另一视觉模型做相同素材验证，不能以更多容错或猜测轨迹冒充覆盖成功。原始 JSON 格式失败本轮未复现，仍不能声称其根因已解决。

## Luna Live Validation

用户先指定 ChatGPT `gpt-6-astra / high`，随后明确改用 `gpt-5.6-luna`。最终实际测试为视觉 `gpt-5.6-luna / high`、创作 `gpt-5.6-luna / medium`；未调用 Astra。账户实时模型列表确认 Luna 支持图片和 high 档位。

验证目录为 `/home/reggie/jianji-validation/20260916-luna-cover/`。独立 Electron userData 只读挂载应用自己的 `codex/auth.json`，没有复制 API Key 或 OAuth 凭据，也未访问全局 Codex 登录。测试配置只含 ChatGPT 的模型选择，不含 API profiles。覆盖显式开启、trackingMode=agent、装饰 mode=agent，手动展示文字保持此前的 `19.9元2支`；每份素材各一次新制作，无重试、无模型切换、无手动框或固定方案回退。

`connections.png` 与 renderer 实际 select 值确认创作 medium、视觉 high 分开显示。诊断启动器只记录 thread/turn 的模型、角色、effort、完成状态及模型最终文本，不记录完整 RPC、请求图片、账户信息或认证内容。`requests.jsonl` 中 6 次 creation 请求为 medium，6 次 vision 请求为 high；创作仅完成贴纸初筛、选款，因后续识别失败尚未进入最终样式方案阶段。

| Source | Shared frame / responses | Result |
| --- | --- | --- |
| `(15).mp4` | 1750 ms；response-3 为 1 个目标，response-4 为 2 个 | 1.75–3.50 秒窗口无法关联，未导出 |
| `(16).mp4` | 1750 ms；response-7 为 5 个目标，response-8 为 3 个 | 同上，未导出 |
| `(17).mp4` | 1750 ms；response-11 为 2 个目标，response-12 为 3 个 | 同上，未导出 |

`state-15.json`、`state-16.json`、`state-17.json` 均为 agentRun finished / item failed / queue batches 空；本轮没有成片、FFmpeg 导出、成片 ffprobe、成片播放或冻结模板重试验收。模型 JSON 均合法并返回 status=ok，不等于其逐帧枚举正确。独立 `test_analyzer` 只读复核前两份响应、请求分工和本地计数拒绝逻辑，确认当前证据不支持“本地误拒”；第三份最终结果由主线程核对。

按生产抽帧参数重新提取的 `source15-1750.jpg`、`source16-1750.jpg` 经主线程画面检查：15 的左右上角图案都在，response-3 漏掉右上角；16 的两个上角和底部居中表情可见，但底部左右角图案已不在，response-7 仍报告它们。更换模型后仍出现跨窗口漏检/残留目标，不能继续将问题归因于 MiniMax 单一服务商，也不能放松关联保护。多图输入的逐帧对应/消失判断需要另行隔离验证，目前不能据此断言传输排序、模型或 prompt 的唯一根因。

本轮未改生产代码，main 继续保留 `d5372ea` 的失败保护；未改用户项目或创作配置。Luna 选择已在独立验证窗口保存，原桌面窗口的连接配置仍为 MiniMax；原窗口存在未保存编辑，尝试关闭时取消了保存/退出，未强制丢弃或覆盖。配置接通和真实模型响应已验证，可靠覆盖与有效成片验收均未通过。

## Single-Frame Isolation

用户再次报告 `(15)` 在 26.25–28.00 秒关联失败、`(16)` 在 1.75–3.50 秒关联失败、`(17)` 同窗口的 818 字符 JSON 无效。重新只读检查原应用配置，视觉仍为 MiniMax-M3；不能将该截图当作原应用已切至 Luna 的证据。生产代码不保存完整失败响应，已有诊断证据中没有找到该 818 字符原文，因此无法确认截断、Markdown、解释文字或其他语法错误的具体原因。

本轮用现有 owner 做有界真实对照：`ModelConnections` → `visionProvider.detectCovers` → 原 `detectCoverTrack` prompt → ChatGPT Luna/high，每份素材只送一张 1750 ms 图片、不带 previous、各一次请求，无创作调用、无重试、无导出。证据在 `/home/reggie/jianji-validation/20260916-frame-isolation/`，包括可复查诊断脚本、三张 JPEG、`requests.jsonl`、`response-{15,16,17}.txt` 和 `parsed-{15,16,17}.json`。使用独立 userData，只读挂载简辑自己的登录文件，不复制凭据、不读全局 Codex 登录、不改原窗口。

单帧结果：15 返回 2 个目标、16 返回 3 个、17 返回 3 个，与主线程检查对应原帧的可见目标数量一致。15、16 的 JPEG 与前轮核查原帧逐字节一致，且传输边界记录的图片 SHA-256 相同；三个 turn 均为 high、imageCount=1、detail=high。原提示词未改，只减少输入帧数量，单帧成功仅指 JSON/schema 和目标数量，不代表框已完整覆盖或全片识别可靠。

这组对照支持多帧联合识别中的遗漏、持续可见性判断或时间对应是主要调查方向；不支持继续放松重叠帧计数/几何检查，也不足以断言每帧独立识别即可解决全片跟随。当前一次输入 8 张图的方案要求模型同时完成目标枚举、定位、出现消失与窗口内身份跟随；跨窗又要求独立模型观察完全一致。之前完整实片已经证实直接拆段放行会漏盖，不能恢复该实验。

独立只读 transport audit 确认 API 输入转换保留文本/图片顺序；Responses 要求 status=completed 后提取 output_text。另发现 ChatGPT completion wrapper 的 token-budget 测试只覆盖参数传递到回调，未证明实际 RPC 设置了预算；这不是当前 MiniMax/Responses 818 字符错误的归因，也未在未核对 Codex RPC 合法字段前修改协议。Anthropic stop_reason 等未涉及当前请求的旁支保持不动。

当时没有找到可安全宣称解决上述失败的局部代码修复，先停止增加匹配容错并保存诊断。随后用户明确要求“继续修复”，进行了下述有界替换实验；实验没有通过真实验证，未保留生产代码改动。

## Single-Frame Repair Experiment — Rejected

候选实现删除 8 帧窗口与重叠帧重复观察路径，每个 250 ms 抽帧仅请求一次；模型只返回当前图片的矩形，本地单一 owner 负责相邻帧唯一匹配。保留 uncertain/非法结果拒绝、关联歧义拒绝、64 条轨迹限制、冻结模板和原导出队列；没有重试、切换模型、手动画框或固定覆盖回退。单帧请求显著增加调用次数，不能只凭离线测试就上线。

候选代码曾通过 563 项测试（2 项跳过）、typecheck/build、隔离 Electron/IPC/模拟服务/真实 FFmpeg 的 vision-connection smoke。独立 `reviewer_xhigh` 给出 accept with concerns：未确认代码缺陷，但合法 ok 仍可能漏检，且完整素材的调用开销和画面效果未验收。review 不能代替真实素材证明。

真实验证证据目录：`/home/reggie/jianji-validation/20260916-single-frame-repair/`。素材为 `竞品详情-抖音电商罗盘 (15).mp4`，34.854 秒；覆盖显式开启、agent 跟随、一版本，沿用既有手动文字 `19.9元2支`。隔离应用复用简辑登录状态的只读挂载，创作 Luna/medium，视觉 Luna/high；不改原桌面配置和用户项目、不复制凭据。

`requests.jsonl` 记录 2 次创作请求（初筛、选款）和 5 次视觉请求（0、250、500、750、1000 ms），全部正常返回。99.149 秒后，0.75–1.00 秒的关联校验失败，未进入创作样式方案或 FFmpeg 导出；没有重复发起请求。`state-15.json` 为 agentRun finished、item failed、queue batches 空，`output/` 为空。

主线程对照 `response-6.txt`、`response-7.txt` 与原帧 `source15-750.png`、`source15-1000.png`：右下角小图标仍在底部，但模型框从 y=0.981、height=0.013 变成 y=0.946、height=0.020，两个框纵向不相交；后者位于实际图标上方。750 ms 左上角模型框 width=0.063，在 540 像素宽图中仅约 34 像素，也没有包住完整标签。数量相同和 JSON 合法仍不足以证明定位可靠，放宽身份匹配也不能修正漏盖。

Decision：单帧职责拆分排除了同一抽帧重复回答的矛盾，但未解决真实定位质量，故撤回全部本轮实验代码、测试及 README/AGENTS 改动，恢复提交 `d70826e` 的生产实现。撤回前将差异及新增关联模块/测试保存到证据目录的 `rejected-experiment.patch`、`cover-frame-association.ts`、`cover-frame-association.test.ts`，供复查，不作为可用补丁推荐。无关 untracked 项目和 `docs/video-sticker-alternatives.md` 未处理。恢复后重新运行 6 个相关测试文件：56 项通过；`npm run build`（包含 typecheck）通过，只有既有 bundle size 警告；`git diff --check` 通过，最终仅报告文件有 tracked diff。

Acceptance：独立连接接通、真实模型响应已证实；有效媒体导出、成片 ffprobe/播放、全目标白底覆盖和冻结重试均未通过本轮真实验收。没有新成片路径；不能宣称截图中的问题已修复，也未获得生产 818 字符无效 JSON 原文。下一步需要重新评估定位能力及像素级检测/跟踪方案，不再把扩大关联容差或换成单帧请求当成充分修复。

## Pixel Localization And Tracking Feasibility

用户允许扩大到像素级定位/跟踪评估。本轮是离线 feasibility spike，未修改应用算法、连接配置、项目或导出模板，未调用新的商业模型；没有重启应用。实验脚本和结果仅保存在 `/home/reggie/jianji-validation/20260916-pixel-spike/`，不作为可部署实现。`systematic-debugging` 与 `brainstorming` 用于分离“发现全部目标”“完整像素定位”“时序跟踪”三个问题，避免将实验运行成功当作产品验收。

### Environment And Reproduction

本机实测 RTX 5090 / 32607 MiB、CUDA 可用；复用 Python 3.13.5、OpenCV 4.12.0、PyTorch 2.9.0+cu128、Transformers 4.57.1，没有安装或升级系统依赖。下载公开 Apache-2.0 权重 `facebook/sam2.1-hiera-tiny`，固定 revision `de431c4043854a71d8101e17995dfe596bf101a5`，约 149 MiB 存在独立证据目录。只使用 safetensors、token=False、trust_remote_code=False；后续推理 local_files_only / HF_HUB_OFFLINE，不上传视频、原帧或凭据。

权重 SHA-256：`48c14467e5cf9e51870511feb72c89688e82dd74523142c0538b663e193ac2a7`。图像实验按官方 model card 使用 `Sam2Model`，配置 model_type=sam2_video 产生兼容性警告；另用 output_loading_info 核查 missing/unexpected/mismatched/error_msgs 均为0，未发现缺失权重。此检查不能代替实现数值等价性证明。视频实验使用匹配的 `Sam2VideoModel`，无该类型警告。

`probe.py` 提供 template / sam2 / automatic / multiscale / tiles / video 六个实验入口。静态对照按照应用现有 FFmpeg fps=4 参数提取 `(15)` 前五张 JPEG，使用 750/1000 ms 两帧及已有 `response-6/7.txt` 的原框；视频对照使用原始 30 fps 前 90 帧及 `response-3.txt` 原框，没有手工纠正种子或将人工框用于导出。静态结果保存源帧 SHA-256，SAM 结果保存模型 revision；video JSON 保存种子框、fps 和逐帧结果，但不含源视频摘要和完整软件参数，automatic JSON 生成于添加 cropLayers/explicitTiles 字段前。复查需同时使用本节环境记录与脚本，不能将这些 JSON 称为独立完整复现包。掩码 PNG 为诊断数据，不是覆盖成片。

### Results

| Probe | Observed result | Acceptance |
| --- | --- | --- |
| OpenCV normalized template matching | 750→1000 ms 左上角部分标签匹配分数 0.9784，仍仅 35 像素宽；左下角最高分位置跑到商品区域 | 不能证明完整定位，也不能只按最高分接受身份 |
| SAM 2.1 box-prompt segmentation | 750 ms 左上角坏框 `[0,1,35,30]` 产生 `[0,0,35,32]` 局部掩码；1000 ms 右下角偏移框产生 `[520,912,540,936]`，仍未盖住实际底部图标 | 在现有坏框后加分割器不是充分修复 |
| SAM 2.1 full-image automatic proposals | 两帧各 9 个候选，包含左上标签，但没有其他三个角落图案的独立完整候选 | 默认自动候选召回不合格；分割候选也不是贴纸语义判定 |
| Official multiscale pipeline | crops_n_layers=1 在现有 fast processor 内抛出不同 crop tensor 尺寸无法 stack 的 RuntimeError | 该实验未完成，不统计为模型质量失败；未修改依赖源码 |
| Explicit whole image + overlapping 2×2 tiles | 原图加四个通用重叠分块，无手工指定贴纸区域；共 31/35 个候选，3.37/3.08 秒，仍无另外三个角落图案的完整独立候选 | 此组多尺度参数也未达到召回要求，未继续放低阈值碰运气 |
| SAM 2.1 video propagation | 90 帧、4 个初始目标，13.94 秒，峰值 allocated 约 2992 MiB；右下图标从第11帧起出现空掩码；左上标签在第46帧切镜后丢失，第89帧原图仍清楚可见 | 跟踪运行成功，但跟踪质量不合格 |

上述 score / predictedIou 都是模型或相关性输出，不是独立标注所得的准确率；耗时包含本实验预处理/掩码落盘等操作，不是引擎纯吞吐或整批制作性能。仅测一个素材的局部，不外推其他素材、SAM 2 全系列或通用识别准确率。主线程对照 `source-frame89.png`、静态原帧与掩码坐标确认可见标签仍存在。

另抽取首次丢失的原视频第11、46帧，保存为 `first-loss-01.png`、`first-loss-02.png`；目视确认前者右下小图标、后者左上标签仍可见。实验结果不支持通过忽略空掩码、永久延长覆盖或放松关联来出片。本轮未生成导出模板/成片，未执行用户任务重试。

独立 `reviewer_xhigh` 给出 accept with concerns，确认以上反例支持拒绝将当前组合上线；指出首帧 mask 已含背景，故视频失败只能归于“已有模型框 → SAM2Video”的当前组合，不能独立归因于跟踪器，也不能声称正确分割种子下仍失败。主线程已修正报告对 JSON 元数据完整性的过度表述；本 review 不构成引擎或生产架构验收。

### Integration Boundary And Decision

独立 `architecture_auditor` 检查现有源码：视觉连接应仅负责后期贴纸的语义识别；最终像素几何、身份及可见区间应由一个定位/跟踪 owner 负责，不能把多个修补器串在当前错误框之后。若新方案验收后替换旧路径，应退休8帧重叠观察和双重身份关联，保留 `AgentRunner.detectCoverTracks()` 的结果接口、创作选款/样式、手动文字、白底、冻结模板及重试零识别。现有 FFmpeg stdout 按 UTF-8 累积，不能直接用它承载密集 rawvideo；还需有界解码、取消/资源上限与 Windows/Linux 打包验证。本轮没有实施这些架构变更。

下一候选可评估具有语义检测与视频分割能力的 SAM 3，但尚无本机效果证据，不预先认定它能解决小贴纸问题。官方模型接口当前返回 gated=manual，需要用户已获授权的权重或自行申请访问；未读取本机其他账号、请求受限权重、接受用户条款或寻找绕过访问限制的镜像。用户表示已有授权权重，并要求自行查找文件；不要求 Token/API Key。

### Local SAM 3 Weight Search

按用户授权进行只读文件名/目录检查，覆盖可访问的 `/home/reggie` 模型与缓存目录、`/mnt`、`/media`，并单独核查 ComfyUI、Hugging Face、`.local`、下载和实验目录；没有找到 SAM 3 权重本体。找到 `/home/reggie/ComfyUI/comfy/ldm/sam3` 和 Python 环境内的 SAM 3 支持代码，以及 ComfyUI 原生 Image/Video Segmentation 模板对 `sam3.1_multiplex_fp16.safetensors` 的引用；这不证明文件已下载。当前 `/home/reggie/ComfyUI/models/checkpoints` 只有零字节占位文件，未配置 extra_model_paths.yaml。未读取凭据或 shell 历史。

系统有尚未挂载的 NTFS 分区 `nvme0n1p3` / `nvme0n1p5`，未检查其内容、未擅自挂载。不能据已挂载路径搜索结果断言权重不存在于整台机器；继续需要确认 Windows 分区或权重的大致位置，也可由用户决定重新获取获授权权重。没有因此切换产品模型或修改应用。runtime-notes.txt 保存加载检查与 crop 错误的摘录，明确不是完整 stderr transcript。最终仅本报告有 tracked diff，`git diff --check` 通过；本轮没有应用代码变更，不为报告重复运行无关 build/typecheck。

## SAM 3.1 Download Checkpoint

用户选择 B 重新下载已获授权权重，并要求下载时 merge 进入 main。当前原本就在 main，前述记录已在 `dc651b5`；没有待合并的生产修复分支。此 checkpoint 只记录授权下载，不将尚未验证的算法合入生产路径。

来源为 ComfyUI 原生模板明确引用的 [Comfy-Org/sam3.1](https://huggingface.co/Comfy-Org/sam3.1)，发布方说明这是 `facebook/sam3.1` 的 ComfyUI 重打包，使用 SAM License，模型接口 gated=false。固定 revision `f38cd62b71494b53ac2b56ca36e24f3c8d565581`，文件 `checkpoints/sam3.1_multiplex_fp16.safetensors`，期望 1,745,546,848 bytes / SHA-256 `9ba99c92703c2e8b4f47de2d34a539bb8e18923049e238b780d70dbe6368eb03`。下载到 `/home/reggie/jianji-validation/20260916-sam31/model/`，不覆盖 ComfyUI 模型目录、不读取凭据、不修改应用连接。

本 checkpoint 状态为 download started：完整性校验、模型加载、真实定位/跟踪及成片验收均尚未完成；后续结果追加记录。证据 owner 为同目录 `download-manifest.json`，模型下载完成不等于修复完成。

Source references：[OpenCV template matching](https://docs.opencv.org/4.13.0/d4/dc6/tutorial_py_template_matching.html)、[SAM 2 official repository](https://github.com/facebookresearch/sam2)、[SAM 2.1 tiny model card](https://huggingface.co/facebook/sam2.1-hiera-tiny)、[SAM 2 video API](https://huggingface.co/docs/transformers/model_doc/sam2_video)、[SAM 3 official repository](https://github.com/facebookresearch/sam3)。官方能力描述仅用于候选筛选，不替代上述实测。
