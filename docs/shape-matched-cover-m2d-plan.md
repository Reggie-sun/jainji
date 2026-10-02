# M2-D Independent Required-Pixel Truth Qualification

## Goal and Scope

依据 [Delta Spec](shape-matched-cover-v1-simplification-spec.md)、[course-correction Plan](shape-matched-cover-v1-simplification-plan.md) 和 [Stationary record](shape-matched-cover-stationary-record.md)，唯一问题是冻结3395px mask 是否包含独立定义的全部 required target pixels。Native Codex 为 primary；`superpowers:writing-plans` 只保存本计划。

M1无预填发现、M2-A mask/RGB失败、M2-B异常重现与cause未知、M2-C限定几何development结果永久保留。不能以新分割、持久梯度、support、mask外扩或RGB阈值作为独立truth。不调整mask，不缩 `[0,6990)`，不进入M3，不启用产品。

## Truth and Comparator Contracts

独立truth需要来自已知合成alpha及精确合成映射，或独立原像素标注和实际独立审核。真实压缩视频的RGB、候选确认和几何稳定不能唯一分解半透明/抗锯齿/编码边缘贡献。没有独立证据时保留 `INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING`，三个指标为null，绝不填零。普通用户不承担逐帧描边任务；本轮仅为离线工程资格。

独立packet绑定source identity/sourceKey、target/confirmation、原ROI、完整ordinal/PTS/endPTS/RGBA SHA和完整范围。每帧truth覆盖整个核查ROI，标签0=明确非required、1=required、2=UNKNOWN；禁止在candidate bbox内截取truth。ROI边界未独立界定时仍INCOMPLETE。来源method/artifact SHA、作者/审核者及两者不同的声明保存；字符串及JSON不能证明实际独立审核，不恢复private ownership或source authority。

逐帧计算 `missedRequiredPixels = |R(f) \\ M|`、`missingRequiredFrames = count(f with R(f) \\ M nonempty)`、`excessPixels = |M \\ R(f)|`。像素总指标是全范围pixel-frame occurrences，另报unique漏失/额外坐标；不以平均值、IoU或多数帧掩盖单像素/尾帧漏失。UNKNOWN存在时exact汇总为null，已知required漏失和明确background额外像素只能单列observed下界。漏项、错绑定、非static、空target、边界未界定或未审核均不qualified。

## Ownership and Milestones

1. 新增 `scripts/shape-cover-required-pixel-truth.py`，只读冻结mask，复用M2-B `decode` 做原全范围RGBA/PTS核验；不导入detector/reconstruct/geometry作为truth。完整记录原mask摘要、每帧差集与truth字节摘要。offline comparison始终无authority；REAL_MEDIA JSON只算declared-pixel比较，不签资格。
2. 新增 `tests/shape-cover-required-pixel-truth.test.py`，以先于candidate的独立构造目标验证全包含、单像素/细尖/孔洞/尾帧漏失、bbox外漏失、额外像素、unknown、范围/源/时钟/hash错配、循环来源及伪审核声明。先运行red，再实现与green。
3. 调查可用真实truth材料。无独立材料时执行真实6990帧绑定诊断并记录具体blocker和null指标；若提供材料先核对实际来源/审核，不能仅凭packet声明升级。完成fresh Python tests/typecheck/static及activation测试、历史字节核查、AOCI对象核对和Verify/Check/Guide、final diff及限定commit。Stationary record承接结果，未完成truth明确报告。

## Budgets and Compatibility

单CPU decode；最多20000帧、ROI最长边512、wall300s、工作集512MiB、packet/artifacts各64MiB。不落全片RGBAspool、不安装依赖、不调用产品模型、不访问holdout。使用既有NumPy与应用FFmpeg。原M1/M2源码、知识/schema/admission/store、assembler/guard、渲染/queue和manual/assisted全部不改。

## Self-Review

comparator工程完成与真实truth资格分别报告。本计划允许任务在独立证据缺失的真实blocker停下，不以其他算法、模型意见、测试或另造资格框架代替truth。新脚本为既有development诊断的离线比较工具，不建立产品第二owner或改写旧receipt。
