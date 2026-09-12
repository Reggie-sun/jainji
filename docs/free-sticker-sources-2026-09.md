# Free Sticker and Animated Overlay Sources — 2026-09

## Scope and conclusion

本清单只收录了可在未登录状态下取得、没有付款/金币门槛的来源；优先采用来源自己发布的许可页、仓库和下载页，而非素材搬运站。这里的“适合中文短视频”指：表情含义跨语言、可在剪映等编辑器中与中文文字分层，或可作为绿幕动效叠加；它**不**表示素材自带中文文案。请自行添加中文标题/字幕，避免把英文或品牌文字一起烘焙进画面。

最实用的组合是：

1. **3Dicons + 得意黑**：前者提供真正透明的高质量 3D PNG，后者负责“好物推荐、点击下单、限时优惠”等可编辑中文；最接近成品中文电商角贴。
2. **Mixkit 绿幕视频 + IconPark**：前者提供实际运动的绿幕片段，后者适合箭头、购物、提示等可改色图形。
3. **OpenMoji / Twemoji** 只在愿意保留明确署名时选用；OpenMoji 的 ShareAlike 约束更不适合后续作为内置素材包分发。

## Recommended sources

| Source | What it provides and Chinese-short-video fit | Exact free/no-login download evidence | License / usage caveat |
| --- | --- | --- | --- |
| [3Dicons](https://3dicons.co/) | 100 多种 3D 图标，每种包含多种材质和视角；`fire`、`gift`、`money-bag`、`megaphone`、`flash`、`star` 很适合小面积角贴。 | [官方 GitHub 仓库](https://github.com/realvjy/3dicons)及公开 CDN 均无需登录；实测直接取得 400×400 RGBA PNG：[火焰](https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/dynamic/color/fire-dynamic-color.png)、[礼物](https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/dynamic/color/gift-dynamic-color.png)、[钱袋](https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/dynamic/color/money-bag-dynamic-color.png)。 | 初始版本为 [CC0](https://3dicons.co/about)，可复制、编辑和分享。它不含中文，需与独立文字层组合。 |
| [得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans) | 窄、斜、带手绘美术字细节的简体中文展示字体；官方明确推荐用于电商文案和视频标题，适合给图形贴纸补上可编辑中文。 | [Releases](https://github.com/atelier-anchor/smiley-sans/releases/latest)可匿名直接下载字体包，无会员或金币。 | SIL OFL 1.1；字体字形不完全遵循大陆规范写法，重要商品信息仍需人工确认。 |
| [H2D2 Shopicons](https://github.com/H2D2-Design/h2d2-shopicons) | 专门的电商图标包，含购物、支付、收藏、星级等主题；每个图标有 Light、Regular、Bold、Filled 四套 PNG/SVG。 | [公开源码包](https://codeload.github.com/H2D2-Design/h2d2-shopicons/zip/refs/heads/master)匿名请求实测 `200`，无需登录或付款。 | Apache-2.0；更偏扁平图标，贴纸感需通过底板、描边、阴影和中文文字层补足。 |
| [Mixkit Green Screen](https://mixkit.co/free-stock-video/green-screen/) | 绿幕真人、手势、设备屏幕等可抠像视频；适合把中文气泡、提示箭头、转场反应叠在人物或画面上。页面当前列出 365 个绿幕片段。 | 官方分类页明确说所有该分类片段可免费下载、无水印；一个[具体素材页](https://mixkit.co/free-stock-video/going-down-a-curved-highway-through-a-mountain-range-41576/)在未登录页面显示 `Free Download`、HD/FHD/4K 规格及 `Mixkit Stock Video Free License`。匿名 `curl --head --location` 对分类页返回 `200`。 | 只选条目明确标为 **Free License** 的素材；Mixkit 同时存在 **Restricted License**，后者只限个人社交用途。Free License 页说明可用于商业项目且不要求署名；仍应保留素材 URL、下载日期和许可截图。|
| [Pexels Videos](https://www.pexels.com/videos/) | 大量真实视频；用 `green screen`、`particles`、`smoke`、`light` 搜索，可裁剪并抠像做动态覆盖层。适合中文内容的写实质感，不依赖语言。 | 未登录视频列表直接呈现多个 `Download` 操作。一次未登录页面检查中，`https://www.pexels.com/download/video/39301751/` 解析为直接 MP4 地址，未出现登录或支付跳转（未下载该文件）。 | [Pexels License](https://www.pexels.com/license/)允许免费使用、修改且无需署名，也明确允许社交媒体发布；禁止原样转售/再分发、暗示人物或品牌背书，且不得让可识别人像处于贬损/冒犯语境。命令行 HEAD 被站点反爬返回 `403`，所以本项的无登录证据来自页面 UI 与其下载重定向，不应把 `403` 误判为登录要求。|
| [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | Microsoft 的现代彩色 emoji，包含 3D、Color、Flat 等风格和 SVG/PNG 等资产目录；适合做“点赞、惊讶、庆祝、注意”等不含语言的高质量贴纸，再配中文文字。 | [公开源码包](https://github.com/microsoft/fluentui-emoji/archive/refs/heads/main.zip)可直接下载；匿名 HEAD 返回 `200`。仓库公开展示 `assets/` 和 `art/`。 | 仓库的 [MIT License](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE)适用于该项目；分发素材或其副本时保留版权和许可文本。不要把 Microsoft 商标、产品标识或人物含义误作品牌背书。|
| [Google Noto Emoji](https://github.com/googlefonts/noto-emoji) | 完整 Unicode 彩色 emoji，仓库提供 SVG 和 PNG；适合作为中性、跨平台的表情和物件贴纸。中文说明由剪辑层添加，避免用 emoji 替代关键中文信息。 | [公开源码包](https://github.com/googlefonts/noto-emoji/archive/refs/heads/main.zip)匿名 HEAD 返回 `200`；官方 README 明确列出 SVG/PNG 库。 | 注意目录分许可：[`svg/LICENSE`](https://github.com/googlefonts/noto-emoji/blob/main/svg/LICENSE)为 Apache-2.0；字体目录为 OFL。取用 SVG/PNG 时保留 Apache 许可/NOTICE；不要混用字体目录后仍宣称 Apache。|
| [ByteDance IconPark](https://github.com/bytedance/IconPark) | 大量可配置的线性、填充和双色 SVG 图标；尤其适合中文知识讲解的“步骤、警告、定位、数据、点赞”信息贴纸。它是静态矢量源，需要在剪辑器内加关键帧来获得动效。 | [公开源码包](https://github.com/bytedance/IconPark/archive/refs/heads/master.zip)匿名 HEAD 返回 `200`，无需账号、付款或币。 | [Apache-2.0](https://github.com/bytedance/IconPark/blob/master/LICENSE)。适合商业练习，但若重新分发源图标/改版，应一并保留许可证与必要 NOTICE。不要把它当成内置“抖音官方素材库”或使用第三方商标图标做背书。|

## Additional options with material caveats

| Source | Why it can help | Download evidence | Caveat |
| --- | --- | --- | --- |
| [OpenMoji](https://github.com/hfg-gmuend/openmoji) | 色彩鲜明、表情夸张；官方仓库提供生产可用 SVG、72 px 和 618 px PNG，适合轻松/萌系中文内容。 | [源码包](https://github.com/hfg-gmuend/openmoji/archive/refs/heads/master.zip)匿名 HEAD `200`；README 还提供单个 SVG 的公开 URL 示例。 | 图形为 [CC BY-SA 4.0](https://github.com/hfg-gmuend/openmoji/blob/master/LICENSE.txt)。必须署名；若分发改过的贴纸、模板或工程，保守做法是按同许可证处理。对商业账号/交付给客户，优先选 Apache/MIT 方案，或先做版权确认。|
| [Twemoji](https://github.com/twitter/twemoji) | 统一的扁平 emoji SVG/PNG，短视频里辨识快。 | [源码包](https://github.com/twitter/twemoji/archive/refs/heads/master.zip)匿名 HEAD `200`；官方 README 提供下载指引并列出 SVG/PNG。 | 图形为 [CC BY 4.0](https://github.com/twitter/twemoji/blob/master/LICENSE-GRAPHICS)，需署名并标注修改。最后正式发布在 2022 年，Unicode 覆盖较旧；不作为新项目首选。|
| [LottieFiles test-files](https://github.com/LottieFiles/test-files) | 真正的 Lottie JSON 动画、可直接练习导入/渲染/转码流程。 | [源码包](https://github.com/LottieFiles/test-files/archive/refs/heads/main.zip)匿名 HEAD `200`。 | `data/` 被官方声明为 CC0，但它是**渲染器测试样本**，不是高质量创意贴纸库；仅推荐作技术练习，不列入成片视觉素材首选。|

## Practical selection rules

1. 做“贴纸感”时优先 Fluent Emoji、Noto Emoji 或 IconPark 的 SVG/PNG；将中文文本独立放在编辑器文字层，避免无法修改的外语字样和低清转码。
2. 做“真正会动的覆盖层”时，先在 Mixkit/Pexels 找绿幕素材，再进行 chroma key；绿色、人物肤色边缘和压缩噪点需要逐条试听/试看，不能只凭缩略图接受。
3. 下载前逐条复核素材页的许可标签，尤其是 Mixkit 的 `Free License` 与 `Restricted License` 区别；公共库的总许可不能自动覆盖单条素材上的人像、商标、隐私或第三方权利。
4. 建立最小留档：素材页 URL、作者名（如有）、许可页 URL、下载日期、原文件名和项目中的使用镜头。此文不是法律意见。

## Excluded after verification

[Pixabay FAQ](https://pixabay.com/service/faq/)虽称 GIF/视频可免费使用，但其官方说明要求注册才能下载全分辨率照片和视频；因此不满足本次“优先无登录下载”的硬条件，未列为推荐。

## Verification record

- Date: 2026-09-12 (Asia/Hong_Kong).
- Primary-page checks: Mixkit license/category/item pages；Pexels license/video pages；各 GitHub 项目的 README、资产目录和 LICENSE。未下载任何素材。
- Command check (HTTP HEAD only, followed redirects):

  ```text
  200 codeload.github.com/realvjy/3dicons/zip/refs/heads/develop
  200 codeload.github.com/H2D2-Design/h2d2-shopicons/zip/refs/heads/master
  200 github.com/atelier-anchor/smiley-sans/releases/latest
  200 github.com/microsoft/fluentui-emoji/archive/refs/heads/main.zip
  200 github.com/googlefonts/noto-emoji/archive/refs/heads/main.zip
  200 github.com/hfg-gmuend/openmoji/archive/refs/heads/master.zip
  200 github.com/bytedance/IconPark/archive/refs/heads/master.zip
  200 github.com/twitter/twemoji/archive/refs/heads/master.zip
  200 github.com/LottieFiles/test-files/archive/refs/heads/main.zip
  200 mixkit.co/free-stock-video/
  403 www.pexels.com/videos/  (bot-facing curl response; see Pexels caveat above)
  ```

- Files inspected: repository root (no repository `AGENTS.md` present) and `docs/` filenames only. Existing `docs/video-sticker-alternatives.md` was not read or changed.
- Files changed: `docs/free-sticker-sources-2026-09.md` only.
