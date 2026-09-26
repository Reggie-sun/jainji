# Commerce Video Sticker Alternatives

## Scope

本记录只比较可补充、而非替换现有 Microsoft Fluent Emoji 的电商视频贴纸来源；未下载素材、创建账号、调用 API、购买许可或改动产品。结论仅覆盖截至 2026-09-12 可见的官方页面，单项素材页、账号计划和下单时展示的许可证仍是实际采用前的准据。

## Conclusion

Fluent 继续保留为默认离线 PNG 集：其情绪/通用购物语义适合基础提示。下列库在“价格/折扣标签、手绘箭头、轻量动态强调”上视觉匹配度更高，但没有一个在现有条件下可被称为无条件、可自由嵌入编辑器的替代品。

优先研究 **IconScout API** 作为受控的候选来源：它同时公开 `lottie`、`json`、`.lottie`、GIF、MP4 筛选/下载格式，且 API 许可明确列举 video editors 与音视频作品。其限制也最直接：素材不得脱离 Integrated Application 单独下载，且 API 取得的素材不得在自有系统缓存；这与把可下载源文件分发给编辑器用户是不同的权利问题。[API reference](https://api-docs.iconscout.com/) [API license](https://iconscout.com/legal/api-license-development-agreement)

## Candidate Comparison

| Source | 适合的非 emoji 视觉 | 官方示例 | API / format finding | Rights boundary |
| --- | --- | --- | --- | --- |
| Freepik API | 静态、可编辑的爆炸形促销/价格标签和手绘箭头，适合转成透明 PNG 后叠加。 | [Special-offer EPS label](https://www.freepik.com/premium-vector/new-product-label-promotion-label-vector-illustration-starburst-shape-sticker-with-special-offer_409983851.htm)；[hand-drawn arrows](https://www.freepik.com/free-vector/hand-drawn-arrow-collection_14903207.htm) | API 条款将 Freepik Content 放入 API Client 的能力纳入范围；公开开发文档还显示 API key、异步任务和 URL/base64 输入的 AI 端点。它们不能单独证明某一具体库存素材可由当前客户端以某格式检索或下载，需以已授权账号/API 响应复核。[API terms](https://www.freepik.com/legal/terms-of-use) [API quickstart](https://docs.freepik.com/quickstart) | 通用内容许可允许下载、使用和修改，但禁止转售、再分发或把素材/衍生物做成素材库；标为 editorial 的内容不能用于营销。免费使用的署名、订阅期内下载的无署名权利及单项 Specific License 都可能不同，不能按“Freepik 一律商用”处理。[Terms: content license](https://www.freepik.com/legal/terms-of-use) |
| IconScout API | 最贴近需求：手绘箭头、doodle、小型动态指示与促销标签可按 Lottie 或预渲染视频选择，避免 emoji 的人物/表情语气。 | [hand-drawn arrow pack](https://iconscout.com/lottie-animation-pack/hand-drawn-arrow-animation-pack_155094)；[pointing arrow](https://iconscout.com/lottie-animation/pointing-arrow-animated-icon_7225631) | `GET /v3/search` 可按 `asset=lottie`、格式与价格层筛选；下载端点消耗 credits。文档列 `json`、`lottie`、GIF、MP4；`doodle`/`sticker` 是图标和插画的 style filter，而非 Lottie 动画的承诺。[API reference](https://api-docs.iconscout.com/) | API Appendix A 允许在 Integrated Application（明确包括 video editors）及 films/videos 中使用；同时禁止将资源脱离应用下载、转售/再分发，以及在自有服务存储或缓存 API 素材。渲染进成片与把 JSON/MP4 资产交给终端用户必须分别审查。[API license](https://iconscout.com/legal/api-license-development-agreement) |
| LottieFiles Marketplace | 成套折扣、百分比、price tag、sale badge 与小型 loop 动画，比 Fluent 更适合“促销角标”的运动设计。 | [Sale or Discount pack](https://lottiefiles.com/marketplace/sale-or-discount)（列 JSON、`.lottie`、MOV、MP4）；[Sale & Offers pack](https://com.lottiefiles.com/marketplace/sale-and-offers-2)（页面称可编辑，并列 After Effects source 与 Lottie JSON） | 官方 player 支持 Lottie JSON 与 `.lottie`；这属于播放器格式能力，不等同于现有视频导出链路已能渲染它。若要用动态源文件，需另行确定播放器/逐帧预渲染、透明度、帧率与导出兼容性。[Player docs](https://developers.lottiefiles.com/docs/) | Marketplace 指引称购买者可在个人和商业项目中使用、修改，并用于网站/app/客户项目；但禁止把下载文件转让、再分发、再销售或放入转售软件/模板。平台计划条款也将 Free/Individual 的商业使用限制与 Team/Enterprise 区分；不能把所有公开动画或所有计划概括成可商用。[Marketplace guidance](https://lottiefiles.com/page/upload-guidelines) [Terms](https://lottiefiles.com/page/terms-and-conditions) |

## Adoption Boundary

1. 当前 Fluent PNG 集不移除；候选只作为经审核的“commerce accent”补充，优先选择不含品牌、人物、已标 editorial 或复杂文字的素材。
2. 对每项拟采用素材保存供应商、asset ID/URL、购买或下载日期、计划/许可快照、格式、作者署名要求和最终渲染文件的 hash；不要仅记录搜索关键词或整站许可。
3. “成片中已渲染的贴纸”与“编辑器让用户下载/导出原始 SVG、JSON、`.lottie`、GIF 或 MP4”分两条验收。后者在 IconScout API 条款下尤其需要事前书面确认，不能从 audio-visual permission 推导出来。
4. 动画资源先验证渲染路径后才进入产品：Lottie JSON/`.lottie` 不是 PNG，供应商提供 MP4/GIF 也不自动保证透明通道、质量或与既有导出器兼容。

## Unknowns

- Freepik 当前可用 API catalog、单个库存资源的下载格式、商业计划及其对终端用户下载的具体许可，未在本次无账号调查中核验。
- IconScout 的具体 API plan、应用审批、每个 Lottie 的 credit/许可状态，以及“在我们的编辑器中持久化渲染副本”是否符合实时访问/禁止存储条款，未核验。
- LottieFiles 的每个 Marketplace SKU 最终许可、素材是否含可编辑源文件、以及 Team/Enterprise 是否覆盖本项目的实际交付模式，未核验。

## Verification

调研日期：2026-09-12。已逐项查阅 Freepik、IconScout 与 LottieFiles 的官方商品页、API 文档和许可/条款页；以上链接即证据 URL。未复制创意素材，未执行下载、付费、API 调用或代码/资产变更。
