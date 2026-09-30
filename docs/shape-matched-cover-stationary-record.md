# Stationary Shape Cover Engineering Record

## Scope and Result

2026-10-01 用户要求执行“静态贴纸 + 不移动的动画贴纸”，moving 暂不支持。依据 [Spec](shape-matched-cover-stationary-spec.md) 和 [Plan](shape-matched-cover-stationary-plan.md)，实现完整帧绑定的 `stationary-union/v1` geometry candidate 与真实本地 FFmpeg 验证。结果无 source/semantic/production authority；未接产品入口、未安装启用新功能，既有 manual/assisted 与已认可效果不变。

## Implementation

`shape-cover-stationary-envelope.ts` 只消费原 owned D2 evidence，读取请求连续范围的每个 D1 ordinal，核对 target/PTS/endPTS/RGBA SHA/固定 anchor 与 mask 字节。静态声明的可见 mask 变化、moving/unresolved、UNKNOWN、漏项、错帧、越界、取消或伪造 evidence 均 UNSAFE。动画轮廓逐帧 OR，原候选、来源、source/census 和完整 digest 保留；NOT_VISIBLE 仅是该目标声明，不是全画布 EMPTY。静态格式及知识审核 owner 不变，没有 human session 操作或虚构 review 字段。private raster 只返回副本，克隆 receipt 不恢复 ownership；64MiB receipt、D1 wall 和512×512 bitmap技术边界不限制账号费用或 token。

## Render Evidence

最终渲染证据目录：`/home/reggie/.local/state/jianji-source-fact-qualification/stationary-cover-20261001-v4`；verification、red/green和AOCI日志保留在 `stationary-cover-20261001-v3` 及同一state树的stationary-final-tests-20261001.log。CLI为 `scripts/shape-cover-stationary-diagnostic.ts`，esbuild bundle保存于同一私有state树；参数为真实背景源、现有上传目录/候选ID、新独占输出目录和应用 FFmpeg/FFprobe。v4另外保存原owner完整census.json，包含引擎指纹、解码解释和完整帧绑定，不另签census。

背景为既有真实720×1280视频的[14,17)秒，原SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`。仅为 controlled composite 构造360×640/12fps fixture，不把该降采样称为对原视频全时域识别。替换贴纸来自原 `UploadedStickers.load` 有效目录，`uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`，自带“惊爆价”内容原样使用；摆放x282/y12/w75/h54，不生成或改写文字。

| Controlled case | Frames | Union pixels | Uncovered pixels | Target-free reference diff | Audio |
| --- | ---: | ---: | ---: | ---: | --- |
| static | 36 | 922 | 0 | 0 | PCM identical |
| stationary-animation | 36 | 1162 | 0 | 0 | PCM identical |

动画三个已知轮廓为513/922/1162像素，frame5/17/29闪烁不出现，最大轮廓仅在frame35出现；相对首相位新增649像素。所有原始帧通过 canonical D1、owned evidence；两例共72帧，输出帧数与全部PTS相等，PNG往返RGBA完全一致，所需投影像素全部opaque。参考片使用相同颜色转换和overlay链，仅明确移除受控旧目标；两个成片的全部解码RGBA逐帧与参考一致。冻结PNG SHA `15d9a69c015c691dac14b7b5148634456004118a0894e4c1692453febf4e16c9`，两个covered.mp4 SHA均 `f148bd4a1f5563078e5f18d57c6c2a8848ce064dcb2f8bcdfd80c4800d4480ad`。覆盖层始终固定，不生成白底矩形。

static source SHA `0d4cfb26df5f513892c03541af03488546dbd316b9230b5d6e2cb554ee903760`，census `7dce8e305396deb6038bbbc0727bd142d314d18c9bb022e36c869584b232902c`，receipt `03ff59daa2409da3c405d6df607b13bd459e6d93923e0162112345d7a34abe27`。animation source SHA `119f0e84dd9ec29135e5ea02254ccbde5c9cb50e9a70420863bf27f328b24802`，census `10dd9bbc4a14c4df8ef4d1f086f4a3104dfe9d021a1178449efde7521b655084`，receipt `b5666e51adaeac6bbff0d046ce44efa1c4b2a6fc35e6bd4edb457b7f6e2f78f3`。完整原候选/时钟/掩码/配对图/PCM摘要见各case的envelope.json和pixel-check.json。

首轮目录 `stationary-cover-20261001` 保留：phase1/2实际轮廓相同，且参考链少一次颜色转换，出现263个不同像素，不能作为完整验收。纠正fixture与参考后v2通过；final code增加静态变化拒绝与receipt资源边界后再次真实执行v3，加入完整census留存后v4再次执行，上述摘要与结果均复现。旧结果未重写。Parent实际查看frame35原图/成片配对：受控cyan目标消失，上传星形无白矩形且人物仍可见；这是局部spot-check，**不是完整人工观看、独立自然度或原背景全部贴纸都已覆盖**。背景原有图案仍作为背景保留，fixture仅验证注入目标。

## Verification and Governance

新增测试先因缺模块失败；另静态变化负例在修复前实际resolve导致失败，修复后纳入全回归。初轮6 suite有204PASS/1既有FFmpeg时序测试5秒timeout，保留失败。串行文件/30秒技术wall重跑后时序用例通过，6 suites/207 tests中206PASS，另1个丢失发布返回用例失败；新增20项及其余5 suites全部通过。该用例错误把production首调用对应queue首调用，在双素材并发下可能选到成功素材。用可控Promise强制两阶段顺序相反，原断言仍实际失败（publication-order-red.log），随后只改测试关联为实际丢失返回的queue mediaId，重跑该用例及5个邻近production回归，6PASS/99因name filter未运行（publication-order-green.log）；99项不被本次过滤调用重新计PASS。实际错误素材仍无receipt、reentry拒绝、无新输出/queue调用，其他已成功素材仍保留幂等完成。没有修改production owner或放宽断言。最后fresh typecheck exit0，日志分别保存于私有证据树。

AOCI官方完整批次仅新增本模块：source SHA `90eb6df69f20304299fec38c4f601a93b4dde995f0a1993669ce5a1603acd2c6`；Apply1/1、remaining0，Verify/Check结构及治理aligned，Guide complete=true/next_action=none。此前191条索引内容和全部已有business source baseline条目逐项保持；机器仅新增本模块、更新aoci.code.txt自身绑定和updated_at。共享索引增量写入经用户本次明确授权，**不提交**这两个混合dirty文件。其余本轮docs/tests/script按observe范围核对，不扩大索引scope。AOCI Overview交付确认成功；Challenge字段schema未成功提交，严格完整认知未成立，仅依源码绑定执行，不宣称完整系统认知可靠。

交付末检期间另一个任务新增batch实现改动：Verify/Check exit1，Guide complete=false，四个stale对象为 `src/main/batch-production-controller.ts`、`src/main/batch-production-runtime.ts`、`src/renderer/BatchProductionPanel.tsx`、`src/shared/batch-production.ts`。本轮新模块不在missing/stale/unbaselined中，源码与已Apply基线仍一致，逐项维护已完成；全库治理此刻未对齐。保留其active工作，不领取并截断包含foreign对象的新机器批次、不越权维护它们。本轮稳定checkpoint不是全库治理完成，末检原JSON保存为delivery-verify/check/guide.json；待所属owner稳定并完成维护后才可声明全库aligned。

## Risk Gate and Ownership

Parent在上述project-native verification结束后对stable candidate判断一次：`KIMI_REVIEW_NOT_REQUIRED`。没有用户要求本snapshot的Kimi review（当前明确禁止）；新增实现没有production consumer或持久state写入路径、private诊断拒绝覆盖旧输出，故不具备重大凭据/authority/不可恢复state损坏后果。mask/motion语义未验证由固定NOT_EVALUATED和原production拒绝隔离；回归发现的测试竞态已用强制倒序red/green及相邻路径证据裁决，无重大后果加剩余工程验证缺口的组合，不再叠加native reviewer。Parent检查最终diff、来源/schema/兼容边界及实际导出证据。只读mapper为 `/root/stationary_animation_mapping`、named `code_mapper`（工程用途，非blind actor），遵守当前禁止Kimi及禁止嵌套/写入边界；actual provider/model execution identity不推断。无新provider请求，费用/token0。

稳定source SHA `90eb6df6…cd2c6`；新test `4ee0d33b…b4d6a`；既有publication-test修正 `6cc26704…be3f`；diagnostic `153e6485…fad5`；Spec `d23bbe44…6acb`；Plan `ca058057…f01a`。完整SHA、当前Git HEAD/changed paths、命令与final diff绑定在私有snapshot-manifest.json；record自身不递归声明自己的hash。只读进程核对当前human collector数量0，未启动、重启或自动填写任何human语义。

Current tree 开始于ec20c30；另一任务期间提交了Qianchuan/capacity工作，未合并或改写其历史。所有既有dirty业务路径、项目删除和未跟踪脚本均保留。只提交本slice代码/test/script/spec/plan/record及原phase/总plan的pointer；不stage共享索引或其他工作。无 dedicated worktree、reset/stash/覆盖源文件。

## Remaining Boundary

该candidate已能在**完整且正确的逐帧输入mask条件下**生成静态遮盖；没有实现合格模型从真实用户动画素材提取这些mask，也没有证明actor能判断固定位置。受控目标的mask来自已知fixture recipe，不是AI输出或新的独立holdout，不外推真实动画媒体。现有MiniMax-M3实际视觉probe NOT_QUALIFIED（位置7/8错误），GPT精确gpt-6.1-sol应用账号image条件仍缺；本轮不盲目重试、不改标准/模型、不要求OpenAI Key或额外预算材料。

M5-D2A仍INCOMPLETE，formal requests0，A/B/joint指标null/NOT_EVALUATED，authority=none/eligible=false。PRODUCT_DISABLED；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance BLOCKED。下一实际工作是有依据地修复视觉输入/能力并通过原资格门，随后合格mask/motion语义来源及另行授权的生产阶段；当前本地工程结果不授权这些阶段。
