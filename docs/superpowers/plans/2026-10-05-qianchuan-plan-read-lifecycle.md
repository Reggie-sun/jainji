# Qianchuan Plan Read Lifecycle

## Goal and Scope

消除计划选择器、多模板及开发 StrictMode 产生的重复投放管理页；退出选择器后取消失效的活动/排队读取。制作速度排查暂缓，不重启当前制作，不上传或确认真实视频。

## Contracts and Owners

- `QianchuanPlanReads` 管理主进程同冻结账号的在途合并和原全局串行读取；结束即移除，无长期结果缓存。账号、CDP、configDigest 不同不能共享。
- renderer 的 request lease 合并同账号选择器，延迟一个事件循环释放最后使用者以承接 StrictMode 的同步重挂载；有使用者时不能误取消。
- 现有可信 IPC 增加 UUID request identity 与取消接口，主进程以 sender identity 隔离取消权限；旧无 requestId 调用保持兼容。
- `QianchuanPlanSelect` 使用 lease，在卸载/切账号时释放。最后使用者取消 queued work，已开始的读取只关闭它拥有的临时页；原上传页/弹窗保留。
- 上传 schema、永久 fence、unknown 零重传、账号漂移拒绝和制作前计划校验保持原合同。

## Acceptance and Verification

同账号多个使用者和 StrictMode 只触发一次在途读取；取消部分使用者不影响其余使用者，全部取消后 queued work 不打开 Chrome，活动读取停止并清理自建页；不同账号/配置独立，失败后可重新读取，后续显式刷新不复用已完成结果。界面迟到返回不覆盖新账号。

先在 `tests/qianchuan-plan-selection.test.ts` 复现同账号两次真实 reader 调用；验证主进程取消、权限隔离及 preflight 准入。隔离 Chrome UI 覆盖多选择器、StrictMode 和退出。完成 typecheck、上传域 Harness 和 owned AOCI，按风险判断独立 review，提交本轮 owned changes。

## Verification Stabilization

完整 Harness 保留了四项旧上传测试失败。独立运行确认连续落盘与投递在当前机器需约 2.9 秒，原 `vi.waitFor` 的默认 1 秒不足以等待状态。`tests/douyin-upload-service.test.ts` 改为最多 3 秒等完整分组，取消/超时 fixture 的 processing 为 4 秒，总测试上限 15 秒；READY、21 个永久 fence 与禁止重传断言保持。

`tests/douyin-cdp-uploader.test.ts` 的缺行用例增加首组实际 READY 屏障，显式建立“第一组完成、第二组缺行”的前提；隔离 fixture 仍使用有限期限，第二组保持 UNKNOWN，第三组未选，恢复只读且零确认。产品默认 timeout 未改。诊断四项通过不代替完整 Harness，最终重新捕获 scope 并运行完整检查。

## Self Review

Native Codex 保留实现和裁决责任；已完成只读 mapper 证实调用路径。只合并正在进行的读请求，不以旧列表证明当前计划；取消路径不接触上传 runner。现有 dirty 文件须用户确认归属后再写入。
