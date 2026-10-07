# Qianchuan Cleanup Browser Discovery Repair

## Diagnosis

截图中肥皂计划 `1876591298030592` 被历史删除意图阻断；热敷贴显示通用登录提示。只读检查发现两个计划均有历史 pending 文件，分别记录 48 条和 37 条素材。这些数量是未知删除意图的成员数，不是已删除或剩余素材数。

热敷贴浏览器仅保留账户视频库页面，URL 具有精确 `aavid`，没有首页或计划页。`accountVisible` 只识别 `/home` 和 `/uni-prom`，遗漏既有 `VIDEO_LIBRARY_ROUTE`；`QianchuanBrowserManager.prepare` 又将全部 discovery 错误改写为登录提示。当前页面存在不证明登录有效，仍须原页面 owner 检查实际账号与操作范围。

## Repair Boundary

唯一识别 owner 为 `qianchuan-browser-discovery.ts`；接入既有视频库路由常量，保留精确 origin、唯一账户参数、唯一浏览器及 loopback 约束。`qianchuan-browser-manager.ts` 保留 discovery 已脱敏的分类提示，移除掩盖连接故障的通用 catch。

不修改删除 owner、历史 pending、上传账本或 fence。肥皂的阻断保持；热敷贴修复识别后也应报告自己的历史未知删除，不能自动确认、重试或以当前页面重解释历史结果。

## Verification

新增回归用例在原实现上复现视频库漏识别、绑定浏览器准备失败，以及错误提示被覆盖。仅视频库的真实隔离 Chrome 也在原实现上失败；修复后浏览器两组共 66 项通过，包含该 Chrome 的发现、重复连接及正常重启。独立运行原计划清理测试 30 项通过，覆盖未知意图保留、跨重启及再次调用阻断；typecheck 通过。完整 scoped Harness 与 completion 状态以交付时的实际回执为准。

真实账号仅做本机浏览器页面元数据只读检查，没有登录操作或删除。检查期间热敷贴新增了计划页，旧代码也随之能发现该账号；这不否定仅视频库场景的回归，也不证明登录、清理或历史删除成功。

受管 Kimi 只读诊断 invocation `5dbc6e92-a2a1-4020-9e07-d45fda6bbc1d` 使用 deep route，原快照完整读取、artifact 与 source hashes 已由 Parent 核对。Parent 接受错误被统一覆盖和 pending 应保留的结论；视频库路由缺失由本轮代码、运行元数据及回归独立证明。其余有关残留锁、损坏 gate、finally 提示的候选不对应本截图的已核实触发条件，不在本轮扩张恢复语义；尤其不采纳锁释放失败仍标 CLEARED 的建议。

AOCI 两个源码对象按完整机器批次维护；tests 和本记录沿用 observe role。Verify、Check、Guide 已对齐。原有其他会话的改动保留，本轮无需接管或提交其上传恢复实现。

## Session Recording

已检查 repository capture routing，未发现专用 session-record/capture Skill。本记录保存只读诊断、软件修改边界及真实平台限制；不构成真实删除验收。
