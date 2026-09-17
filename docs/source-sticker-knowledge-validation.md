# Source Sticker Knowledge Acceptance

## Status And Scope

M5 已开始，**整体验收尚未通过**。本轮检查基于 `82539f3`，分支 `fix/preserve-original-corner-stickers`；仅执行本地确定性测试、合成视频、模拟模型和真实 Electron/FFmpeg 验证，未使用真实账号或商业服务额度。实施合同见 [spec](source-sticker-knowledge-spec.md)，阶段状态见 [plan](source-sticker-knowledge-plan.md)。

测试成功不能替代真实素材语义正确性、人工全片播放或 Windows 实机验收。M1–M4 的阶段完成不代表以下剩余合同与 AC-20 已完成。

## Fresh Local Evidence

| Check | Result |
| --- | --- |
| `npm test -- --maxWorkers=2 --minWorkers=2` | 102 个文件通过、1 个文件跳过；855 项通过、2 项条件跳过 |
| `npm run build` | 通过，包含 `npm run typecheck`；3144 个贴纸文件与许可证摘要验证通过；仍有 bundle 大小提示 |
| `JIANJI_SMOKE_SCOPE=knowledge xvfb-run -a node scripts/desktop-smoke.mjs` | 通过，隔离 userData、模拟 provider、合成 testsrc、真实 IPC 与 FFmpeg |
| Smoke evidence | `/tmp/jianji-desktop-smoke-XJPtF0/knowledge-smoke.json` 与同目录冷/暖/修正/失败/项目切换截图；临时目录可能被系统清理，可按命令重跑 |

两项跳过分别为 GPU 导出能力条件和未启用的在线素材下载。没有跳过源知识合同测试。Smoke 中冷/暖/主动刷新各自的源识别相关调用为 **6 / 0 / 6**，每版仍检查新样片；暖版本的源事实修正消耗 2 次样片检查、1 次有效修订、2 次渲染。失败刷新和取消不进入新创作。上述数字仅证明模拟合同，不代表实际模型成本或识别质量。

## Acceptance Matrix

`LOCAL_PASS` 仅表示本轮执行的确定性测试有相应覆盖，不表示真实场景全面通过；`PARTIAL` 表示仍有规格或实测缺口；`NOT_EVALUATED` 表示未执行。

| AC | Local result | Evidence and remaining boundary |
| --- | --- | --- |
| 01 | LOCAL_PASS | store/session/integration：发布证据绑定修订，关闭后重开查询 |
| 02 | LOCAL_PASS | knowledge integration 与 desktop smoke：跨项目/重启复用；暖识别为 0，仍创作和样片检查 |
| 03 | LOCAL_PASS | knowledge store：同字节副本、不同字节、源变化；真实重编码素材未作质量对照 |
| 04 | LOCAL_PASS | store/session 的时域包含关系，decoration-display 与 supervisor 的真实 FFmpeg 合成边界验证 |
| 05 | LOCAL_PASS | shared schema/recognition：空目标仍需时域和证据，未知或失败不发布 |
| 06 | PARTIAL | knowledge integration：文字、filter、覆盖设置改变不复用旧样片批准；尚缺独立的暖命中换输出尺寸/款式配对用例，不是公平性能对照 |
| 07 | PARTIAL | knowledge/supervised-agent/source-corner-render 集成证明开关与布局机制；真实贴纸配对画面未验收 |
| 08 | LOCAL_PASS | store 不导入人工历史；assisted 集成与 refresh 入口拒绝回归 |
| 09 | LOCAL_PASS | knowledge integration/session：B 修正后 A 重建重审，保留原创作与文字 |
| 10 | LOCAL_PASS | supervisor-knowledge/supervised-preview：外观与事实分离、非法/no-op 不放行 |
| 11 | LOCAL_PASS | session/supervisor：修订传播沿用原累计预算；桌面修正状态与计数 |
| 12 | LOCAL_PASS | store CAS、独占 owner、取消/迟到、事务故障注入；非真实断电测试 |
| 13 | LOCAL_PASS | store 证据摘要/缺失/future schema/配额回归；session 未保存结果与阻断分离 |
| 14 | LOCAL_PASS | store/session：持久反证与普通服务失败分离 |
| 15 | LOCAL_PASS | refresh/controller/session 与桌面：显式绕过命中，失败不回退，无隐藏调用 |
| 16 | PARTIAL | knowledge integration：GC 后按冻结模板重试、0 模型调用通过；REQ-13 的历史争议提示尚缺 |
| 17 | LOCAL_PASS | vision-connections 与 controller/desktop：角色路由、连接缺失与运行中准入；未验证真实商业模型组合 |
| 18 | LOCAL_PASS | 真实 Electron 模拟服务 smoke：首次/暖复用/修正/取消/项目切换，无新增逐条批准 |
| 19 | LOCAL_PASS | state-migrations/store：旧格式读取与 future schema 拒绝；跨机器实机未验证 |
| 20 | NOT_EVALUATED | 尚无本功能冻结同批真实素材的基线/冷/暖/刷新报告及配对人工质量记录 |
| 21 | LOCAL_PASS | supervisor-knowledge：有证据的事实变化与渲染 no-op 区分，不借无关微调解锁成片问题 |
| 22 | LOCAL_PASS | store/session：反证在后续失败、取消、重启后阻断；反证写失败不降为 miss |

测试 owner 均位于 `tests/`：`source-sticker-knowledge*.test.ts`、`source-sticker-recognition.test.ts`、`source-sticker-refresh.test.ts`、`supervisor-knowledge.test.ts`、`supervised-preview.test.ts` 及表中对应 integration 文件。完整命令执行上述集合，而非只挑选成功用例。

## Confirmed Contract Gaps

1. **REQ-20 的逐制作审计尚不完整。** [AgentRunner](../src/main/agent-runner.ts) 的 `run` 是内存当前运行，下一次 `start` 替换；[SourceKnowledgeProgress](../src/shared/source-sticker-knowledge.ts) 包含运行计数但不构成持久历史。[冻结模板](../src/main/domain.ts) 保存知识引用，不保存每次制作的完整命中原因、请求数、失败阶段和耗时；暖运行事实不变时不会发布新知识 revision。因此不能在下一轮或重启后追溯每一次失败、取消及暖制作。已有 smoke JSON 不能替代应用逐制作记录。修复需要有界审计保留合同，并覆盖重启、失败及未入队版本；审计不成为第二套事实或队列 owner。
2. **REQ-13 的历史受影响结果提示尚缺。** [ResultsPanel](../src/renderer/ResultsPanel.tsx) 仅从当前 `AgentRun` 投影详情，没有将历史冻结知识引用与已确认反证关联的只读提示。即使新修订已修复问题，也需识别旧冻结修订曾受反证影响，不能只看当前 head 是否仍为 disputed。原冻结重试机制正确，不能为补提示而改写模板、阻止已有任务重试、自动重做成片或让历史任务依赖知识库可用性。

上述缺口与真实模型尚未执行分别记录；不因门禁安全或单元测试通过而声称规格全部满足。

独立 native `reviewer_xhigh` 对完整规格符合性的结论为 **reject**，不是已发现复用安全门禁被绕过：两项 P2 缺口阻止整体验收。reviewer 另行执行 7 个相关文件、106 项测试全部通过，并用不写文件的内存诊断确认旧运行被替换、历史任务缺少风险提示。M4 的 scoped review accept 与本次累计规格验收 reject 的范围不同，不能相互替代。

## Real-Media Preflight

只读核对了仓库现有项目元数据，未修改、stage 或导入其人工坐标：氨糖膏项目含 16 条素材，已存手动展示文字为 `19.9元2支`；蝴蝶贴项目含 15 条素材，已存文字为 `19.9元30贴`。分别抽查前 3 个源路径存在，但尚未冻结 SHA、检查全部源可用性或给场景贴标签；不能把项目列表当成已验收的代表性测试集。马油及无贴纸、短视频、不同宽高比、VFR 等覆盖仍须补齐。

真实调用前必须确定：素材范围及展示文字、三个角色的连接/模型、总调用预算和输出位置。旧验证报告的服务配置与授权不自动沿用，不读取或复制真实凭据来启动测试。建议先对少量已存在蝴蝶贴素材做隔离 pilot，保留源视频完整时长，新增层先用前 3 秒模式；pilot 不替代全程及完整场景矩阵。

公平比较须冻结同一份源 SHA、手动文字、资产、输出和角色配置，分别运行无持久知识基线、冷、暖、主动刷新；覆盖开/关分开记录。现有 integration 同时改变文字/filter/cover 和版本数量，只证明功能，不作为成本或画面改善证据。不得导入既有 manual/assisted 坐标，也不得把当前代码加一个跳过知识的旁路当成旧基线。

真实报告必须保留运行身份、代码版本、知识修订、每阶段实际调用与失败、检查帧数、可播放输出和 source/output 配对证据；漏贴纸、误认商品/字幕、重复/缺角、漏盖/误盖、误拒绝、人工介入和成功率分别记录。无人完整观看、无对应场景或无真实调用时仍写 `NOT_EVALUATED`，不填零分或通过。

## Next Checkpoint

先收敛上述两个合同缺口及回归，再在明确的真实测试输入与调用预算内冻结 pilot。当前不能将 M5 或整个功能标为验收完成；Windows 实机和人工完整播放仍未验证。
