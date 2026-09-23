# 简辑 Windows 验收规范与执行记录

**历史记录（0.1.1）**：本页保留当时的 Windows 自动化与静默安装证据，不代表当前代码或新安装包已验收。当前实机用例请使用 [Windows Acceptance Spec](docs/windows-acceptance-spec.md)；0.1.2 的后续记录见 [Windows 0.1.2 验证记录](docs/windows-verification-0.1.2.md)。

基线：`main` 的 `3e4b428dff8a`，并在 2026-09-14 补验 Windows 0.1.1 的内置运行环境。本记录在 Windows 11 x64（内核 `10.0.26200`）、Node.js `22.19.0` 上执行。**自动化、NSIS 静默安装与内置引擎验证已通过；商业模型、目标 GPU、交互式安装及成片观看尚未验收，不能据此宣布发布完成。**

## 环境与边界

- 使用 `npm ci` 安装锁定依赖；本机的 `C:\Windows\Fonts\msyh.ttc` 存在。0.1.1 安装版另含 Noto Sans CJK SC 字体，不依赖该系统字体。
- 测试用 FFmpeg/ffprobe 为 [Gyan 发布的 9.0.1 essentials 构建](https://www.gyan.dev/ffmpeg/builds/)，仅解压到任务临时目录，通过 `JIANJI_FFMPEG_PATH` 和 `JIANJI_FFPROBE_PATH` 指定，没有安装到系统。下载包 SHA-256 为 `49a73bdf0850092a252ac4641d922f3048d63ed113e196cc65ce1e4f7fb33e85`，与发布方的 `.sha256` 文件一致；本机确认具有 `libx264`、`aac`、`drawtext` 和 `overlay`。编码器出现在列表中不等于对应显卡可用。
- 桌面 smoke 使用真实 Electron、IPC 与 FFmpeg，但模型、登录、CC Switch、GitHub 和文件选择器使用隔离 fixture；没有调用真实商业模型、真实账号或创建真实 Issue。
- 0.1.1 Windows x64 安装包内置 [Gyan 9.0.1 essentials](https://www.gyan.dev/ffmpeg/builds/) 的 `ffmpeg.exe`、`ffprobe.exe` 及其 GPLv3 许可证。固定 ZIP 的 SHA-256 为 `fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9`。同时内置 Noto Sans CJK SC 2.004 和 OFL 许可证。安装版无需用户配置系统 PATH 或另装中文字体。

## 验收门槛与本次结果

| ID | 判定标准 | 本次证据 | 状态 |
| --- | --- | --- | --- |
| W01 | Windows x64 上依赖安装、类型检查通过 | `npm ci`、`npm run typecheck` 均退出 0 | 通过 |
| W02 | 单元和集成测试通过；跳过项有原因 | 0.1.1：`npm test` 使用安装包中的 FFmpeg；42 个文件通过、1 个文件跳过；303 个测试通过、8 个跳过 | 通过 |
| W03 | 真实 FFmpeg 保留视频与音频，价格和贴纸按规则渲染，输出经过验证且不替换已有文件 | `ffmpeg.integration`、`corner-render.integration`、`price-styles.integration`、`export-formats`、`agent-pipeline.integration` 和并发集成测试在 Windows 运行通过 | 通过 |
| W04 | 重启后的待处理任务标记为中断，不自动恢复模型请求；旧装饰文字方案不能重试导出 | `queue`、`price-only`、`project-sync` 测试与 `desktop-smoke` 通过 | 通过 |
| W05 | 真实桌面界面的 API、模板、价格、导出、取消、恢复、窄窗口、凭据不回传与退出流程可运行 | `node scripts/desktop-smoke.mjs` 返回 `PASS`，2 次 fixture 制作请求，渲染异常 0 | 通过 |
| W06 | 反馈提交、截图、回执、结果不明时核对与重启恢复不会重复发 Issue | `node scripts/feedback-smoke.mjs` 返回 `PASS`，仅本地 GitHub fixture，渲染异常 0 | 通过 |
| W07 | 标准 Windows 构建和 NSIS 打包成功；资源齐全 | `npm run package:win` 退出 0；安装包含 3,144 张贴纸及许可证、Windows Codex 可执行文件、FFmpeg/ffprobe、Noto 字体及各自许可证 | 通过 |
| W08 | 解包版与安装版能启动，且内置引擎与字体不依赖系统 PATH | `node scripts/packaged-runtime-smoke.mjs <安装目录>`：隔离 APPDATA、仅系统目录 PATH，IPC 返回 `ready=true`、CPU `libx264`；内置字体中文价格编码及 ffprobe 检查通过 | 通过 |
| W09 | NSIS 安装与卸载不破坏已有应用 | 0.1.1 最终包在隔离目录全新静默安装、首次启动和静默卸载均通过；安装及卸载退出码均为 0，卸载后应用可执行文件消失 | 通过 |
| W10 | 正式发布包具有产品图标、代码签名，交互式安装与卸载体验通过人工检查 | 当前使用 Electron 默认图标，未配置签名；只执行了静默安装与卸载 | 待验收 |
| W11 | 目标 NVIDIA、AMD、Intel 设备上的实际编码与成片质量可接受 | 本机未完成所有目标 GPU 的真实导出；NVENC 集成测试因无可用 NVENC 跳过 | 待验收 |
| W12 | 用户实际登录所选 ChatGPT 或 API 视觉模型，播放并确认生成内容、画面和音频 | 本次仅用模拟服务；未使用真实账号或商业额度，未人工观看正式素材 | 待验收 |

8 个跳过项分别为：6 个仅在非 Windows 系统运行的 FFmpeg 能力 fixture 测试、1 个需显式启用网络下载的素材库测试、1 个要求实际 NVENC 设备的集成测试。Windows 内置引擎及字体路径另有 2 个专门测试。这些跳过不抵消 W11/W12 的待验收状态。

## 可重复的自动化步骤

在仓库根目录执行以下 PowerShell 命令。构建阶段可由脚本下载并校验 FFmpeg ZIP；已下载时可指定 `JIANJI_FFMPEG_ARCHIVE`。测试阶段显式使用打包目录中的引擎，避免误用系统安装。

```powershell
npm ci
$env:JIANJI_FFMPEG_ARCHIVE = 'C:\path\to\ffmpeg-9.0.1-essentials_build.zip'
npm run package:win
$env:JIANJI_FFMPEG_PATH = (Resolve-Path 'dist\win-unpacked\resources\ffmpeg\ffmpeg.exe').Path
$env:JIANJI_FFPROBE_PATH = (Resolve-Path 'dist\win-unpacked\resources\ffmpeg\ffprobe.exe').Path
npm run typecheck
npm test
node scripts/desktop-smoke.mjs
node scripts/feedback-smoke.mjs
node scripts/packaged-runtime-smoke.mjs 'C:\path\to\installed-jianji'
```

`npm test` 的真实媒体用例需上述 FFmpeg 能力和中文字体；输出中的跳过与失败必须逐项记录。`desktop-smoke` 和 `feedback-smoke` 都使用 fixture，不能替代真实服务商或人工观看。打包后应检查 `dist/win-unpacked/resources/sticker-library` 中有 3,144 个 PNG、`licenses/fluent.txt` 存在，`app.asar.unpacked` 内有当前架构的 `codex.exe`，以及 `resources/ffmpeg`、`resources/fonts` 中的二进制和许可证。最终 NSIS 文件 `简辑 Setup 0.1.1.exe` 为 453,421,337 字节，SHA-256 为 `c6f8d3f7a01c30d719ec4a216435f4cf1d39fcdd7c45f9470f3490e7941ade47`；复制 U 盘后应重新核对。

## 正式发布前的人工验收

1. 在干净的 Windows 10/11 目标机上交互式安装、首次启动、关闭、重新启动和卸载；记录 Windows 安全提示、快捷方式、默认图标、卸载残留及安装程序签名。当前 `win.signAndEditExecutable=false` 用于无签名构建；启用正式签名时须重新配置并复验，不应把此包标为已签名。
2. 分别在要支持的 NVIDIA、AMD、Intel 设备上安装对应驱动。确认界面显示实际试编码选出的编码器及并发数；用包含人声或音乐的纵横版素材各导出至少一条，核对 FFprobe 的时长、分辨率、帧率、视频与音频流，并播放检查同步、中文价格、贴纸边界及画面质量。GPU 不可用时应显示 CPU 回退，不能因编码器仅被编译进 FFmpeg 就声称 GPU 可用。
3. 用测试账号及可控额度分别验证实际 ChatGPT 登录或目标 API 视觉模型。确认模型只返回方案，单批价格必须由用户填写、仅新增居中价格文字；取消不产生额外付费请求，导出重试不重新调用模型，错误提示不泄露 Key 或本地路径。
4. 使用用户确认可公开的测试反馈与截图检查线上反馈中继；人工确认脱敏预览和公开截图内容，再检查 GitHub 回执及重复提交行为。隔离 smoke 的通过不证明线上隧道持续可用。

上述待验收项目取得设备、账号和人工播放记录后，逐项把状态改为“通过”或写明失败及复现步骤。`已完成` 任务状态仅表示文件通过程序校验，不表示画面事实或最终观感已经人工认可。
