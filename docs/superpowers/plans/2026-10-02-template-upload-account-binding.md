# Template Upload Account Binding Implementation Plan

## Goal And Scope

在跨模板批量列表直接选择并记住每个模板的千川账号，允许多个模板共用账号。按用户 A 授权串行实现；继续使用 make frontend，不操作真实上传弹窗或启动制作。

## Contracts And Invariants

依据 [Upload Spec](../../douyin-auto-upload-spec.md#per-template-account-binding-amendment-2026-10-02)。共享 schema 定义严格关联输入和存储格式；QianchuanAccountSettings 是私有偏好 owner，独立文件不改账号 mapping digest。主进程解析 registry/project 身份，校验所选槽位的 advertiser；保存不授上传权限。新批次保留原 preflight/freeze/page contract，运行中修改只作用下一批。无关联的旧模板兼容唯一同名匹配；失效显式关联绝不回退。

## Major Milestones

### 1. Persist And Enforce Binding

修改 src/shared/batch-upload.ts、batch-production.ts，src/main/qianchuan-account-config.ts、qianchuan-account-settings.ts、douyin-upload-service.ts、batch-production-runtime.ts、batch-production-controller.ts。复用私有读取及写锁，原子保存 recentProjectId/projectId/accountProduct/advertiserId；账号换绑、项目替换和预检竞态拒绝。tests/batch-upload.test.ts、qianchuan-account-settings.test.ts、batch-upload-admission.test.ts、batch-production.test.ts 验证跨名称、共用账号、重启恢复、配置字节不变、损坏文件与身份失配。

### 2. Expose And Verify UI

修改 src/main/index.ts、preload.ts，src/renderer/BatchProductionPanel.tsx、batch-production.css：每行提供账号下拉，保存完成才更新选择，显示名称及账号 ID；禁用保存中的启动，保留下一批编辑。通过真实 Electron/IPC 交互验证选择、刷新和重启恢复，不提交制作或上传。

## Verification And Delivery

先记录相关回归 RED，再运行受影响 Vitest、npm run typecheck、构建与 Chrome MCP 实际交互；稳定候选判断 implementation Risk Gate。本轮文件逐项维护 AOCI，scoped Harness 与 verify 回执绑定当前字节，检查最终 diff 后仅提交本轮文件。无关会话改动保留；平台上传、Windows 实机和跨机偏好迁移不属于本轮验收。

组合检查的真实 Chrome fixture 另有两个已复现环境问题：全局进程扫描遇到另一任务的不安全 profile；Chrome 扩展启动过程中增加 service_worker。曾以 Linux PID namespace 隔离诊断，不改原窗口或生产发现校验；另一窗口以 26382c7 单独提交 exact-profile 发现与测试调用后，最终检查使用正常宿主环境。tests/qianchuan-browser-manager.test.ts 保留本轮非空、排序后的 page target 核对和禁用 fixture 扩展，验证真实标签保留。

## Self-Review

两个 milestone 覆盖持久 owner、可信 IPC、主进程准入和用户交互；不引入第二账号事实、制作队列或上传生命周期。稳定槽位加期望 advertiser 阻止隐式跨账号改传；旧冻结批次不读新偏好。
