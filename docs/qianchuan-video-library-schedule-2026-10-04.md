# Daily Video Library Clearing

## Goal And Authority

用户明确要求在软件里设置每天 00:30 自动清空，沿用六账号并行清除授权；随后明确允许只向已有其他会话改动的 `src/main/index.ts` 添加定时接线，保留其原项目保存改动。没有系统 cron、独立浏览器删除脚本、备份视频或扩大上传权限。

## Contract And Plan

主进程 `QianchuanVideoLibrarySchedule` 独占每日触发和私有持久设置；实际清空只调用原 DouyinUploadService.clearVideoLibraries，手动与定时复用同一制作/导出/上传互斥入口。共享 Schema 严格限定 HH:mm、启用标记和当时选择的 product/expectedAdvertiserId；新增或换绑账号不自动获得定时删除授权，重新保存才改变选择。前端在原视频库清理下提供时间、启用/保存、关闭、下一次时间及上次逐账号结果。

按电脑本地时区每日运行，默认 00:30。只有软件及原 Chrome 打开才可执行，最小化可运行。启动时只安排未来时间，不补删；运行中睡眠或阻塞错过一分钟的窗口记录 SKIPPED。正在制作/导出/上传或目标不可用时记录 BLOCKED，当天不自动重试。每天在浏览器动作前 fsync 原子写入 RUNNING claim；进程重启、时钟回拨或设置变化不重放已经 claim 的日期。关软件撤销未来 timer，原服务停止并排空当前删除。

实施顺序为共享合同、每日触发持久 owner、原 main/preload 接线、前端设置、通过产品 API 启用当前六账号、检查 owned diff 并提交。Self-review：没有第二删除 owner；计划与实际账号固定绑定；系统定时仅由用户启用授权；持久未知时停止，旧上传账本与 selection fence 不变。

## Evidence And Limits

受管 Kimi 只读 mapping invocation `98006164-b220-4f43-afb0-220148fb04a2`，seal `e9665e3578a8a398d87a6851d070e4ccdeb87633b9ffb09136c965e0d1bb37ec`，deep/max/k3 route qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 记录两次 authenticated k3 请求、Docker containment 和三个限定文件完整读取，无写入/nested delegation。Parent 根据当前实际 withVideoLibraryTargets/preflight/freeze 裁决采用固定 product/advertiser，不保存临时 CDP endpoint。PARSED 不作实施验收。

真实软件公开 preload save API 已返回 enabled=true、time=00:30、六个原 advertiser、timeZone=Asia/Hong_Kong、nextRunAt=2026-10-04T16:30:00.000Z，即 2026-10-05 00:30 HKT。启用仅保存及安排 timer，没有立即删除或重新巡检已空视频库。回执在 `.agent/harness/runs/qianchuan-video-library-schedule-20261004/enabled-result.json`。

用户此前明确取消后续重复验证，故没有运行新增定时 fixture、typecheck、Harness、浏览器巡检或实施 review；fixture 记录 claim 先于删除、同日重启/回拨防重复、睡眠漏时、目标变化与生产忙碌行为，未声称通过。首次真实定时触发尚未发生，不把保存成功当作定时实际删除证明。软件退出或 Chrome 关闭后不运行，Windows 实机未评估。

Risk Gate：本次只读 mapping 已完成，未增加第二 reviewer；用户明确“不再验证”优先于旧重复审查要求。Parent 直接检查当日持久 claim、固定账号、原生产互斥和关机撤销路径，仍明确上述未执行验证限制。

## Maintenance And Delivery

每日 timer 仅在原队列恢复与上传 reconcile 成功后启动；恢复失败不会开始自动删除。定时状态不写入项目文件或上传账本。

本轮稳定源码的 AOCI maintenance 已处理当前工具签发的完整批次；最终 index.ts 接线批次 `7fe2b109708a741bb8369711895b2d451455d549c69aa7bcaab5b871a78c96ca` 返回 applied=1、remaining=0、aligned=true。其他本轮 indexed 源码已由共享维护更新到当前字节；tests 与本文按 observe 处理。没有追加官方 Verify/Check/Guide，不能据此宣称全库治理检查通过。

提交范围只包含定时 owner、共享 Schema、前端设置、preload、测试 fixture、本文以及 index.ts 本轮接线 hunks。其他会话已修改或 staged 的文件及共享索引资产保持原状；不将原项目保存 hunk 带入本次提交。
