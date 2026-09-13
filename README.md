# 简辑

## Overview

面向 Windows 与 Linux 的本地视频包装桌面应用。用户接入自己的模型 API、导入视频、选择规则模板，Agent 为每条视频分别设计中文短角标与滤镜，再自动导出独立 MP4。

这版保留视频原有顺序、时长、分辨率、帧率与音频；不包含多素材拼接、语音转写、配音或新素材生成。

## Quick Start

需要 Node.js 22 与 npm。

```bash
npm ci
npm run dev
```

已构建后也可运行：

```bash
npm run build
npm start
```

Windows 与 Linux 使用相同命令。开发启动器自动分配本地端口并启动 Electron。

## Local Engine

目前安装包不内置 FFmpeg。Windows / Linux 都需安装包含 H.264 编码器、`aac`、`drawtext` 与 `overlay` 的 FFmpeg，以及匹配硬件的驱动。启动时按 NVIDIA NVENC → AMD AMF → Intel QSV 顺序实际试编码，选用首个通过检测的硬件编码器；全部不可用时使用 `libx264`，CPU 软件编码始终单路。编译进 FFmpeg 的编码器列表或显卡名称不代表实际可用。

并发在每次启动时自动确定：每约 3 个可用 CPU 逻辑核允许一路 GPU 导出，上限 6 路；再按总内存、启动时可用内存降低上限，预留桌面与制作流程所需空间。程序会同时试编码验证候选路数，失败时逐级减少，全部失败则继续检测下一种编码器。队列与界面共享这份启动配置，界面显示编码器厂商和实际并发路数；换电脑或更新驱动后重启即可重新检测。检测只使用本地生成的测试画面，不请求模型，也不发送用户视频。

文字、贴纸与滤镜合成仍使用 CPU；每个 GPU 任务按并发槽位均分线程预算，避免早到的任务占满预算。这是保守的资源与驱动准入策略，不是全素材测速，也不保证所有机器的绝对最快或任意高分辨率任务都不会耗尽资源。运行中不会因其他应用占用资源而重新选择编码器或静默重做失败任务；应结束当前批次后重启，重新检测可用资源。

引擎查找顺序为：`JIANJI_FFMPEG_PATH` / `JIANJI_FFPROBE_PATH` 显式指定的路径、应用用户目录下的 `tools/ffmpeg/bin/`、系统 `PATH`。Linux 默认用户目录为 `~/.config/jianji`，Windows 为 `%APPDATA%/jianji`；本地安装应同时放入 `ffmpeg` 和 `ffprobe`（Windows 使用 `.exe`），保留构建的许可证文件。Windows 的 FFmpeg 构建需包含目标显卡对应的 `h264_nvenc`、`h264_amf` 或 `h264_qsv`；缺少硬件编码支持时会选用 CPU。

各厂商使用各自的质量参数，CPU 保留原 x264 参数，不保证跨编码器相同体积或逐像素一致。Linux NVIDIA 有真实导出验证；Windows AMD / Intel 的参数和选择逻辑已有自动测试，仍需目标设备实测。

Ubuntu/Debian：

```bash
sudo apt install ffmpeg fontconfig fonts-noto-cjk
```

Windows 使用系统 Microsoft YaHei 字体：项目中的默认 `Noto Sans CJK SC` 在 Windows 明确映射到 `C:\Windows\Fonts\msyh.ttc`（实际依据 `WINDIR`）。其他字体仅解析代码声明的 Windows 字体，不任意替换。Windows 精简版若缺少该字体，需先安装系统中文字体。字体差异可能造成两个平台的文字外观不同。

安装引擎或字体后重启应用。缺少必要能力时，界面会显示提示并禁止开始出片。

## Workflow

1. 选择连接方式：使用 ChatGPT 登录，或在内置 API 连接管理中添加服务商、地址、协议、视觉模型与 Key。保存后从列表选择使用；支持编辑、切换、删除与重启恢复。连接页和规则模板页均有“创作模型”：ChatGPT 从账户返回的可用视觉模型中下拉选择；API 输入视觉模型 ID（提供已保存的同服务商模型候选）后点击“应用模型”，保留原地址、协议和 Key。选择自动保存在本机，供提示词生成和视频分析使用；模型请求期间禁止切换。ChatGPT 上次所选模型不可用时要求重新选择。
   模型下方可选择“推理档位”：ChatGPT 展示该模型返回的具体档位及默认值；API 提供协议通用档位，实际支持范围取决于模型与服务商。选择默认时 API 不额外指定档位。模型和档位一起保存，切换模型重置为默认档位；ChatGPT 已保存的档位失效时要求重新选择。API 参数分别使用 [Chat Completions 的 `reasoning_effort` / Responses 的 `reasoning.effort`](https://developers.openai.com/api/docs/guides/reasoning) 和 [Anthropic 的 `output_config.effort`](https://platform.claude.com/docs/en/build-with-claude/effort)。
2. 导入 MP4、MOV、MKV 或 WebM，选中需要包装的素材。
3. 选择黑金精选、清爽日常或黑白叙事模板。产品价格必填，支持纯金额（如 `19.90`）或金额＋数量单位（如 `19.9元30贴`、`29.9元50片`），最多12字；带“元”的内容原样展示，纯金额显示人民币符号，必须由用户手动输入，未填写不能开始制作；中间只显示此价格，同一批视频使用同一价格；可直接填写期望成片条数，按原素材数量向上取整，例如 3 条素材期望 10 条，实际制作 12 条（每条 4 版），每个版本独立调用 Agent 设计并导出（效果可能相似），项目最多保留 100 条导出记录；新增文字只允许此手动价格，禁止自动或手动添加装饰短句，原视频自带文字保留。可选填风格偏好等补充要求，并选择输出文件夹。
4. 点击“交给 Agent，制作 N 条成片”，其中 N 是向上取整后的实际数量。每条视频抽取 3 张缩略帧，模型选择四角贴纸与滤镜，手动模式保留用户贴纸选择；价格图层由本地程序生成；本地校验通过后交给原有导出队列。
5. 在作品列表查看进度、播放或打开输出目录。导出重试复用已冻结的方案，不再次调用模型；重新生成包装会再次调用模型。

模板限制贴纸数量、四角位置、尺寸、滤镜与强度。模型返回不合格方案时，该条失败，不使用固定模板伪装模型成功，也不自动重试请求。静态包装不能替代逐帧主体避让或人工观看验收。

## Bug Feedback

侧栏“反馈问题”可填写问题描述、选择或粘贴一张截图，并直接创建 `Reggie-sun/jainji` 的 GitHub Issue。提交成功后显示 Issue 编号和打开入口。此功能移植自 `csgojiaoben` 的问题反馈入口，不启动其自动修复、PR 或 Issue automation 工作流。

用户无需 GitHub 账号或 Token。桌面端将反馈发送到开发者中继 `https://feedback.reggie-sun.ccwu.cc`，由运行在开发者电脑上的服务创建 Issue；电脑及公网隧道须保持在线。服务部署见 [Feedback Service](docs/feedback-service.md)。客户端不再读取旧版 `bug-feedback/credentials.json` 或 `JIANJI_GITHUB_TOKEN`，旧凭据文件不会自动删除。

描述在提交前移除常见凭据、链接和本地路径，脱敏后最多保留 8000 字，可展开查看预览；仍需人工检查自由文本。自动上下文仅包含应用版本、系统类型、当前页面与时间，不自动收集视频、项目、模型配置或日志。截图支持最多 5 MB 的 PNG、JPEG、WebP，会上传到中继并通过公开链接显示在 GitHub Issue 中；提交前请遮挡私人信息。客户端保留截图副本。

“最近的反馈”保留最近 20 条本机记录。中继保存同一反馈的回执，重复提交返回原 Issue；结果不明时只查找原记录，不自动再创建。重启不会自动提交。旧版已成功的回执仍可打开，旧版结果不明的记录须先在 GitHub 检查，不能跨传输方式自动重试。关闭窗口保留当前草稿，退出应用不保存尚未提交的草稿。

独立桌面验证：构建后运行 `node scripts/feedback-smoke.mjs`（无显示的 Linux 使用 `xvfb-run -a node scripts/feedback-smoke.mjs`）。使用真实 Electron、界面、IPC 和本机中继，GitHub 接口及系统打开动作使用隔离 fixture；不会创建真实 Issue，也不读取真实反馈凭据。

## Privacy And State

- API 连接与 Key 保存在 `userData/connections/connections.json`，与项目文件隔离，界面只获得脱敏元数据。Key 为明文；Linux 文件权限为 `0600`、目录为 `0700`，Windows 使用当前用户目录权限，请保护本机账号与备份。删除配置会移除保存的 Key；断开仅停止使用并保留 API 配置。
- ChatGPT 登录通过随应用打包的官方 Codex App Server 在系统浏览器完成，使用账号的 Codex 权益与限额。简辑在自己的 `userData/codex` 目录保存登录状态，关闭后保留，点击“断开”退出。该目录由 Codex 管理，凭据文件按本机私密数据处理；不读取、改写全局 Codex 登录状态，不复制 CC Switch 的 OAuth token。
- 内置连接管理不依赖 CC Switch 运行。可选的一次性迁移入口从当前用户的 `~/.cc-switch/cc-switch.db` 只读导入当前 Claude/Codex API 配置到简辑配置列表（Windows 同样使用用户主目录）。支持 Anthropic Messages、Responses 与 Chat Completions，必须有 API Key、地址和视觉模型。OAuth-only 配置提示使用 ChatGPT 登录；不会把账号 token 当作 API Key。
- CC Switch 导入列表只显示服务商、模型和地址；导入时重新读取。导入后保存在简辑中，修改外部 CC Switch 不会改变已保存的简辑配置。读取期间数据库正在写入或有未合并日志时拒绝读取，提示关闭 CC Switch 后刷新；不写回数据库。
- API Key 不回传界面、不写入项目或浏览器存储；编辑时留空保留已有 Key，保存后清空输入。
- 左侧“上传贴纸”是独立栏目，无需先连接模型或导入视频；点击“选择图片上传”添加 PNG、JPG/JPEG 静态图片（最大 10 MB，宽高不超过 4096 像素）。图片复制到应用本地素材目录，重启后可继续使用；重复上传相同图片会复用已有素材。上传不会改动当前模板选择或价格；手动模式在“规则模板”中选用，自动模式由 Agent 看图后自主选用。用户上传的图案与自带文字由用户负责，是新增文字限制的明确例外，Agent 不能改写这些文字或据此代填居中价格。
- 开始创作时，3 张抽帧和用户补充要求会发送到配置的服务商。上传贴纸以真实图片预览发送给模型，用于制作方案和生成创意提示词：手动模式发送所选上传贴纸，自动模式发送上传库中的贴纸供选材。原视频和本地文件路径不进入模型请求。
- “上传贴纸”中每张图片下方可删除并确认：删除后从素材库及新制作的选材目录移除，表单中对该贴纸的选择清空，价格不变。历史导出引用的本地图片保留以支持重试；重新上传同一图片可恢复到素材库。
- 模型调用使用用户服务商的额度；“测试连接”会发送一次文本请求，不能证明视觉能力或出片质量。
- 已创建的导出任务及其模板、素材快照保存在原有本地队列中。项目保存不包含 API Key。重新打开项目后需要重新选择输出目录，符合当前文字规则的任务可重试；包含旧装饰文字或缺少手动价格绑定的文字方案仍可读取，但重试时会拒绝，需手动填写价格并重新制作。
- 尚未完成分析的 Agent 任务只存在内存中；退出时停止，不在重启后自动发起付费请求。
- ChatGPT 为每条视频建立临时会话，关闭命令工具、网页搜索和多 Agent 功能，只返回供本地校验的包装方案。简辑不执行模型发来的工具或权限请求。运行时固定为 `0.154.0`，使用其 experimental `environments: []` 与关闭 orchestrator skills 来移除文件工具；升级必须重跑真实模型请求工具列表测试。
- 结果的“已完成”表示 FFmpeg 输出和文件校验完成；最终内容、文案事实与画面效果应通过播放确认。

## Build And Verification

```bash
npm run typecheck
npm test
npm run build
npm run package:linux
npm run package:win
```

Linux 目标为 AppImage / deb，Windows 目标为 NSIS 安装包。安装依赖会下载对应平台的官方 Codex 二进制，并由安装包携带；无需用户另外安装 Node 或 Codex。请分别在对应系统构建并验证，跨系统打包不保证包含目标平台二进制。当前工程配置的签名、安装体验与 Windows 实机运行尚需在 Windows 环境验收。

测试包含规则拒绝、Key 不回传、错误脱敏、取消、素材方案隔离、Windows/POSIX 路径，以及真实 FFmpeg 与本地模拟 API 的端到端处理。真实媒体测试缺少引擎或字体时会明确跳过。CI 配置覆盖 Ubuntu 与 Windows 的静态检查和测试；本地模拟服务测试不代表商业服务商已验证。

桌面交互 smoke 使用真实 Electron、IPC 和 FFmpeg，模型服务、OAuth App Server、CC Switch 数据库与文件选择器使用隔离 fixture。先构建，再在有图形环境的终端运行 `node scripts/desktop-smoke.mjs`；无显示的 Linux 可运行 `xvfb-run -a node scripts/desktop-smoke.mjs`。验证登录/取消/退出、CC Switch 导入及 Anthropic 图片请求、手动 API、素材导入、模板选择、自动导出、Key 不回传与窄窗口布局。另有真实 Codex 二进制初始化、独立登录目录和禁用工具配置测试，不发起真实登录或模型推理。真实账号授权和商业模型出片尚需用户登录后验证。

接口依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex authentication](https://learn.chatgpt.com/docs/auth)、[MiniMax Messages API](https://platform.minimax.io/docs/api-reference/text-chat-anthropic)、[OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)。实际图片能力取决于所选模型与服务商。
