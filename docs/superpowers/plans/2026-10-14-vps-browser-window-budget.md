# VPS Browser Window Budget Implementation Plan

## Goal And Scope

让既有 VPS Chrome 冷启动使用 1920×1080 普通窗口，减轻实测软件绘制开销；本机仍默认最大化。只修改既有启动参数 owner 及远端调用点，不新增窗口管理器、配置、RPC 或任务生命周期。

## Contract Surfaces And Invariants

`accountChromeArguments` 与 `launchChrome` 接受可选内部窗口模式，省略时保持原默认值；远端 worker 显式选择 remote。`openAccount` 独立保留空白启动语义。原 profile、class、loopback 动态端口、出口参数、启动后的出口核验及登录不变；不刷新、重启、关闭当前浏览器，不修改历史结果、恢复授权或永久屏障。Windows 资格不扩大。

## Files And Ownership

- `src/main/qianchuan-browser-manager.ts`：唯一 Chrome 启动参数及 launch owner。
- `src/main/qianchuan-remote-worker.ts`：既有远端启动调用点；用户已选择先等另一会话完成，再由 Parent 接入。
- `tests/qianchuan-browser-manager.test.ts`：本机参数兼容、远端参数及真实隔离 Chrome 窗口验证。
- `docs/douyin-auto-upload-spec.md`：本修订的合同 owner。
- `docs/vps-browser-performance-investigation-2026-10-14.md`：实测、证据限制及最终交付状态。

## Acceptance And Verification

远端启动包含 `--window-size=1920,1080` 且无 `--start-maximized`；本机行为保持原样。实际隔离 Chrome 的 `Browser.getWindowForTarget` 确认普通窗口 bounds；全部平台请求阻断或使用本地 fixture，不消费真实账号。运行受影响 browser 生命周期回归、typecheck、远端构建及 owned Harness；最终 diff 与 byte hashes 稳定后按 AOCI 当前 Guide 完成必要治理和 completion。真实同页短期 CPU 实验是性能缓解证据，不替代真实自动化和长期容量验收。

## Major Milestones

### 1. Preserve Local Defaults And Add Remote Startup Mode

先取得缺窗口参数的行为 RED，再由 Parent 修改 manager，并验证原参数、profile、端点和初始页面兼容。真实隔离 Chrome 只访问 blank／fixture；进程退出和临时目录清理须有界，不触碰用户 Chrome。

### 2. Integrate After Ownership Release

确认另一会话完成后，读取 fresh worker preimage 并仅修改原 launch wrapper，沿用原出口核验。未获得 owner release 时保留当前 1920×1080 的实测缓解并记录接入阻断，不以稳定 diff 或无新提交猜测 ownership。

### 3. Verify And Deliver The Stable Candidate

运行相关 Harness、typecheck 与构建，按 Risk Gate 作最终裁决。远端部署仅发布验证过的 owned worker，保留状态及当前 Chrome；不得把未知依赖或其他会话未提交代码混入部署。提交、推送并核对 upstream HEAD；部署若被并发依赖阻断须明确报告。必要 AOCI 维护按完整机器批次执行，保留其他会话变更。

## Self-Review

本轮没有改变生产权限、存储或确认行为；窗口默认值可通过单一参数回退。独立窗口模式避免 `openAccount=false` 的隐含重解释。一次成功或静态参数测试不满足性能或长期验收；风险、ownership 与 runtime 限制在调查记录中分别报告。无额外用户批准步骤。
