# Material Template Shortcut Implementation Plan

## Goal And Scope

补回素材页直接选择已保存素材模板的下拉入口和重命名操作。此增量修正 [Task Pages Plan](2026-10-11-task-pages.md) 将入口全部移走的体验缺口；完整项目管理及删除仍留在项目页。

## Owners And Contracts

- `MaterialCollection.tsx` 复用原已保存项目列表、重命名表单和回调，仅增加紧凑素材模板视图。模板是原项目，不增加第二份模板数据或存储。
- `SourceMediaList.tsx` 仅接受模板入口节点并放在素材清单标题旁；`material-collection.css` 约束宽/窄窗口布局。
- `App.tsx` 沿原 `changeProject` / `apply` / `renameSavedCollection` 加载恢复与改名；素材快捷切换成功后保持素材页，失败保留原项目。运行中沿原禁用条件，不取消制作、不保存或启动任务。
- `tests/task-pages.test.ts` 使用已有隔离 App bridge，覆盖空清单选择、文字/数量恢复、重命名、加载失败和运行中禁用；不修改真实项目或其他会话文件。

## Acceptance And Verification

素材为空也能就近打开下拉，点击模板直接恢复素材及保存的文字/包装设置；下拉可重命名但不提供删除。切换失败不把目标模板假显示为当前模板。模板打开与改名仍交原 owner 处理，保留已有未保存处理及冻结生产限制。

执行相关交互回归、typecheck、build、当前 policy 的 owned-scope Harness 与 completion verify；Chrome MCP 验证实际宽/窄布局和模板往返。最终字节评估 Review Risk Gate，完成本轮 AOCI 与官方 Verify/Check/Guide；仅提交本轮文件或共享索引 owned hunks，push 当前 upstream 并核远端 SHA。

## Self-Review

仅恢复用户已明确要求的素材模板快捷操作；没有把完整项目管理放回素材主体，没有新增保存、生产、上传或清理权限。现有项目列表与共享准入保持 canonical；初次失败复现指向缺失入口，而非不存在的模板。
