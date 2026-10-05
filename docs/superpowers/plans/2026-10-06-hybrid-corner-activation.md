# Hybrid Corner V1 Activation Integration

## Goal and Scope

把用户已授权的 H2 → H3 → H4 corner partial-processing 接入 `AgentController.start`、既有 `AgentRunner`、`TemplateCompiler` 与 `ExportQueue`。基于最新 `origin/main` d6fe167 集成 H4 c26e8b8；独立 worktree，不修改主工作树 batch/Qianchuan 改动。

## Contracts and Invariants

`coverStrategy=shape-matched-static-v1` 是用户入口意图。只有 H4 同 source/packet/PNG/binding 的 PASS 才产生内部批准层；普通 JSON 不恢复权限。compiler 消费全画布 PNG 的同字节 task copy，零缩放、重选、placement 修改、扩边或白矩形 fallback。queue 编码前和发布前重核 source、PNG、binding 与 opaque coverage。

每角独立跳过；无 confirmed/PASS 角也可原样导出，须明确没有覆盖。source/connection/binding 错误关闭全源，不能降级。自动形状入口保留未确认角落，不能叠加普通自动四角贴纸。旧 manual/assisted/矩形模式保持原解释。旧 strict/proof 仍研究路径，不能作为 Hybrid blocker。

已有 real233s H4 artifact 通过显式内部证据导入重核：核对用户批准的 archive/packet/receipt SHA、源、原12图、preview 和 PNG；只复核原结构化决策，不新模型调用或重新渲染 preview。正常用户请求使用原 H2/H3/H4 pipeline。批准是进程内 owner；持久化模板的 JSON 单独不能重新授予权限，重启后的失权任务明确失败关闭，不自动重跑分析。

## Major Milestones

1. 安全集成 H4 与 main，读取当前 owner、合同和只读 Kimi mapping；恢复冲突索引完整字节，按官方治理工具维护。
2. 增加 shared frozen layer binding 与 main-only H4批准 adapter；在 compiler/queue 原 seam 校验，并提供 source/PNG/QA changed、forged clone、partial 的负向回归。
3. 原制作入口创建 Hybrid preparation callback，既有 runner 按逐源/版本生成模板并提交原队列；UI明确自动形状、四角静态、partial，其他角原样。
4. real233s 经正式 controller → runner → compiler → queue 导出；记录 PNG SHA/placement/coverage 与原 H4一致、正常文件验证及实际输出。
5. typecheck、完整 H3/H4、extended regressions、完整 Harness、completion 和实际 UI交互。失败按 Hybrid/main归因，required 不降。稳定 checkpoint 后按 Risk Gate判定独立review，官方 AOCI Verify/Check/Guide、记录、commit/push核对远端。

## Acceptance and Verification

用户九项交付均由当前证据回答。PRODUCT_DISABLED 仅在最终 gates PASS 后解除；失败时保留 guard。回归测试验证错误源、设置、PNG、批准身份、layer变更及输出前漂移拒绝。真实输出保留原时长、音频、顺序；自动验证不冒充整片人工视觉验收。固定 evidence 根在私有 state，秘密与本地原素材路径不提交。

最终启用 candidate 只在隔离 worktree 内运行正式资格导出和完整 Harness，全部 required gate PASS 后才 commit/push；失败恢复关闭。纯结果记录沿既有 documents/owned-aoci 路由，源码与 accepted plan 的完整生产检查不削减。real233s 使用独立项目及 canonical 源知识 store，不读取或恢复其他会话的运行状态。

## Out of Scope

不改 H2/H3/H4 算法、阈值、prompt、resolver；不增加 H5/H6、全源 completeness、strict proof、新队列或新模型；不修改 batch/Qianchuan 业务；不自动重试 unknown provider outcome。

## Self-Review

覆盖用户全部 Activation 要求；默认授权仅用于任务内接线与恢复。正式源码修改与索引治理在独立 worktree；主工作树现有 dirty paths不触碰。既有 H3完整integration在原120s上限实际1/1 PASS；全仓证据仍待最终稳定源码验证。
