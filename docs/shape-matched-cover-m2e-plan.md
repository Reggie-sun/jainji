# M2-E Real Static Holdout & Independent Truth Acquisition

## Goal and Accepted Boundary

Native Codex 为 primary，`superpowers:writing-plans` 保存计划。依据 [Delta Spec](shape-matched-cover-v1-simplification-spec.md) §6、[主计划](shape-matched-cover-v1-simplification-plan.md)、[record](shape-matched-cover-stationary-record.md)。完成 inventory、metadata registry、风险采样和 blind ROI truth 工具；真人标注不由 Agent 代做。

主计划明确每支持类别≥3独立来源，Spec没有要求逐帧人工 pixel truth。本轮依用户授权明确 B：冻结风险 truth set + full-range geometry + 冻结保守方法，仅声明 `ZERO_MISS_ON_FROZEN_TRUTH_SET`。不推导全6990帧 pixel 零漏；真实输出 visual acceptance 留 M4/M5。数量、零漏、unknown fail-closed、产品关闭不降低。

## File Responsibilities and Boundaries

- `scripts/shape-cover-static-holdout.py`：小型离线 metadata registry、冻结 source/method/plan/truth、审核声明和 per-source adjudication；复用 M2-D comparator。
- `scripts/shape-cover-static-truth-tool.py`：CPU original ROI 风险观测、lossless reviewer package 和离线 raster editor；不显示 candidate/support/landmarks/comparison，不自动生成 truth。
- `scripts/shape-cover-media-inventory.py`：只读 SHA/metadata、sparse dHash reuse 提示和历史 exposure 审计，不自动登记 holdout。
- 对应 Python tests、Vitest Harness bridge、policy 增量登记；现有 Spec/Plan/Stationary record 与本计划承接合同/记录。

离线 owner 不建立 source admission、knowledge revision 或产品 authority。M1/M2 extractor/M2-C geometry/M2-D comparator/guard 不改；3395px mask SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893` 不变。无 M3/renderer/placement/SAFE/NATURAL/生产接线、D2Q/full-canvas/T(f)/EMPTY/双AI语义审阅。媒体 modelRequests=0；文本工程调查不生成 truth、不构成人类审核。

## Registry and Independence

记录 source identity/SHA/长度/时长/尺寸、origin/provenance class、independenceGroupId、same raw/download/derived/overlap（true/false/UNKNOWN）、development exposure、target confirmation、truth/reviewer/usage、evidence digests。明显派生或共享原下载不能计数；UNKNOWN不计数。历史曝光按来源组传播，不能清零。inventory只能报告candidate unseen，不能自动接受independence或static类别。

similarity输出 LIKELY_SAME_SOURCE / LIKELY_DERIVED / NO_STRONG_MATCH / UNKNOWN；NO_STRONG_MATCH 不授 independence。同人物/场景是复用线索，不证明拍摄身份；suspected group不是合格来源数。当前233s只生成development package验证工具，永不成为unseen holdout。

## Bounded Truth Protocol

先冻结source/provenance/method，完整ROI时域candidate无关风险观测结束后冻结frame plan，才让reviewer开始。风险输入来自original ROI和已有冻结geometry metrics，不使用candidate pixels；全范围binding/selection evidence SHA保留。禁止根据比较结果追加/删减truth frames。

固定策略：首尾；16 temporal anchors；16个source fingerprint+策略版本seed的随机预留ordinals；original edge energy/chroma、RGB extrema/difference、background亮度、geometry offset/correlation/lost fraction极值及±1；FFmpeg scene score>0.3的完整事件清单先冻结，再选最多12个切镜事件分位点及±1（含首尾），全部visibility ambiguity上下文仍纳入。去重后的实际N由风险观测确定，**硬上限192**，不预设20帧或统计足够数；短片以实际帧数为限；不是统计全范围保证，也不声明所有切镜经人审。必须覆盖全部风险类别，超过192则SOURCE_INCOMPLETE，不裁去难帧。没有source/metrics前不能报确切N；每source冻结实际N与digest。低alpha/AA无法界定则UNKNOWN，停止资格。首版所有切镜±1超过预算的development失败保留；v2在任何unseen holdout冻结前定稿，仅修改truth采样策略，不改mask/geometry门限。

author只看original ROI、1:1/整数倍zoom、ordinal/time。required=visible fill/outline/AA/thin tips/text/可辨low-alpha贡献；background=明确无需；unknown=不能判断。未标处默认UNKNOWN，整个ROI必须有标签，边界未界定不合格。Pass B另一位独立人类看original+truth overlay，APPROVE/REQUEST_CORRECTION/UNKNOWN；不能看candidate。correction仅在freeze前，需再次QA。两人均声明未开发算法、未看candidate/comparison、未收到预期像素提示；实际签署证据digest绑定当前truth和身份。不能满足则REVIEWER_NOT_INDEPENDENT，最多development。

truth先于comparison冻结，不含candidate/method输出digest。隔离method sidecar绑定detector/extractor/geometry各method/version/config/source SHA、runtime dependencies，不放进reviewer payload。freeze后改source/truth/plan/method、错target/PTS/像素摘要、漏帧/取消全部拒绝；JSON不恢复进程内handle或authority。首次比较锁定candidate bytes及truth digest；CLI将pin留在private目录，重启或换output路径也不能换candidate修到通过，旧失败输出不可覆盖。持久metadata仅审计，不能从JSON恢复qualification接受。重建registry必须由负责人结合inventory与historical exposure核实；最终real比较还须实际来源/两位真人身份的parent callback，不能用metadata verdict代替。

## Comparison and Stop

复用M2-D像素比较核，对selected binding构造单帧range合法输入，不改变原full-range要求/REAL_MEDIA旧声明状态。M2-E另将实际review/independence与全部计划帧、完整geometry绑定，输出SOURCE_QUALIFIED / SOURCE_NOT_QUALIFIED / SOURCE_INCOMPLETE。1px miss失败，UNKNOWN exact指标null；larger candidate仅记录excess。

≥3证据充分的unseen真实static来源：冻结registry/frame plans，生成blind packages后STOP等真人。不足：HOLDOUT_INSUFFICIENT / INDEPENDENT_REAL_STATIC_SOURCE_INSUFFICIENT / REAL_STATIC_QUALIFICATION_BLOCKED_BY_HOLDOUT，报告补充材料/reviewer。M2 INCOMPLETE，M3 BLOCKED，PRODUCT_DISABLED；普通用户不承担研发truth工作。

## Verification and Budgets

controlled tests先red后green，覆盖用户22项及风险budget、blind字段、QA失效、确定性和真实FFmpeg binding。最后fresh typecheck、registry/truth/comparator、M2-C geometry、M2-A extraction、M1 discovery、activation、diff check；执行owned scope Harness code+verify，Python不替代receipt。

inventory扫描电商*/素材、repo媒体（排除依赖/构建）、private evidence；导出视频单列derived。CPU-only，sparse audit≤12缩略帧/源；风险decode单进程、ROI≤512、≤20000帧、≤300s/source、package≤64MiB/192帧，无全片RGBAspool、不安装依赖。只记录inventory/similarity/package/comparator时间和artifact size。AOCI逐项scope、稳定后Maintain与Verify/Check/Guide；foreign active完整batch不抢/不截取。无专用capture Skill，原record保存checkpoint，specific-files commit。

## Self-Review

风险采样可操作但不提供无限时域pixel proof；geometry不代替边缘truth。独立材料与真人是剩余资格证据，不以工具、测试、代码review或SHA数量补签。所有离线状态均authority=none / eligible=false。
