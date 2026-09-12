import { LIBRARY_STICKERS, type LibraryAsset } from "./asset-library";

// Discovery-only allowlist. The complete manifest remains valid for saved jobs.
// Each concept has one neutral/default variant; additions require editorial review.
export const STICKER_SELECTION: ReadonlyArray<readonly [string, string, string]> = [
  ["Fire", "热卖火焰", "促销 爆款"],
  ["Shopping bags", "购物袋", "促销 好物"],
  ["Shopping cart", "购物车", "促销 下单"],
  ["Wrapped gift", "礼物", "促销 赠品"],
  ["Label", "价签", "促销 价格 优惠"],
  ["Ticket", "优惠券", "促销 券"],
  ["Money bag", "钱袋", "促销 省钱"],
  ["Coin", "硬币", "促销 省钱"],
  ["Party popper", "庆祝礼花", "促销 上新"],
  ["Confetti ball", "彩纸礼球", "促销 庆祝"],
  ["Megaphone", "扩音器", "促销 通知"],
  ["Loudspeaker", "喇叭", "促销 通知"],
  ["Hundred points", "满分", "强调 推荐"],
  ["Thumbs up", "点赞", "强调 推荐"],
  ["Clapping hands", "鼓掌", "强调 推荐"],
  ["Ok hand", "满意手势", "强调 推荐"],
  ["Check mark button", "确认勾选", "强调 重点"],
  ["Check mark", "对勾", "强调 重点"],
  ["Crown", "皇冠", "强调 精选"],
  ["Gem stone", "宝石", "强调 品质"],
  ["Light bulb", "灯泡", "强调 提示 灵感"],
  ["Eyes", "关注眼睛", "指引 看这里"],
  ["Index pointing at the viewer", "指向你", "指引 关注"],
  ["Backhand index pointing down", "向下手指", "指引 下单"],
  ["Backhand index pointing right", "向右手指", "指引 看这里"],
  ["Backhand index pointing left", "向左手指", "指引 看这里"],
  ["Backhand index pointing up", "向上手指", "指引 看这里"],
  ["Down arrow", "向下箭头", "指引 下单"],
  ["Right arrow", "向右箭头", "指引 重点"],
  ["Left arrow", "向左箭头", "指引 重点"],
  ["Up arrow", "向上箭头", "指引 重点"],
  ["Bell", "提醒铃铛", "指引 提醒"],
  ["Alarm clock", "闹钟", "指引 限时"],
  ["Stopwatch", "秒表", "指引 限时"],
  ["Hourglass not done", "沙漏", "指引 限时"],
  ["Sparkles", "闪光", "轻装饰 星星"],
  ["Star", "星星", "轻装饰"],
  ["Glowing star", "发光星星", "轻装饰"],
  ["Ribbon", "蝴蝶结", "轻装饰 礼物"],
  ["Balloon", "气球", "轻装饰 庆祝"],
  ["Butterfly", "蝴蝶", "轻装饰 蝴蝶贴"],
  ["Cherry blossom", "樱花", "轻装饰 清新"],
  ["Blossom", "小花", "轻装饰 清新"],
  ["Tulip", "郁金香", "轻装饰 清新"],
  ["Sunflower", "向日葵", "轻装饰 活力"],
  ["Four leaf clover", "四叶草", "轻装饰 清新"],
  ["Leaf fluttering in wind", "绿叶", "轻装饰 清新"],
  ["Red heart", "红色爱心", "正向情绪 喜欢 心动"],
  ["Pink heart", "粉色爱心", "正向情绪 喜欢 心动"],
  ["White heart", "白色爱心", "正向情绪 喜欢 简约"],
  ["Sparkling heart", "闪亮爱心", "正向情绪 喜欢 心动"],
  ["Heart with ribbon", "礼物爱心", "正向情绪 喜欢 赠品"],
  ["Two hearts", "双爱心", "正向情绪 喜欢 心动"],
  ["Smiling face with heart-eyes", "心动表情", "正向情绪 喜欢 推荐"],
  ["Smiling face with hearts", "幸福表情", "正向情绪 喜欢 满意"],
  ["Star-struck", "惊喜表情", "正向情绪 喜欢 推荐"],
];

export const CURATED_STICKERS: Array<LibraryAsset & { searchTerms: string }> = STICKER_SELECTION.flatMap(([name, label, keywords]) => {
  const asset = LIBRARY_STICKERS.find((candidate) => {
    const resource = decodeURIComponent(candidate.url.split("/assets/")[1] ?? "");
    return resource.startsWith(`${name}/3D/`) || resource.startsWith(`${name}/Default/3D/`);
  });
  // Missing upstream concepts are omitted, never replaced with a different sticker.
  return asset ? [{ ...asset, label, searchTerms: `${name} ${keywords}` }] : [];
});
