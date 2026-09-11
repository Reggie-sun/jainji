---
id: NFR-S-001
type: non-functional
category: Security
priority: Must
status: complete
---

# NFR-S-001: 本地数据与文件安全

**Category**: Security
**Priority**: Must

## Requirement

核心流程 MUST 在离线环境完成，应用 MUST NOT 上传媒体、模板、路径或使用数据。所有子进程参数 MUST 以 argv 传递，不得拼接后交给 shell；所有写路径必须验证位于用户选择的项目或输出范围内。

## Metric & Target

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| 断网核心流程完成率 | 100% | 禁用网络后执行 E2E |
| 原始素材原位写入 | 0 | 文件哈希前后比较 |
| shell 注入可达路径 | 0 | 含引号、分号、换行和 Unicode 的文件名测试 |
| 未声明网络请求 | 0 | 进程网络监控 |

## Traces

- **Goal**: G-003
- **Architecture**: [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md)
