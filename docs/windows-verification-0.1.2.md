# Windows 0.1.2 验证记录

日期：2026-09-15。Windows 11 x64（10.0.26200），Node.js 22.19.0。

本包包含 main `2d1ecb4` 的更新，合并到内置运行环境分支的提交为 `9288f96`，另含 0.1.2 版本号及应用目录贴纸定位修复。此前的 FFmpeg/ffprobe 与 Noto 中文字体打包改动继续保留；不使用用户账号、商业模型额度或真实 GitHub 反馈。

| 检查 | 结果 |
| --- | --- |
| 类型检查、前端及 Electron 构建 | 通过 |
| 完整测试 | 46 个文件通过、1 个文件跳过；407 项通过、8 项跳过 |
| Windows 桌面 smoke | PASS；3 次制作 fixture、3 次提示词 fixture、1 次贴纸候选 fixture；渲染异常 0 |
| 反馈 smoke | PASS；真实本地中继、GitHub fixture；渲染异常 0 |
| 包内资源 | FFmpeg/ffprobe、默认 Noto 字体、Codex、3,144 张贴纸及许可证均存在 |
| 最终 NSIS 全新隔离静默安装 | 退出 0，应用文件存在 |
| 安装版首次启动和引擎 | 隔离 APPDATA，PATH 仅含系统目录，IPC `ready=true`、`libx264`；内置字体中文文字编码及 ffprobe 通过 |
| 最终包隔离静默卸载 | 退出 0，应用文件消失 |

8 项跳过为 6 项非 Windows 专用 fixture、1 项显式启用网络才运行的素材库集成、1 项需要 NVENC 硬件的集成。真实商业模型、目标 GPU、交互式安装及成片人工观看仍未验收。安装包未签名，使用默认 Electron 图标。

桌面检查发现开发启动器切换工作目录后，素材库原有相对路径无法找到贴纸；主进程现从应用目录解析开发版资源，安装版继续从 resources 解析。桌面 smoke 已在切换到隔离工作目录后通过。

最终安装包：`简辑 Setup 0.1.2.exe`，453,432,647 字节。
SHA-256：`74454c8b8e17c057ad0b475e3adabf855956416444dcbed05f2c6048608a8914`。

使用 `node scripts/packaged-runtime-smoke.mjs <安装目录>` 可重复安装版内置运行环境检查。完整目标电脑人工验收清单仍见 [Windows Acceptance Spec](windows-acceptance-spec.md)；本记录不把尚未执行的项目标为通过。
