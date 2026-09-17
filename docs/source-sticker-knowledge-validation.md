# Source Sticker Knowledge Acceptance

## Status And Scope

M5 已开始，**整体验收尚未通过**。本轮在 `43fd416` 上补齐本地审计与历史提示，代码提交 `ea91fab` 位于 `main`；原 `fix/preserve-original-corner-stickers` 已在本轮开始前快进合并到 `main`。仅执行本地确定性测试、合成视频、模拟模型和真实 Electron/FFmpeg 验证，未使用真实账号或商业服务额度。实施合同见 [spec](source-sticker-knowledge-spec.md)，阶段状态见 [plan](source-sticker-knowledge-plan.md)。

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
| 17 | LOCAL_PASS | vision-connections 与 controller/desktop：角色路由、连接缺失与运行中准入；未验证真实商业模型组合 |
| 18 | LOCAL_PASS | 真实 Electron 模拟服务 smoke：首次/暖复用/修正/取消/项目切换，无新增逐条批准 |
| 19 | LOCAL_PASS | state-migrations/store：旧格式读取与 future schema 拒绝；跨机器实机未验证 |
| 20 | NOT_EVALUATED | 尚无本功能冻结同批真实素材的基线/冷/暖/刷新报告及配对人工质量记录 |
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

只读核对了仓库现有项目元数据，未修改、stage 或导入其人工坐标：氨糖膏项目含 16 条素材，已存手动展示文字为 `19.9元2支`；蝴蝶贴项目含 15 条素材，已存文字为 `19.9元30贴`。分别抽查前 3 个源路径存在，但尚未冻结 SHA、检查全部源可用性或给场景贴标签；不能把项目列表当成已验收的代表性测试集。马油及无贴纸、短视频、不同宽高比、VFR 等覆盖仍须补齐。

真实调用前必须确定：素材范围及展示文字、三个角色的连接/模型、总调用预算和输出位置。旧验证报告的服务配置与授权不自动沿用，不读取或复制真实凭据来启动测试。建议先对少量已存在蝴蝶贴素材做隔离 pilot，保留源视频完整时长，新增层先用前 3 秒模式；pilot 不替代全程及完整场景矩阵。

公平比较须冻结同一份源 SHA、手动文字、资产、输出和角色配置，分别运行无持久知识基线、冷、暖、主动刷新；覆盖开/关分开记录。现有 integration 同时改变文字/filter/cover 和版本数量，只证明功能，不作为成本或画面改善证据。不得导入既有 manual/assisted 坐标，也不得把当前代码加一个跳过知识的旁路当成旧基线。

真实报告必须保留运行身份、代码版本、知识修订、每阶段实际调用与失败、检查帧数、可播放输出和 source/output 配对证据；漏贴纸、误认商品/字幕、重复/缺角、漏盖/误盖、误拒绝、人工介入和成功率分别记录。无人完整观看、无对应场景或无真实调用时仍写 `NOT_EVALUATED`，不填零分或通过。

## Next Checkpoint

本地缺口修复 checkpoint 后，按已同意的 3 条蝴蝶贴及项目已存展示文字 `19.9元30贴` 准备隔离 pilot；仍须确定创作/识别/主管的连接与模型、总调用预算和输出位置，再冻结实际输入并开始真实服务。当前不能将 M5 或整个功能标为验收完成；Windows 实机和人工完整播放仍未验证。
