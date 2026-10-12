# Local Plan Browser Preparation Plan

## Goal

本机账号 Chrome 关闭时，简辑的前台账号选择及刷新计划先自动启动原绑定浏览器，再读取计划。已打开时保持当前窗口、子账户和登录资料。

## Scope And Contract

约束来源为 [上传合同的 Local Foreground Plan Preparation Amendment](../../douyin-auto-upload-spec.md#local-foreground-plan-preparation-amendment-2026-10-13)。不改变 IPC/schema、配置文件、历史批次、上传权限或 VPS 资源策略。前台上传和清理目录调用均在原 `listPlans` owner 获得本机启动权限；后台共享目录默认不启动。沿用原 manager 只在确认进程缺席时打开的行为，故障不等于缺席。

## Implementation Milestone

修改 `src/main/douyin-upload-service.ts` 的目录准备接缝，使前台请求显式允许启动本机 Chrome，后台默认仍只连接；同步 `src/main/qianchuan-browser-manager.ts` 的前台准备权限注释。当前网页目录只在首次准备时允许启动，读取后的身份复核不再开窗；保存账号目录复用原缓存及冻结核验。每次操作仍受原浏览器准备计数、互斥、取消及配置检查约束。

在 `tests/qianchuan-plan-selection.test.ts` 复现关闭后前台读计划失败，再覆盖冷启动、暖窗子账户、保存目录、后台恢复、取消和读取期间浏览器消失。真实隔离 Chrome 的启动与复用由现有 manager 测试核验，不操作用户真实素材。

## Acceptance And Verification

- 前台所选本机账号关闭时自动启动一次，正确返回计划；暖窗复用当前子账户，无账号切回或重启。
- 应用恢复及后台预加载不会启动任何账号；VPS 不接受本机启动参数。
- 错账号、坏连接、取消及前后身份漂移停止，读取后不补开消失窗口；映射和上传账本不变。
- 运行相关计划选择、account settings、browser manager 测试、typecheck 和 owned Harness；非微小界面接线用现有浏览器交互测试验证。
- 稳定后核对 AOCI role 并完成官方维护和 Verify/Check/Guide；仅提交本任务文件及对应 AOCI hunks，推送当前 upstream 并核远端 SHA。

## Self-Review

前台与后台权限在 service 的调用边界分离，未扩大原 browser manager 默认权限。新制作的自动打开已实现，但无法解决开始前的计划选择，本增量补齐该接缝。缓存仍只用于展示，生产准入和读取后的身份验证保持原 owner。
