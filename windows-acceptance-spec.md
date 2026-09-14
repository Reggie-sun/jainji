# 简辑 Windows 验收规范与执行记录

基线：`main` 的 `3e4b428dff8a`。本记录在 Windows 11 x64（内核 `10.0.26200`）、Node.js `22.19.0` 上于 2026-09-14 执行。**自动化、NSIS 静默安装与卸载已通过；商业模型、目标 GPU、交互式安装及成片观看尚未验收，不能据此宣布发布完成。**

## 环境与边界

- 使用 `npm ci` 安装锁定依赖；本机的 `C:\Windows\Fonts\msyh.ttc` 存在。
- 测试用 FFmpeg/ffprobe 为 [Gyan 发布的 9.0.1 essentials 构建](https://www.gyan.dev/ffmpeg/builds/)，仅解压到任务临时目录，通过 `JIANJI_FFMPEG_PATH` 和 `JIANJI_FFPROBE_PATH` 指定，没有安装到系统。下载包 SHA-256 为 `49a73bdf0850092a252ac4641d922f3048d63ed113e196cc65ce1e4f7fb33e85`，与发布方的 `.sha256` 文件一致；本机确认具有 `libx264`、`aac`、`drawtext` 和 `overlay`。编码器出现在列表中不等于对应显卡可用。
- 桌面 smoke 使用真实 Electron、IPC 与 FFmpeg，但模型、登录、CC Switch、GitHub 和文件选择器使用隔离 fixture；没有调用真实商业模型、真实账号或创建真实 Issue。
- 安装包不内置 FFmpeg。新机器应按 README 配置引擎并重启应用；没有引擎或字体时，制作入口应禁止出片并显示原因。

## 验收门槛与本次结果

| ID | 判定标准 | 本次证据 | 状态 |
| --- | --- | --- | --- |
| W01 | Windows x64 上依赖安装、类型检查通过 | `npm ci`、`npm run typecheck` 均退出 0 | 通过 |
| W02 | 单元和集成测试通过；跳过项有原因 | `npm test`：41 个文件通过、2 个文件跳过；301 个测试通过、8 个跳过 | 通过 |
| W03 | 真实 FFmpeg 保留视频与音频，价格和贴纸按规则渲染，输出经过验证且不替换已有文件 | `ffmpeg.integration`、`corner-render.integration`、`price-styles.integration`、`export-formats`、`agent-pipeline.integration` 和并发集成测试在 Windows 运行通过 | 通过 |
| W04 | 重启后的待处理任务标记为中断，不自动恢复模型请求；旧装饰文字方案不能重试导出 | `queue`、`price-only`、`project-sync` 测试与 `desktop-smoke` 通过 | 通过 |
| W05 | 真实桌面界面的 API、模板、价格、导出、取消、恢复、窄窗口、凭据不回传与退出流程可运行 | `node scripts/desktop-smoke.mjs` 返回 `PASS`，2 次 fixture 制作请求，渲染异常 0 | 通过 |
| W06 | 反馈提交、截图、回执、结果不明时核对与重启恢复不会重复发 Issue | `node scripts/feedback-smoke.mjs` 返回 `PASS`，仅本地 GitHub fixture，渲染异常 0 | 通过 |
| W07 | 标准 Windows 构建和 NSIS 打包成功；资源齐全 | `npm run build`、`npm run package:win` 退出 0；安装包含 3,144 张贴纸及许可证、Windows Codex 可执行文件 | 通过 |
| W08 | 解包版与安装版能启动，出现规则模板界面及 IPC 桥 | 分别用隔离应用数据目录启动并通过 Chromium 调试协议检查，页面标题为“简辑 · Agent 视频创作工作台” | 通过 |
| W09 | NSIS 安装与卸载不破坏已有应用 | 安装前确认本机无简辑记录；静默安装到任务隔离目录后应用启动成功；静默卸载退出 0，可执行文件及当前用户卸载注册表项均消失 | 通过 |
| W10 | 正式发布包具有产品图标、代码签名，交互式安装与卸载体验通过人工检查 | 当前使用 Electron 默认图标，未配置签名；只执行了静默安装与卸载 | 待验收 |
| W11 | 目标 NVIDIA、AMD、Intel 设备上的实际编码与成片质量可接受 | 本机未完成所有目标 GPU 的真实导出；NVENC 集成测试因无可用 NVENC 跳过 | 待验收 |
| W12 | 用户实际登录所选 ChatGPT 或 API 视觉模型，播放并确认生成内容、画面和音频 | 本次仅用模拟服务；未使用真实账号或商业额度，未人工观看正式素材 | 待验收 |

8 个跳过项分别为：6 个仅在非 Windows 系统运行的 FFmpeg 能力 fixture 测试、1 个需显式启用网络下载的素材库测试、1 个要求实际 NVENC 设备的集成测试。这些跳过不抵消 W11/W12 的待验收状态。

## 可重复的自动化步骤

在仓库根目录执行以下 PowerShell 命令。FFmpeg 路径替换为当前机器上的实际位置；`ffmpeg.exe` 与 `ffprobe.exe` 应来自同一构建。

```powershell
npm ci
$env:JIANJI_FFMPEG_PATH = 'C:\path\to\ffmpeg.exe'
$env:JIANJI_FFPROBE_PATH = 'C:\path\to\ffprobe.exe'
npm run typecheck
npm test
npm run build
node scripts/desktop-smoke.mjs
node scripts/feedback-smoke.mjs
npm run package:win
```

`npm test` 的真实媒体用例需上述 FFmpeg 能力和中文字体；输出中的跳过与失败必须逐项记录。`desktop-smoke` 和 `feedback-smoke` 都使用 fixture，不能替代真实服务商或人工观看。打包后应检查 `dist/win-unpacked/resources/sticker-library` 中有 3,144 个 PNG、`licenses/fluent.txt` 存在，以及 `app.asar.unpacked` 内有当前架构的 `codex.exe`。本次 NSIS 文件为 `dist/简辑 Setup 0.1.0.exe`，大小 387,003,830 字节，SHA-256 为 `6b95c9ea8a5ccffffd625328882c09195794e3db1ae0586168b3d4c1171b37a4`；重新构建后应重新计算哈希。

## 正式发布前的人工验收

1. 在干净的 Windows 10/11 目标机上交互式安装、首次启动、关闭、重新启动和卸载；记录 Windows 安全提示、快捷方式、默认图标、卸载残留及安装程序签名。当前 `win.signAndEditExecutable=false` 用于无签名构建；启用正式签名时须重新配置并复验，不应把此包标为已签名。
2. 分别在要支持的 NVIDIA、AMD、Intel 设备上安装对应驱动和 FFmpeg。确认界面显示实际试编码选出的编码器及并发数；用包含人声或音乐的纵横版素材各导出至少一条，核对 FFprobe 的时长、分辨率、帧率、视频与音频流，并播放检查同步、中文价格、贴纸边界及画面质量。GPU 不可用时应显示 CPU 回退，不能因编码器仅被编译进 FFmpeg 就声称 GPU 可用。
3. 用测试账号及可控额度分别验证实际 ChatGPT 登录或目标 API 视觉模型。确认模型只返回方案，单批价格必须由用户填写、仅新增居中价格文字；取消不产生额外付费请求，导出重试不重新调用模型，错误提示不泄露 Key 或本地路径。
4. 使用用户确认可公开的测试反馈与截图检查线上反馈中继；人工确认脱敏预览和公开截图内容，再检查 GitHub 回执及重复提交行为。隔离 smoke 的通过不证明线上隧道持续可用。

上述待验收项目取得设备、账号和人工播放记录后，逐项把状态改为“通过”或写明失败及复现步骤。`已完成` 任务状态仅表示文件通过程序校验，不表示画面事实或最终观感已经人工认可。
