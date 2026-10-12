# VPS Integration Audit Record

## Result And Scope

2026-10-13（北京时间）继续用户“安装啊然后打通”的 B 路线。用户明确回复“结束这批，继续自动化”，授权结束予浅批次 `2ffa3b0a-0289-4441-8dfe-638dc09f21c2` 的 30 条本地上传资格。本轮通过运行中简辑的原 `DesktopApi` 完成资格归档、出口重连、定时任务重建与闲置账号浏览器关闭；没有业务源码修改。

B 路线保持本机制作、调度和账本，主体 VPS 运行 Chrome 并向千川上传。当前主体组为 `阳霞`，南京 Ubuntu VPS，2 核 / 4 GiB，SSH alias `jianji-vps-01`，固定公网出口 `175.27.166.60`。两个账号绑定如下：

| 账号 | 产品槽位 | 广告主 ID | 计划 ID |
| --- | --- | --- | --- |
| 予浅好物甄选 | `蝴蝶贴` | `1876024170199244` | `1876036593854788` |
| 安序居家 | `眼贴` | `1876294500004864` | `1878300169182218` |

## Requirement Evidence

| 要求 | 本轮核验与边界 |
| --- | --- |
| 主体 VPS 出口 | 禁代理 HTTPS 出口探测返回预期 IP；千川及抖店入口 HTTP 200；两个账号原 `reconnect-egress` 均成功。只证明核验时点，不证明全部请求的持续网络审计或平台无关联风险。 |
| 浏览器与上传在 VPS，制作在本机 | 按 [Remote Browser Contract](qianchuan-remote-browser.md) 的既有 owner；[Two-Account Live Record](qianchuan-vps-two-account-live-record.md) 已真实走原制作、远端暂存、上传和确认链。本轮重新校验该两条接收记录、冻结文件摘要及原屏障。 |
| 远程桌面与账号底栏 | Xvfb 为 2560×1440。当前 `state/desktop/accounts.json` 有两个 advertiserId，XFCE launcher 插件 23、24 各一份固定 `--desktop-focus` 入口，身份一致。账号入口由原桌面 owner 自动维护。画面清晰度仍受客户端缩放影响。 |
| 一次运行一个账号，完成后关闭再切换 | 既有 [Serial Account Record](qianchuan-vps-account-serial-record.md) 与真实双账号记录证明顺序轮转；本轮相关测试再次通过。结束资格后，经原浏览器控制 API 正常关闭两个闲置窗口，最终 SSH 核验 Chrome 主进程总数为 0。 |
| 新任务整批自动确认，历史未知不重试 | [All Entry Record](qianchuan-all-entry-upload-record.md) 的共同确认 owner 保持。当前另一个普通本机批次的 10 条持久 ACCEPTED、唯一视频 ID 和冻结文件字节重新核验通过；该证据不冒充普通入口的独立 VPS 实测。历史 READY/UNKNOWN 不重新获得确认资格。 |
| 两个真实 VPS 账号完整运行 | 前述真实记录为两个账号各 1 条、共 2 条持久 ACCEPTED。本轮只读重验，没有新增真实上传、删除平台素材或重复确认。五账号真实负载、9 条并发吞吐及平台审核仍未评估。 |

## Local Eligibility And History

30 条批次通过 `closeDouyinUploadBatch` 结束，保留所有结果。前后逐项摘要核对：6696 条任务、7187 条 intent、59 个既有结束记录和本批 30 个永久 selection fences 不变，只新增该批结束记录。本地结束不表示平台已确认；旧网页未保存草稿可能随浏览器关闭丢失。

随后结束本目标已完成的四个 ACCEPTED 测试批次的本地资格：`24b7feec-b1d2-4a7c-80c8-6037c19208a1`、`ddb0a846-840a-44b9-ac17-11d057eb878c`、`94a718fd-2db1-43c3-a286-ea92907b4447`、`10624ab7-67c7-4112-b688-81944b4b08ee`，共 11 条已接收记录。归档前后全部任务、intent、全局配置及前 60 个结束记录不变。没有将原结果改成 ACCEPTED，也没有清除屏障。其他账号历史记录保持原样。

原公开 API 要求当前载入项目与批次归属一致，核验后按保存项目加载并执行，最后恢复空工作区；未直接写账本或制造第二处置流程。

## Scheduled Task Rebinding

既有 `test制作` 任务 `0fd56d84-02b4-4064-ab02-a5b4cb522b2d` 因模型配置变化阻断。显式 `refreshModelBinding` 又因账号/连接/计划冻结绑定变化被拒绝，原任务和 lastRun 未改写。

通过 `createAutomation` 将原制作请求交给当前 canonical prepare 重新核验，先创建停用任务，再核对动作等价并通过 `configureAutomation` 停用旧任务、启用新任务：

- 新任务 `179171d5-0f2b-4a09-820b-f342eaf1b44b`，名称 `test制作（连接更新）`。
- 原 6 项制作、290 条数量、素材、用户文字、账号和选定计划不变；仍为每天 `18:08`。
- 当前 nextRunAt 为 `2026-10-13T10:08:00.000Z`，即北京时间 2026-10-13 18:08；启用且没有 configurationIssue。
- 旧任务停用，原 BLOCKED 历史和配方保留；其他定时任务不变，没有补跑或提前制作。

会员服务曾短暂返回 HTTP 403；正常 `refreshMembership` 恢复 allowed，服务 health HTTP 200，没有读取凭据或绕过会员门。保存成功只证明当前准入与绑定，未来执行仍须通过运行时门；本轮没有执行或宣称完成这 290 条。

`日常清理` 原 BLOCKED 是当时未结束 READY 批次导致的历史结果，保持原记录及既有启用计划，没有额外清理或追补。当前自动化 `running=false`，原最近普通制作状态为 finished。

## Desktop And Memory

正常关闭后，VPS 2026-10-12T18:18:55Z 核验 Chrome 主进程总数 0，MemAvailable 2876.5 MiB，已用 swap 636.0 MiB。此前两个手工打开窗口占用期间可用内存约 242 MiB；本次资源释放不证明任意单账号负载都能在 4 GiB 内稳定运行。

已部署 worker SHA-256 为 `5afe443d2e04b4c56e8056a3cc3fc0d0bba44997043d7bee2bee3810be32d776`。`bytedance` 默认 handler 仍是 `jianji-bytedance-web.desktop`，此前 [URI Handler Fix](qianchuan-vps-uri-handler-record.md) 已进入软件 owner；本轮未用临时弹窗关闭脚本替代产品修复。

## Independent Audit And Parent Decision

受管 Kimi 只读 QA invocation `ac31f8b9-8de2-4de0-9366-93f134f1ef94`，seal `9cdffe5913e82cd1b3bc3b9d63136023bf7339ba60073a2276536829b3f9bf3c`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 的 Docker containment、4 个 authenticated identity observations、完整未截断 Read 和进程退出 0 已核验；report SHA `372741776399cf0db5d0ab6e47644ec21d3c08f49ea8814587c78c198ecece95` 与原产物一致。PARSED 不作为验收结论。

Parent 对缺口裁决：dock 由当前登记和固定 launcher 绑定补证；模型运营阻断由上述等价新任务解决；普通上传以共同 owner、相关测试、当前本机接收记录及既有计划路径 VPS 真实轮转作为有界能力证据，不要求额外生产运行，也不宣称普通入口独立 VPS 实测。清理历史不重放，IP 只作时点核验，五账号真实负载和每标签页完整关闭 trace 继续未评估。

本轮没有新增业务实现候选，Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`。只读 QA 不改称最终 implementation reviewer。

## Verification And Evidence Storage

当前工作树 `npm run typecheck` 退出 0；`tests/automation-upload.test.ts`、`tests/qianchuan-remote-desktop.test.ts`、`tests/douyin-upload-closure-store.test.ts` 共 38 项通过。覆盖远端账号串行、同账号跨批次、未知确认、关闭失败、五个受控账号顺序及资格归档；受控五账号测试不代表真实五账号负载。

私有证据位于 `/home/reggie/.cache/jianji-vps-goal-audit-20261013`：资格前后摘要、原重连结果、新旧任务等价及启停结果、会员核验、原双账号与普通批次只读重验、最终桌面资源、测试报告、canonical oracle receipt 与 Parent adjudication。私有凭据、机器日志和用户媒体不进入 Git。

仓库没有专用 session-record/capture Skill，本记录承接本轮实质运行证据。只拥有该新记录，按 AOCI observe 处理，不扩大索引或改他人 staged 源码。交付使用 owned Harness 文档与官方 AOCI Verify/Check/Guide 检查及独立 receipt 复验，随后仅提交本记录、推送当前 upstream 并核对远端 HEAD。
