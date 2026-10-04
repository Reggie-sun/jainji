# Daily Video Library Clearing

## Goal And Authority

用户明确要求在软件里设置每天 00:30 自动清空，沿用六账号并行清除授权；随后明确允许只向已有其他会话改动的 `src/main/index.ts` 添加定时接线，保留其原项目保存改动。最新要求是到时自行启动软件执行，已授权新增系统启动接线。没有独立浏览器删除脚本、备份视频或扩大上传权限。

## Contract And Plan

主进程 `QianchuanVideoLibrarySchedule` 独占每日触发和私有持久设置；实际清空只调用原 DouyinUploadService.clearVideoLibraries，手动与定时复用同一制作/导出/上传互斥入口。共享 Schema 严格限定 HH:mm、启用标记和当时选择的 product/expectedAdvertiserId；新增或换绑账号不自动获得定时删除授权，重新保存才改变选择。前端在原视频库清理下提供时间、启用/保存、关闭、下一次时间及上次逐账号结果。

按电脑本地时区每日运行，默认 00:30。Linux 用户 systemd timer 到时启动简辑，软件已经打开则复用原实例；电脑需开机并登录桌面，原 Chrome 需打开。普通手动启动只安排未来时间，不补删；运行中睡眠或阻塞错过一分钟的窗口记录 SKIPPED。正在制作/导出/上传或目标不可用时记录 BLOCKED，当天不自动重试。每天在浏览器动作前 fsync 原子写入 RUNNING claim；进程重启、时钟回拨或设置变化不重放已经 claim 的日期。关软件撤销进程内 timer，原服务停止并排空当前删除，系统 timer 保留；软件内关闭定时清空同时停用系统 timer。

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

## System Startup Delta

2026-10-04 用户要求关闭软件后到时自行启动。原每日 owner 继续独占授权、日 claim 和清空；新增 QianchuanScheduledLaunch 只管理当前用户的 `jianji-video-library-clear.service` / `.timer`，不建立第二删除入口。安装和改时间沿用原 save；启动恢复已启用设置时同步系统任务；关闭设置仅停 timer，不强杀在途软件或 Chrome。

系统任务使用本地 OnCalendar、1 秒精度、无随机延迟、Persistent=false、WakeSystem=false、Restart=no。当前 make frontend 模式由固定 Node 启动产品 launcher：先通过 Electron single-instance 转交请求，已有实例无需另建 Vite；没有实例的 probe 在 bootstrap 前以 75 退出，再正常启动 dev launcher。启动保留原生产空闲/正常关闭规则；不会运行 make frontend 的 dev-stop，不关闭 Chrome，不清上传账本。正常后台任务启动后保留软件窗口，没有额外退出/自动保存项目策略。

时刻参数只提示原 owner，删除权限仍来自私有已保存六账号设置。系统启动时间戳需落在当天指定时刻后一分钟内，启动恢复最长 30 分钟且不得跨日；在同一串行事务中复查当前启用状态、时间、日 claim，再持久 claim 后调用原清空。普通启动、旧时间参数、迟到的系统唤醒、禁用任务或已经 claim 的日期均不补删。共享状态增添系统启动安装状态；Windows 自动启动未实现，明确提示保持软件打开。

受管只读 mapping invocation `c2cc60e0-9548-4198-b08e-b847766e2b01`，seal `f8516a2652b7ab366f261a29344c7df60c478a8f575d6b4fc05c32f15e6a8a18`，deep/max route 沿用 canonical qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。Parent 核对两次 authenticated k3 请求、Docker containment、两个 source 完整 Read 和报告；只采用启动/退出边界，未扩张 Chrome 生命周期授权。此 mapping 不是 implementation review。

实际通过产品 canonical owner load + initializeAutomaticLaunch 安装当前六账号的 00:30 系统任务，返回 automaticLaunch.enabled=true；配置回执 `.agent/harness/runs/qianchuan-scheduled-launch-20261004/installed-result.json`。安装 helper 不 start schedule 且 clear callback 固定拒绝，不能触发删除；它调用相同产品 owner，而非另一套定时/删除实现。首次安装因 WorkingDirectory 被错误加引号而失败；根据用户 systemd journal 定位并修正后重新安装成功。没有模拟启动、触发删除或运行 tests/typecheck/Harness/额外 reviewer；新增 cold-start 与错误唤醒 fixtures 未运行。真实关闭软件后的首次系统启动仍待到时观察。

Parent Risk Gate：最新用户取消额外验证/审查仍适用；保留具体限制，不把安装结果当作首次定时启动成功。沿原单实例与 claim gate 检查权限和竞争，没有凭据/任意命令入口；系统任务未擅自管理 Chrome 或其他会话项目。最终 diff 只提交本轮接线，foreign project.save 改动和其他 staged 工作保持原状。

本 delta 的 AOCI 完整机器批次 `bc57776421358f8f61ec7515d71645505f632a0e9228ba980362b1f4c7824ece` 已对五个 indexed 对象逐项提交，返回 applied=5、remaining=0、aligned=true、findings=0；scripts、tests 和本文为 observe。按用户要求未追加 Verify/Check/Guide，不宣称正式检查 PASS。共享索引/基线仍包含其他会话工作，不整文件提交。

最终收尾将启动同步与设置保存置于同一串行 owner，避免恢复期间用户保存新时间被旧 OS 配置覆盖；对应最后单对象批次 `6e3b9f0fa836697ae3d4f4df786899c27aee7be64c8287c79ddecdb615265f85` 已 applied=1、remaining=0、aligned=true。安装时刻的 OS owner 源码保持相同；没有重装或模拟触发来重复验证。
