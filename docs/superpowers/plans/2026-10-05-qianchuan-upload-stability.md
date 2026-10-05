# Qianchuan Upload Stability And Throughput Plan

## Goal And Scope

修复已连接的原上传弹窗短暂隐藏被误判丢失的可复现路径，减少历史上传账本对每次状态保存的重复全表扫描。用户要求继续完成修复；本轮不重新上传、迁移、清除旧任务或改变任何真实账号状态。

## Evidence And Ownership

上一轮只读现场：200 条已生成，39 READY、36 MAY_HAVE_UPLOADED、125 NOT_SELECTED；停止原因为原弹窗丢失/不唯一/归属改变。用户确认没有操作弹窗。当前原 tab 已刷新、弹窗不存在，因此历史自行消失的具体诱因无法反推；不得将 fixture 修复声称为该历史事件的确定根因。

`QianchuanPageSession.guard` 是弹窗身份和稳定性 owner，`DouyinUploadStore.validate` 是账本完整性 owner，`DouyinUploadService` 保持原单 runner、连续投递与最终全列表 READY。目标文件原本干净；其他 source-mask、plan-selection、renderer 与 AOCI 改动保留。本轮 Parent 单 writer，不创建 worktree。

## Contracts And Invariants

- 弹窗只允许对同一个 DOM node、原 session tag、原 page/frame 进行有限只读稳定等待。真实移除、替换、重复、marker 改变仍拒绝；不重新打开或补选文件。
- 隐藏等待前后继续核查账号、计划、完整行列表和容量；超时/取消失败关闭。恢复只读，不给历史 UNKNOWN 新选择权限。
- READY 仍由全列表成功和可用确定按钮决定，保持 zero-confirmation 与永久逐文件 fence。
- 账本校验改用本次调用内的 batch/count/identity lookup，仍逐项验证原数据、目标、fence、重复 lineage 与 closure。无格式迁移、缓存跨调用或减少验证。
- 稳态观察降低频率时保留新成片及时接收、有界 processing 和 abort 语义；不增加并行队列或网络上传。

## Major Milestones

### 1. Reproduce And Remove False Modal Loss

对 `tests/qianchuan-page-contract.test.ts` 增加真实隔离 Chrome/production DOM 用例：原节点短暂隐藏后返回、持续隐藏、真正移除、替换及取消。`src/main/qianchuan-page-contract.ts` 绑定原 DOM node 后做有限等待；新逻辑必须同时强化 replacement 拒绝。先运行失败复现，再实现并验证。

`tests/douyin-cdp-uploader.test.ts` 在每个用例完成其保留页面断言后，清理隔离 fixture 创建的测试页，只保留原 target。测试间的历史页面不能持续轮询并干扰后续用例；真实 uploader 的 detach 语义不变。

### 2. Reduce Local Upload Overhead

对 `src/main/douyin-upload-store.ts` 的完整性校验使用每批一次授权序列化、一次成员计数与 fence count/task lookup，消除原重复遍历。`tests/douyin-upload-store.test.ts` 覆盖 batch 目标漂移、超容量、跨 batch 的 READY 计数与重复 evidence。本地仅只读当前 ledger 的纯校验 benchmark，前后比较；不 load/save 真实 store。

视可执行证据修改 `src/main/douyin-upload-service.ts` 的空闲全表轮询间隔，保留连续投递；在既有 service 测试验证 pending 成片继续加入同页且 abort 不等待完整轮询周期。

### 3. Verification And Delivery

运行 typecheck、上传 domain tests、原生 CDP fixture、owned-scope Harness；按 stable candidate 风险 gate 决定唯一 required reviewer，Parent 裁决。维护本轮 indexed AOCI 对象并执行官方 Verify/Check/Guide；只提交本轮文件。运行证据保存在 `.agent/harness/runs/20261005-upload-throughput/`，不进入正式索引。没有真实平台吞吐测试，不报告速度倍数或旧批次恢复成功。

## Self-Review

当前修复不改变 frozen account/plan、schema、batch capacity、READY、永久 fence、unknown-zero-retry。短暂隐藏必须与真实 DOM 消失分开证明；历史现场不作合成根因。优化只减少重复工作，不删除源 hash 或安全验证。工程修复与真实平台效果分开交付。
