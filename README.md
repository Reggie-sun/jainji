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

目前安装包不内置 FFmpeg。两平台均需安装包含 `libx264`、`aac`、`drawtext` 与 `overlay` 的 FFmpeg，并将 `ffmpeg`、`ffprobe` 加入 `PATH`。也可通过 `JIANJI_FFMPEG_PATH` 与 `JIANJI_FFPROBE_PATH` 指定完整路径。

Ubuntu/Debian：

```bash
sudo apt install ffmpeg fontconfig fonts-noto-cjk
```

Windows 使用系统 Microsoft YaHei 字体：项目中的默认 `Noto Sans CJK SC` 在 Windows 明确映射到 `C:\Windows\Fonts\msyh.ttc`（实际依据 `WINDIR`）。其他字体仅解析代码声明的 Windows 字体，不任意替换。Windows 精简版若缺少该字体，需先安装系统中文字体。字体差异可能造成两个平台的文字外观不同。

安装引擎或字体后重启应用。缺少必要能力时，界面会显示提示并禁止开始出片。

## Workflow

1. 选择连接方式：使用 ChatGPT 登录，或在内置 API 连接管理中添加服务商、地址、协议、视觉模型与 Key。保存后从列表选择使用；支持编辑、切换、删除与重启恢复。
2. 导入 MP4、MOV、MKV 或 WebM，选中需要包装的素材。
3. 选择黑金精选、清爽日常或黑白叙事模板。可选填真实产品信息、文案偏好等补充要求，并选择输出文件夹。
4. 点击“交给 Agent，开始出片”。每条视频抽取 3 张缩略帧，模型生成短文案、角落位置和滤镜；本地校验通过后交给原有导出队列。
5. 在作品列表查看进度、播放或打开输出目录。导出重试复用已冻结的方案，不再次调用模型；重新生成包装会再次调用模型。

模板限制角标数量、位置、文案长度、字号、滤镜与强度。模型返回不合格方案时，该条失败，不使用固定模板伪装模型成功，也不自动重试请求。角标属于静态文本包装，不能替代逐帧主体避让或人工观看验收。

## Privacy And State

- API 连接与 Key 保存在 `userData/connections/connections.json`，与项目文件隔离，界面只获得脱敏元数据。Key 为明文；Linux 文件权限为 `0600`、目录为 `0700`，Windows 使用当前用户目录权限，请保护本机账号与备份。删除配置会移除保存的 Key；断开仅停止使用并保留 API 配置。
- ChatGPT 登录通过随应用打包的官方 Codex App Server 在系统浏览器完成，使用账号的 Codex 权益与限额。简辑在自己的 `userData/codex` 目录保存登录状态，关闭后保留，点击“断开”退出。该目录由 Codex 管理，凭据文件按本机私密数据处理；不读取、改写全局 Codex 登录状态，不复制 CC Switch 的 OAuth token。
- 内置连接管理不依赖 CC Switch 运行。可选的一次性迁移入口从当前用户的 `~/.cc-switch/cc-switch.db` 只读导入当前 Claude/Codex API 配置到简辑配置列表（Windows 同样使用用户主目录）。支持 Anthropic Messages、Responses 与 Chat Completions，必须有 API Key、地址和视觉模型。OAuth-only 配置提示使用 ChatGPT 登录；不会把账号 token 当作 API Key。
- CC Switch 导入列表只显示服务商、模型和地址；导入时重新读取。导入后保存在简辑中，修改外部 CC Switch 不会改变已保存的简辑配置。读取期间数据库正在写入或有未合并日志时拒绝读取，提示关闭 CC Switch 后刷新；不写回数据库。
- API Key 不回传界面、不写入项目或浏览器存储；编辑时留空保留已有 Key，保存后清空输入。
- 开始创作时，3 张抽帧和用户补充要求会发送到配置的服务商。原视频和本地文件路径不进入模型请求。
- 模型调用使用用户服务商的额度；“测试连接”会发送一次文本请求，不能证明视觉能力或出片质量。
- 已创建的导出任务及其模板、素材快照保存在原有本地队列中。项目保存不包含 API Key。重新打开项目后需要重新选择输出目录，已存在任务可重试。
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
