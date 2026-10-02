# Qianchuan Original Profile Reuse Implementation Plan

**Goal:** 用户继续使用原六个已登录 Chrome 账号，新制作自动连接正确原窗口，不配置 MCP/端口或反复授权。

**Scope:** 新制作的原 profile 识别、私有持久绑定及同 profile 启动；本机六个既有 launcher 的 opt-in 常规 loopback CDP。Native Codex 为执行 owner；受管 Kimi 只读调查和适用风险审查不拥有验收。

**Spec:** `docs/douyin-auto-upload-spec.md` 的 Original Account Profile Reuse Amendment。

## Ownership And Invariants

- `qianchuan-browser-discovery.ts` 只读进程调试参数及有限 tab URL，提供 profile-directory/class；`qianchuan-browser-bindings.ts` 独占原 profile 的私有绑定；`qianchuan-browser-manager.ts` 选择并启动正确 profile。
- `scripts/enable-qianchuan-profile-cdp.py` 对原 host manager 做窄 CAS 补丁和备份，按显式六项名单启用动态 loopback CDP；不关闭浏览器、不读登录数据库、不改桌面身份。
- 原 account settings、upload service/page contract/store 保持授权及冻结历史 owner。新端口不写回旧任务；UNKNOWN 不重传，确认点击为零。
- 未绑定时优先核验唯一可连接原 profile；已绑定失败明确阻断，不回退新 profile。原 profile 不得跨 advertiser 绑定。私有绑定文件损坏、缺失、别名或写入未知均 fail closed。
- 新安装无原窗口时保留独立 profile 路径；应用启动和恢复零浏览器操作。只资格 Linux。

## Milestones

### 1. Verified Original Profile Binding

添加有意义的 red-green tests，覆盖原窗口优先、端口变化、重启后同目录/class、重复账号/跨账号绑定、旧许可式窗口、绑定丢失/损坏/不安全目录及零 fallback。复用 canonical discovery 和安全目录/同步约束，不暴露任意路径 IPC。

原目录权限兼容由 `qianchuan-browser-bindings.ts` 的 `verifyOriginalProfile` 独占：外层私有且两层均为当前用户的规范真实目录时允许 Chrome 内层原有权限，不修改登录目录。`qianchuan-browser-manager.test.ts` 覆盖内层 0755/0775 可复用且权限不变、外层 0775 仍阻断及已有别名拒绝；完成 typecheck、相关上传测试和开发版真实三模板新批量验收。

### 2. Opt-in Launcher Repair

补丁仅增加常规 CDP 参数读取及 opt-in 名单。隔离临时 manager 测试 enabled/disabled、动态 loopback、异常配置和保留 argv；运行 host 原生测试。备份并核对原文件 SHA 后安装窄补丁；不修改正在运行的 Chrome。

### 3. Verification And Activation

运行 typecheck、受影响 Vitest、上传 Harness、build，以及真实隔离 Chrome 的重复 detach/同 profile 重启测试。维护本轮 AOCI、审阅 diff，按 stable candidate 判断风险门并提交本轮文件。只有原待确认页面安全处理后才正常重启原窗口，核验六个 `/json/version`/账号匹配，再在软件执行新 3 模板各 10 条，要求三个账号各 10 READY、正确双 ID、无模型请求及零确认；已有成片和历史上传不参与。

## Acceptance And Limits

工程验证、安装后的真实连接、软件批量上传分别报告。未激活原窗口的修改不能称为接入验收；READY 只证明选文件列表完成，不是平台确认。原窗口重启存在页面丢失风险，不能未经核查执行；测试和 reviewer 不替代该边界。

## Parent Self-Review

当前 private-only 选择逻辑与用户已有登录窗口不兼容；动态端口绑定代替旧端口猜测可解决复用。启动参数无法改动既有 Chrome 主进程，所以先完成代码和隔离证据，再处理一次正常重启。此次范围不涉及制作、模板、渲染或历史恢复行为。
