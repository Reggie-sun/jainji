# Source Sticker Knowledge Acceptance

## Status And Scope

M5 已开始，**整体验收尚未通过**。此前在 `43fd416` 上补齐本地审计与历史提示，代码提交 `ea91fab` 位于 `main`；原 `fix/preserve-original-corner-stickers` 已在该轮开始前快进合并到 `main`。本地测试之后，已按用户授权在 `fc94613` 上执行一条真实素材的冷/暖 pilot：冷运行出片，暖运行命中但创作候选解析失败，详见下文。本轮没有修改产品代码。实施合同见 [spec](source-sticker-knowledge-spec.md)，阶段状态见 [plan](source-sticker-knowledge-plan.md)。

测试成功不能替代真实素材语义正确性、人工全片播放或 Windows 实机验收。M1–M4 的阶段完成不代表以下剩余合同与 AC-20 已完成。

## Fresh Local Evidence

| Check | Result |
| --- | --- |
| `npm test -- --maxWorkers=2 --minWorkers=2` | 105 个文件通过、1 个文件跳过；880 项通过、2 项条件跳过 |
| `npm run build` | 通过，包含 `npm run typecheck`；3144 个贴纸文件与许可证摘要验证通过；仍有 bundle 大小提示 |
| `JIANJI_SMOKE_SCOPE=knowledge xvfb-run -a node scripts/desktop-smoke.mjs` | 通过，隔离 userData、模拟 provider、合成 testsrc、真实 IPC 与 FFmpeg |
| Smoke evidence | `/tmp/jianji-desktop-smoke-2xw51P/knowledge-smoke.json` 与同目录冷/暖/修正/失败/历史争议/项目切换截图；临时目录可能被系统清理，可按命令重跑 |

两项跳过分别为 GPU 导出能力条件和未启用的在线素材下载。没有跳过源知识合同测试。Smoke 中冷/暖/主动刷新各自的源识别相关调用为 **6 / 0 / 6**，每版仍检查新样片；暖版本的源事实修正消耗 2 次样片检查、1 次有效修订、2 次渲染。失败刷新和取消不进入新创作。上述数字仅证明模拟合同，不代表实际模型成本或识别质量。

本轮 smoke 另验证 `outcomes.json` 的 6 条终态记录（4 次已入队、1 次失败、1 次取消）；暖运行执行识别与识别主管均为 0，样片主管 1 次、创作 provider 2 次（初筛及方案）。历史争议警告在修订已被替代后仍显示，已完成状态与播放入口保留。脚本只适配新默认自动输出目录的选择控件，不修改自动目录功能。

## Acceptance Matrix

`LOCAL_PASS` 仅表示本轮执行的确定性测试有相应覆盖，不表示真实场景全面通过；`PARTIAL` 表示仍有规格或实测缺口；`NOT_EVALUATED` 表示未执行。

| AC | Local result | Evidence and remaining boundary |
| --- | --- | --- |
| 01 | LOCAL_PASS | store/session/integration：发布证据绑定修订，关闭后重开查询 |
| 02 | LOCAL_PASS | knowledge integration 与 desktop smoke：跨项目/重启复用；暖识别为 0，仍创作和样片检查 |
| 03 | LOCAL_PASS | knowledge store：同字节副本、不同字节、源变化；真实重编码素材未作质量对照 |
| 04 | LOCAL_PASS | store/session 的时域包含关系，decoration-display 与 supervisor 的真实 FFmpeg 合成边界验证 |
| 05 | LOCAL_PASS | shared schema/recognition：空目标仍需时域和证据，未知或失败不发布 |
| 06 | LOCAL_PASS | knowledge integration 新增独立暖命中换 source→720p、heart→sparkle、classic→gold 的配对用例；保持源与手动文字，知识修订不变、模板和样片摘要不同，重新检查样片；不是公平性能对照 |
| 07 | PARTIAL | knowledge/supervised-agent/source-corner-render 集成证明开关与布局机制；真实贴纸配对画面未验收 |
| 08 | LOCAL_PASS | store 不导入人工历史；assisted 集成与 refresh 入口拒绝回归 |
| 09 | LOCAL_PASS | knowledge integration/session：B 修正后 A 重建重审，保留原创作与文字 |
| 10 | LOCAL_PASS | supervisor-knowledge/supervised-preview：外观与事实分离、非法/no-op 不放行 |
| 11 | LOCAL_PASS | session/supervisor：修订传播沿用原累计预算；桌面修正状态与计数 |
| 12 | LOCAL_PASS | store CAS、独占 owner、取消/迟到、事务故障注入；非真实断电测试 |
| 13 | LOCAL_PASS | store 证据摘要/缺失/future schema/配额回归；session 未保存结果与阻断分离 |
| 14 | LOCAL_PASS | store/session：持久反证与普通服务失败分离 |
| 15 | LOCAL_PASS | refresh/controller/session 与桌面：显式绕过命中，失败不回退，无隐藏调用 |
| 16 | LOCAL_PASS | knowledge integration：GC 后按冻结模板重试、0 模型调用；store/projection/UI/smoke 验证历史争议提示、缺本地库时提示未知但不干预重试 |
| 17 | LOCAL_PASS | vision-connections 与 controller/desktop：角色路由、连接缺失与运行中准入；真实组合仅有下述有限 pilot，未验证其他组合或全面可靠性 |
| 18 | LOCAL_PASS | 真实 Electron 模拟服务 smoke：首次/暖复用/修正/取消/项目切换，无新增逐条批准 |
| 19 | LOCAL_PASS | state-migrations/store：旧格式读取与 future schema 拒绝；跨机器实机未验证 |
| 20 | PARTIAL | 已有一条真实素材冷/暖 pilot：冷出片、暖命中后创作解析失败；缺旧基线、刷新、覆盖开启、完整场景矩阵及配对人工全片质量记录 |
| 21 | LOCAL_PASS | supervisor-knowledge：有证据的事实变化与渲染 no-op 区分，不借无关微调解锁成片问题 |
| 22 | LOCAL_PASS | store/session：反证在后续失败、取消、重启后阻断；反证写失败不降为 miss |

测试 owner 均位于 `tests/`：`source-sticker-knowledge*.test.ts`、`source-sticker-recognition.test.ts`、`source-sticker-refresh.test.ts`、`supervisor-knowledge.test.ts`、`supervised-preview.test.ts` 及表中对应 integration 文件。完整命令执行上述集合，而非只挑选成功用例。

## Closed Local Gaps And Remaining Boundaries

1. **REQ-20 的终态制作审计已落地。** [共享审计合同](../src/shared/source-sticker-knowledge-audit.ts) 与现有 knowledge store 保存按 run/item 关联的终态记录；下一轮制作、跨项目与重启不覆盖前一轮。记录查找原因、采用修订/事实摘要、样片摘要引用、分角色 provider 调用次数、修订/渲染计数、耗时、失败阶段与主管动作。普通失败、取消、从未开始的取消项和未入队版本均有覆盖；模型 pass 后本地发布失败仍保留 pass 与独立失败阶段，不伪装模型拒绝。窗口反证与样片反证都记录问题标志。
2. **REQ-13 的历史提示已落地。** [只读投影](../src/main/source-sticker-knowledge-projection.ts) 将冻结任务引用关联到不可变争议事件，包括已 superseded 的旧修订；缺失或不可读显示未知。既有模板、队列和重试不改写、不依赖查询成功。历史投影缓存仅为提示，按 owner mutation epoch 失效并合并同一投影的并发读取；进度通知不累计磁盘查询。129 源引用、争议写入 marker 前失败、重启及 GC 有回归。该提示不声明实时证据健康；外部绕过 owner 篡改文件后可能直到后续 mutation/重启才更新，实际复用准入仍每次校验证据。

审计保留最新至多 1000 条终态 / 2 MiB，单条最多 64 KiB，并计入既有 store 配额；旧诊断记录可淘汰，不删除或固定保留源证据。摘要是关联信息，不是永久媒体证据。普通审计写失败清理未发布临时副本，保留旧完整日志并在本条提示未保存，不改变事实门禁或导出状态；future/corrupt 日志不覆盖。硬崩溃发生在终态写入之前可能没有该轮记录，不自动恢复付费任务；本轮没有新增崩溃事务日志或无限历史承诺。

计数口径明确为 `provider-invocations`，包含进入 provider 后的失败/取消，不等于已发送 HTTP 数、token 用量或商业费用。`previewActions` 是主管报告，不是人工判定；`quality` 始终为 `not-evaluated`。真实验收仍须在临时证据清理前另行保留授权的配对帧/可播放样片，采集实际服务调用/用量并人工标注误拒绝与画面错误。不能只用本审计日志完成 AC-20。

历史 `82539f3` 的累计规格审查曾因上述两项 P2 缺口给出 reject；本轮针对修复的 native `reviewer_xhigh` 最终独立复审为 **accept with concerns，无剩余阻断项**，不覆盖 AC-20 真实验收。审查推动修复进度查询重复 I/O、审计临时副本残留、发布失败误标模型结论、窗口反证标志遗漏，以及失败事务未使提示缓存失效的问题。reviewer 独立执行最新 audit/projection/session/store 65 项通过、typecheck/diff-check 通过；较早的 7 份 scoped suites 104 项通过。非阻断关注为上述终态写入前崩溃、计数/质量口径及外部篡改后的提示缓存滞后边界，未当作真实验收通过。

## Real-Media Preflight

pilot 前只读核对了仓库现有项目元数据，未修改、stage 或导入其人工坐标：氨糖膏项目含 16 条素材，已存手动展示文字为 `19.9元2支`；蝴蝶贴项目含 15 条素材，已存文字为 `19.9元30贴`。当时分别抽查前 3 个源路径存在，但尚未冻结 SHA、检查全部源可用性或给场景贴标签；下述 pilot 仅补齐一条源的冻结，不能把项目列表当成已验收的代表性测试集。马油及无贴纸、短视频、不同宽高比、VFR 等覆盖仍须补齐。

真实调用前必须确定：素材范围及展示文字、三个角色的连接/模型、总调用预算和输出位置。旧验证报告的服务配置与授权不自动沿用，未经当前授权不得读取或复制真实凭据来启动测试。先对少量已存在蝴蝶贴素材做隔离 pilot，保留源视频完整时长，新增层先用前 3 秒模式；pilot 不替代全程及完整场景矩阵。

公平比较须冻结同一份源 SHA、手动文字、资产、输出和角色配置，分别运行无持久知识基线、冷、暖、主动刷新；覆盖开/关分开记录。现有 integration 同时改变文字/filter/cover 和版本数量，只证明功能，不作为成本或画面改善证据。不得导入既有 manual/assisted 坐标，也不得把当前代码加一个跳过知识的旁路当成旧基线。

真实报告必须保留运行身份、代码版本、知识修订、每阶段实际调用与失败、检查帧数、可播放输出和 source/output 配对证据；漏贴纸、误认商品/字幕、重复/缺角、漏盖/误盖、误拒绝、人工介入和成功率分别记录。无人完整观看、无对应场景或无真实调用时仍写 `NOT_EVALUATED`，不填零分或通过。

## Authorized Real Pilot — 2026-09-18

用户要求实际尝试，并选择 A：ChatGPT `gpt-5.6-luna` 作为主管。先运行已同意三条蝴蝶贴素材中的第一条，冷/暖合计上限 20 次模型调用；失败后停止，没有自动重试、切换连接或继续另外两条。沿用现有生产入口及 schema，不导入项目或历史 manual/assisted 坐标，不替换任何模型响应。

隔离 Electron 使用新建 userData、项目、知识库和输出目录。仅在隔离配置中补主管选择，临时使用简辑自己的登录及 API 配置副本，未访问全局 Codex 登录。结束后已移除隔离 `codex/auth.json` 和 `connections/connections.json`，正常退出释放知识 owner；原应用和原项目未改动。选择器只指向此次授权源文件和输出目录，制作仍经过实际 IPC、模型、主管与原 FFmpeg 队列。

### Frozen Input And Evidence

- 代码：`fc94613ec0e1883bad9d98afd0f64fe01bc4c4f8`；本轮 `npm run build` 通过，含 typecheck、3144 个资产/许可证校验，原有 bundle 大小提示仍在。
- 源：`7a3cf3be8fb777e2760d8712a6050ace.mp4`，7,820,549 字节，SHA-256 `3d95c7e6efcfdf8276f7d7c07a2c5fe22fa04fe435b1796582955fcf79a6628f`；720×1280，30 fps，视频 37.133333 秒、音频 37.105011 秒。运行结束重新校验源摘要未变。
- 手动文字 `19.9元30贴`，`clean`、自动装饰、覆盖关闭、`first-3s`、720p / 原帧率 / balanced，每轮一个版本。未修改文字或提供人工框。
- 识别：现有 MiniMax-M3 / Responses；创作：ChatGPT `gpt-5.6-luna` / medium；主管：独立选择 ChatGPT `gpt-5.6-luna`、默认档位。创作与主管共用模型，不宣称跨模型质量证明。
- 资产 manifest SHA-256：`f1c901635826419b2f6c4858e5a7b03a6d5bc676913938861241a20a04caf7dc`。
- 本机证据目录：`/tmp/jianji-knowledge-real-LDDRQP`，包含 `pilot.mjs`、`report.json`、`requests.jsonl`、`verification.json`、持久知识证据、运行结束时连接页截图及 `source-sample-*` / `output-sample-*`。截图不证明结果页交互，终态以实际 IPC/审计记录为据。临时目录可能被系统清理；脚本为一次性有凭据授权的现场驱动，不是可无条件重跑的离线测试。
- 成片：该目录 `output/7a3cf3be8fb777e2760d8712a6050ace_edited.mp4`，10,458,586 字节，SHA-256 `495a4c3ee6d990aa492629a349a9ddb302a3e6ef1d572054771064a90069ba83`。

### Observed Outcomes

| Run | Source executor / recognition supervisor | Creative / preview supervisor | Result |
| --- | --- | --- | --- |
| Cold `16157046-dd5b-4906-a90f-cd252e618adf` | 2 / 2 | 2 / 1 | 样片检查 1 次、有效修订 0 次；约 125.4 秒到入队，再约 16.3 秒完成正式导出 |
| Warm `bf73a305-178a-4e90-af43-651e8873f2bd` | 0 / 0 | 1 / 0 | 命中同一知识修订；约 9.9 秒在创作初筛失败，未渲染、未新入队 |

知识修订为 `728d3135-d400-436b-83fd-c96f8fa2244a`，范围 `[0,3000)`；记录 12 个识别观察、7 对样片检查帧，26 条证据引用对应 22 个去重文件。独立校验了 manifest 的 record 摘要、全部证据摘要和字节数；暖失败后仍仅有原核查修订，没有新增候选发布或 dispute。

合计 8 次生产 provider 调用，与边界日志中的 2 次 API 请求、6 次 ChatGPT `turn/start` 一致；两个 API 请求均 HTTP 200。该上限与计数不等于 Codex 内部 HTTP 次数、token 或计费金额，本轮没有费用统计。

暖失败时应用报告：`模型返回的贴纸候选不合格：JSON 格式无效，请返回纯 JSON，不要 Markdown 或解释文字。` 当前证据没有保留该次原始模型文本，因此只能确认候选解析失败，不能断言具体是 Markdown、截断、空响应或传输层原因。没有修改解析器、放宽门槛、换模型或重试掩盖失败。暖阶段识别节省已观察到，但**暖成片质量及总成本改善未验证**。

### Output Checks And Limits

`ffprobe` 显示 H.264 / AAC、720×1280 / 30 fps，视频和音频各自时长与源一致；`ffmpeg -v error -xerror` 完整解码视频及音频退出 0。父 Agent 对照查看 1.0、2.733、3.1、20 秒源/成片：原左下贴纸保留，前两帧只补另外三角；2.733 秒新增层变淡，3.1 与 20 秒无新增层。抽样未见重复角标、缺角或把商品/字幕用新增层覆盖；这不是逐帧边界精度、音频听感或人工全片质量验收。

本小样本正式出片 1/2；暖失败属于创作候选解析，不计为主管误拒绝。未提供人工坐标、人工改稿或批准。漏贴纸总体比例、覆盖开启时漏盖/误盖、主管误拒绝率、完整播放、Windows、旧基线与主动刷新仍为 `NOT_EVALUATED`，不能外推可靠性或将 M5 标成完成。

本次文档和现场证据经 native `reviewer_xhigh` 独立只读复核，结论为 accept with concerns、无阻断项；其独立重验了 record/证据/输出摘要、字节数、ffprobe、完整解码与四组配对帧。已按建议限定预检历史时态与商业组合覆盖，并移除仅有现场进度观察、缺持久文件支持的细节。结论不覆盖完整 M5。

## Next Checkpoint

先定位暖运行创作候选 JSON 失败，取得可脱敏的原始响应或可靠复现，再决定是否需要修复；下一次真实调用须显式开始，不自动消耗剩余预算。之后补暖成功、刷新及其余代表性素材和覆盖开启对照。当前不能将 M5 或整个功能标为验收完成；Windows 实机和人工完整播放仍未验证。
