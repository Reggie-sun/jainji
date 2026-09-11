---
session_id: SPEC-简辑批量视频编辑器-2026-09-11
phase: 6
document_type: spec-summary
status: complete
generated_at: 2026-09-11T23:18:21+08:00
stepsCompleted:
  - synthesis
version: 1
dependencies:
  - product-brief.md
  - requirements/_index.md
  - architecture/_index.md
  - epics/_index.md
  - readiness-report.md
---

# Spec Summary: 简辑

## Product & Vision

简辑是一款 Ubuntu 本地批量视频编辑工具。用户创建一次由多文字图层、多贴纸图层和一个全局滤镜组成的编辑模板，就能把它一致应用到一批原始素材，并为每个输入分别得到一个输出成片。

成功体验只有三步：**导入 → 编辑模板 → 导出**。产品不试图替代专业时间线剪辑器。

## User & Problem

目标用户是在 Ubuntu 上反复处理同类型短视频的个人创作者或内容运营。他们当前需要在通用剪辑软件中逐条复制效果、逐条启动导出，或维护不可视、难恢复的命令行脚本。

## MVP Contract

- MUST 批量导入 MP4、MOV、MKV、WebM，并逐项探测。
- MUST 支持可保存的多文字/贴纸图层和一个完整时长全局滤镜。
- MUST 提供近似交互预览和使用最终链路的验证样片。
- MUST 为每条输入建立独立导出任务并生成 H.264/AAC MP4。
- MUST 保证原始素材只读、输出不静默覆盖、单项失败不取消整批。
- MUST 持久化项目和队列，并在崩溃后把非终态任务恢复为 `interrupted`。
- MUST 在离线环境完成核心流程。

明确不做：时间线裁切/拼接、多轨道、转场、关键帧、音频编辑、云端、账户、跨平台和合并成片。

## Architecture

- **Shape**: Electron + React/TypeScript 单机桌面 monolith。
- **Authority**: Electron main process 独占文件、进程、持久化和队列；renderer 通过 typed preload allowlist 调用。
- **Media Owner**: system FFmpeg/ffprobe 是唯一最终 probe/render/verify owner。
- **Template Owner**: versioned canonical `EditTemplate` 使用 normalized display-frame coordinates；预览和导出只实现 adapter。
- **Queue Owner**: explicit `ExportTask` state machine + default concurrency 1 + atomic JSON store。
- **Output Gate**: partial file → FFmpeg exit 0 → ffprobe valid → atomic rename → `OutputArtifact`。

ADRs: [local desktop/FFmpeg](architecture/ADR-001-local-desktop-and-ffmpeg.md), [canonical template](architecture/ADR-002-canonical-template-model.md), [durable queue](architecture/ADR-003-durable-export-queue.md).

## Delivery Breakdown

| Epic | Scope | MVP |
|------|-------|-----|
| [EPIC-001](epics/EPIC-001-media-and-project-foundation.md) | schemas、素材探测、项目存储、capability check | Yes |
| [EPIC-002](epics/EPIC-002-template-and-preview.md) | 图层编辑、预览、模板复用、验证样片 | Yes |
| [EPIC-003](epics/EPIC-003-export-pipeline.md) | template snapshot、安全 FFmpeg、队列、发布 | Yes |
| [EPIC-004](epics/EPIC-004-results-and-resilience.md) | 结果、错误恢复、重试、重启恢复 | Yes |

共 6 Functional Requirements、4 Non-Functional Requirements、3 ADRs、4 MVP Epics 和 15 Stories。

## Open Decisions

| Decision | Current Assumption | Must Resolve Before |
|----------|--------------------|---------------------|
| 最大批次规模 | 100 条 | EPIC-001 performance fixtures |
| 硬件编码 | 不进入 MVP，CPU baseline | EPIC-003 preset freeze |
| FFmpeg 分发 | 使用 system FFmpeg + startup check | EPIC-001 packaging |
| 字体携带 | 引用系统字体，不打包 | EPIC-002 template schema freeze |

## Readiness

**Pass — 96/100.** 没有 blocking specification error；Open Decisions 已保留为显式 assumptions，不能在实现中静默改变。

推荐先做 domain + FFmpeg architecture spike，用 synthetic 横/竖屏 fixtures 验证 normalized layout、Unicode 文字、透明贴纸、滤镜与安全文件名，然后再进入完整 implementation plan。

## Document Manifest

- [Product Brief](product-brief.md)
- [Requirements Index](requirements/_index.md)
- [Architecture Index](architecture/_index.md)
- [Epics & Stories Index](epics/_index.md)
- [Readiness Report](readiness-report.md)
- [Glossary](glossary.json)
- [Refined Requirements](refined-requirements.json)
