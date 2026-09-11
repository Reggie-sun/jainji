---
id: ADR-001
status: complete
decision_status: Accepted
traces_to: [REQ-001, REQ-003, REQ-004, NFR-P-001, NFR-S-001]
date: 2026-09-11T23:18:21+08:00
---

# ADR-001: 本地桌面与 FFmpeg 边界

## Context

产品需要在 Ubuntu 上处理大体积本地媒体、打开原生文件对话框、持续跟踪子进程并在断网环境工作。交互预览必须快速，但只有一个实现可以拥有最终编码语义。

## Decision

采用 Electron 单机桌面 monolith。React renderer 只负责 UI 和近似预览；Electron main process 独占文件系统与进程权限；system FFmpeg/ffprobe 是唯一最终 probe、filter 和 encode owner。所有命令通过 `spawn` 的 argv 且 `shell=false` 执行。

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Electron + system FFmpeg（chosen） | 现代 UI、原生文件能力与子进程控制均成熟；媒体不上传；实现语言统一 | 内存占用较高；依赖用户 FFmpeg 环境；需严格加固 IPC |
| Python + PySide6 + FFmpeg | Ubuntu/Python 集成直接，桌面权限边界清晰 | 富交互图层编辑和 UI 测试生态弱于 web stack；打包 native 依赖同样复杂 |
| Local web server + browser + FFmpeg | 后端简单，浏览器 UI 开发快 | 文件授权、生命周期、打开目录和单实例体验更像开发工具而非桌面产品 |
| 纯浏览器 WebCodecs/Canvas | 无外部 FFmpeg 依赖 | codec/container 覆盖和长时大文件处理不足，容易形成第二套渲染语义 |

## Consequences

- **Positive**: 本地隐私、桌面文件体验、成熟 FFmpeg 能力和清晰 final-render owner。
- **Negative**: Electron 资源成本和 system FFmpeg 安装/兼容体验必须被主动管理。
- **Risks**: 若 preload 暴露过宽或 FFmpeg 参数通过 shell 执行，会引入高风险本地执行漏洞。

## Traces

- **Requirements**: [REQ-001](../requirements/REQ-001-batch-media-import.md), [REQ-004](../requirements/REQ-004-batch-export-queue.md), [NFR-S-001](../requirements/NFR-S-001-local-data-safety.md)
- **Implemented by**: [EPIC-001](../epics/EPIC-001-media-and-project-foundation.md), [EPIC-003](../epics/EPIC-003-export-pipeline.md)
