# Qianchuan Captured Upload Details

## Scope

修复批量作品页显示旧账号槽位名称，以及开始新制作后旧商品详情丢失上传记录的问题。仅交付源码；用户明确要求制作期间不要更新软件，本轮没有安装、重启、继续上传、确认或发布。

## Live Findings

只读核对批次 `74b4df7e-73b8-4c17-96a3-7f11b0c497f2`：晚安油导出完成 30 条，上传账本为 12 条 `READY`、9 条 `MAY_HAVE_UPLOADED`、9 条 `PENDING / NOT_SELECTED`。冻结账号与当前保存的晚安油账号、计划一致；`眼贴` 是内部稳定槽位，详情页错误地直接显示该字段。

9 条未知任务保留永久 selection fence。错误记录为“操作已停止或阶段超时”；当前原 Chrome tab 仍存在，但上传弹窗已关闭。无法证明未知任务成功或失败，也无法据此重选文件。配置中的文件选择时限为 30 秒、平台处理时限为 1800 秒；源码还存在 30 秒的缺行观察窗口，现有证据不能确定具体中断阶段，本轮不推测性调整时限。

开始后续制作后，当前运行状态只包含新制作；旧详情却调用同一个状态过滤入口，导致其上传记录返回空。这属于只读展示缺陷，不能通过恢复历史上传权限修复。

## Implementation

- 详情和普通上传任务行复用 `qianchuanProductName`，显示保存的名称，账号和计划身份保持冻结。
- `DouyinUploadService.capturedStatus` 按可信 job 捕获的 project 与 export task IDs 读取记录，仅返回展示信息。旧记录明确说明不自动续传；不暴露活动批准字段。
- 原 `status` 与 `requireTask` 仍只允许当前制作。未知结果、永久屏障、重复上传防护和浏览器操作路径保持原合同。
- 详情分别展示已上传、待上传、处理中、结果未知和需处理数量。未知任务显示核查原 Chrome 页面的提示；完整闭批记录保留只读历史，部分成员查询不伪造闭批摘要。

## Verification

已先复现旧名称及旧记录不可读的失败测试，再验证修复。Focused native Harness：`PASS`，243 项测试通过、无失败或跳过，typecheck 和隔离 renderer smoke 通过，运行前后 workspace identity 一致。回执：`.agent/harness/runs/20260930T231628Z-22cf3a26/receipt.json`。`npm run build` 通过。

Chrome MCP 在独立 context 中核查名称、12/9/9 数量、历史轮询及返回列表，生产动作调用为 0。服务测试核查跨项目过滤、历史 continue 拒绝、账本与 fence 字节不变，以及完整闭批历史。

受管 Kimi mapping invocation：`10926793-d817-4779-9f7c-ad8f0d671a9c`；route receipt 为 `PARSED`，由 parent 根据源码与测试裁决，不代表真实上传验收。稳定候选的 Review Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：本轮只读展示不改变上传或持久状态权限，相关执行验证已覆盖。证据和 source hashes 位于 `.agent/harness/runs/20261001-wanan-upload-diagnosis/`。

## Remaining Boundary

本轮没有恢复晚安油剩余上传；9 条未知结果及 9 条未选任务仍需基于真实平台状态处理。没有声称 30 条全部上传或平台接受。新显示逻辑尚未安装到用户正在使用的软件。
