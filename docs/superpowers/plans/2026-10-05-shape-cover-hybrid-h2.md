# Hybrid H2 Implementation Plan

## Goal and Scope

完整解释真实M1 CANDIDATE集合，输出source-bound、session-local的HybridSemanticTargetSet供H3消费。复用H1 packet/schema/router/provider，不写Knowledge Store，不改变PRODUCT_DISABLED、旧M3、proof、mask、motion、coverage、preview、export或guard。

## Model Contract

当前真实应用catalog缺gpt-6-luna/gpt-6.1-sol，必须记录MODEL_IMAGE_CAPABILITY_UNAVAILABLE。H1原始对话session `01a10b87-61f2-7da2-ab53-4b51c798e728` 第1131行明确回答“使用当前可用的 gpt-5.6-luna / gpt-5.6-sol”；此可验证授权满足当前任务的例外，继续exact 5.6 routes。MiniMax-M3保留已验证route，仅固定两项DEVELOPMENT_COMPARISON，不进入H2 routing。

## Contracts and Owners

- `shape-cover-vision-semantic.ts`：M1完整集合、稳定空间排序、candidateSetDigest/batchPlanDigest、atomic spatial clusters和12候选/4包边界；复用packet生成、session请求及最终分区。每个候选必须为confirmed/rejected/unresolved，不出现NOT_SENT/DROPPED/TRUNCATED。
- H1 router：Luna4/Sol2/MiniMax1共享source计数；新H2 prompt version和问题摘要，全M1候选几何仅作为context，决策ID仍限定本packet；receipts增加candidate IDs。不增加client、transport retry或fallback。
- H1 schema/packet：严格crossBatchGroupingSuspected标志；full frame和crop各至少3时间点；UNKNOWN不能通过packet升级。
- development scripts：先冻结construction cases/labels与prompt，再一次真实调用。233s仅DEVELOPMENT_OBSERVATION；controlled仅CONSTRUCTION_TRUTH，不声称统计accuracy。

## Batching and Resolution

按sourceBox y/x/candidate ID稳定排序，以源画布短边12%的轴向box gap关联作proposal hint，连通cluster原子packing，简单deterministic first-fit。cluster大于3直接COMPLEX_GROUPING；atomic packing超过4包直接SEMANTIC_BATCH_LIMIT_EXCEEDED；大于12直接SEMANTIC_CANDIDATE_LIMIT_EXCEEDED。所有候选在失败结果仍UNRESOLVED。空间hint不判语义；reviewer若怀疑跨包关联，crossBatchGroupingSuspected使source unresolved，禁止静默singleton或graph merge。

每包Luna完整分类。UNKNOWN、所有指定risk、非STABLE、sameLogicalOverlay不true、多component group升Sol（最多两包）；Sol带原图片及Luna摘要，摘要不是truth。Luna explicit MOVED/DISAPPEARED/CHANGED不可被Sol覆盖；任何采用reviewer的undetectedOverlaySuspected=true使source UNSAFE并清confirmedGroups。Luna CONFIRM/Sol REJECT保留两份receipt并UNRESOLVED；Luna REJECT/Sol CONFIRM可被hard-case resolver覆盖，记录reason。false group显式partition成singleton，UNCERTAIN不接受；最终groups必须一一覆盖resolved confirmed IDs。

## Major Milestones

1. **Audit and freeze**：真实catalog/原授权证据；233s及固定controlled M1 count、boxes、areas、positions；据此冻结envelope与prompt，不读210。
2. **Semantic owner**：strict completeness、batching、routing、conflict、unresolved、安全结果和freshness；RED/GREEN定向tests覆盖candidate counts、分区和各种failure。
3. **Development evidence and delivery**：固定overlay/product/subtitle/multi等cases一次Luna、必要Sol；MiniMax两项comparison另计。fresh typecheck/H1/H2/provider regressions、owned Harness、AOCI完整机器批次及Verify/Check/Guide、Parent Risk Gate，owned commit/push/remote HEAD。

## Acceptance and Self Review

HYBRID_H2_READY要求全部候选解释、有限请求、跨包风险阻断、controlled negatives及multi grouping、UNKNOWN/disagreement/undetected fail closed、source/packet/receipt绑定、tests/Harness完成。真实Provider失败原样保留并BLOCKED，不修改prompt重跑以取得正确答案。12只基于小规模development envelope与4/12/13压力construction，不是真实素材分布统计；H3仍必须自己判断motion/mask/coverage。foreign文件不stage，共享AOCI既有dirty按授权CAS维护并单列归属阻断。
