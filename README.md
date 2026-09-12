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

1. 填写 API Base URL、支持视觉输入的模型 ID 与 API Key，保存连接。支持 OpenAI-compatible `/chat/completions`；远程地址要求 HTTPS，本机地址允许 HTTP。
2. 导入 MP4、MOV、MKV 或 WebM，选中需要包装的素材。
3. 选择黑金精选、清爽日常或黑白叙事模板。可选填真实产品信息、文案偏好等补充要求，并选择输出文件夹。
4. 点击“交给 Agent，开始出片”。每条视频抽取 3 张缩略帧，模型生成短文案、角落位置和滤镜；本地校验通过后交给原有导出队列。
5. 在作品列表查看进度、播放或打开输出目录。导出重试复用已冻结的方案，不再次调用模型；重新生成包装会再次调用模型。

模板限制角标数量、位置、文案长度、字号、滤镜与强度。模型返回不合格方案时，该条失败，不使用固定模板伪装模型成功，也不自动重试请求。角标属于静态文本包装，不能替代逐帧主体避让或人工观看验收。

## Privacy And State

- API Key 只保存在本次运行的主进程内存中，不写入项目、磁盘或浏览器存储，界面保存后清空输入。
- 开始创作时，3 张抽帧和用户补充要求会发送到配置的服务商。原视频和本地文件路径不进入模型请求。
- 模型调用使用用户服务商的额度；“测试连接”会发送一次文本请求，不能证明视觉能力或出片质量。
- 已创建的导出任务及其模板、素材快照保存在原有本地队列中。项目保存不包含 API Key。重新打开项目后需要重新选择输出目录，已存在任务可重试。
- 尚未完成分析的 Agent 任务只存在内存中；退出时停止，不在重启后自动发起付费请求。
- 结果的“已完成”表示 FFmpeg 输出和文件校验完成；最终内容、文案事实与画面效果应通过播放确认。

## Build And Verification

```bash
npm run typecheck
npm test
npm run build
npm run package:linux
npm run package:win
```

Linux 目标为 AppImage / deb，Windows 目标为 NSIS 安装包。建议分别在对应系统构建并验证。当前工程配置的签名、安装体验与 Windows 实机运行尚需在 Windows 环境验收。

测试包含规则拒绝、Key 不回传、错误脱敏、取消、素材方案隔离、Windows/POSIX 路径，以及真实 FFmpeg 与本地模拟 API 的端到端处理。真实媒体测试缺少引擎或字体时会明确跳过。CI 配置覆盖 Ubuntu 与 Windows 的静态检查和测试；本地模拟服务测试不代表商业服务商已验证。

桌面交互 smoke 使用真实 Electron、IPC 和 FFmpeg，只用本地服务与文件选择器 fixture。先构建，再在有图形环境的终端运行 `node scripts/desktop-smoke.mjs`；无显示的 Linux 可运行 `xvfb-run -a node scripts/desktop-smoke.mjs`。脚本验证 API 配置、素材导入、模板选择、自动导出、Key 不回传与窄窗口布局，并在终端输出临时截图和成片目录。

API 图片消息格式参考 [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)。本项目使用通用 Chat Completions 接口；实际支持范围取决于用户选择的模型与服务商。
