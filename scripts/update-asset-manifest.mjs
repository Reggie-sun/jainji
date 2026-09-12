// Explicit maintenance command, never run during application startup.
import { writeFile } from "node:fs/promises";
const fluentCommit = "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc";
async function get(url, json = true) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return json ? response.json() : response.text();
}
const tree = await get(`https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/${fluentCommit}?recursive=1`);
if (tree.truncated) throw new Error("Incomplete upstream tree");
const chinese = { Fire: "火焰 热卖", Sparkles: "闪光 星星", "Red heart": "红心 爱心", "Party popper": "礼花 庆祝", "Shopping bags": "购物袋 好物", "Shopping cart": "购物车 下单", Butterfly: "蝴蝶", "Wrapped gift": "礼物", "Thumbs up": "点赞 推荐", "Clapping hands": "鼓掌", "Glowing star": "亮星", "Hundred points": "满分", "Money bag": "钱袋 优惠", "Dollar banknote": "钞票 价格", "Check mark button": "对勾", "Collision": "爆炸 爆款", "Crown": "皇冠", "Gem stone": "宝石", "Smiling face with heart-eyes": "心动 喜欢", "Rocket": "火箭", "Megaphone": "扩音器", "Loudspeaker": "喇叭", "Ribbon": "丝带", "Bow and arrow": "弓箭", "Eyes": "眼睛 关注", "Index pointing at the viewer": "指向 你", "Backhand index pointing down": "向下 手指", "Backhand index pointing right": "向右 手指" };
const licenses = { fluent: await get(`https://raw.githubusercontent.com/microsoft/fluentui-emoji/${fluentCommit}/LICENSE`, false) };
const assets = tree.tree.filter((entry) => entry.path.includes("/3D/") && entry.path.endsWith(".png")).map((entry) => {
  const name = entry.path.split("/")[1];
  const variant = entry.path.split("/").slice(2, -2).join(" ");
  return { id: `fluent-${entry.sha}`, kind: "sticker", label: `${chinese[name] ?? name}${variant ? ` ${variant}` : ""}`, url: `https://raw.githubusercontent.com/microsoft/fluentui-emoji/${fluentCommit}/${entry.path.split("/").map(encodeURIComponent).join("/")}`, blob: entry.sha, size: entry.size, license: "fluent" };
});
// Git blob identity can be shared by aliases. Keep each cache id unique.
const unique = [...new Map(assets.map((asset) => [asset.id, asset])).values()];
unique.sort((a, b) => Number(!/[\u4e00-\u9fff]/.test(a.label)) - Number(!/[\u4e00-\u9fff]/.test(b.label)) || a.label.localeCompare(b.label));
const fontsCommit = (await get("https://api.github.com/repos/google/fonts/commits/main")).sha;
for (const [directory, family, label] of [
  ["zcoolkuaile", "ZCOOL KuaiLe", "站酷快乐体"], ["zcoolxiaowei", "ZCOOL XiaoWei", "站酷小薇体"],
  ["mashanzheng", "Ma Shan Zheng", "马善政毛笔体"], ["zcoolqingkehuangyou", "ZCOOL QingKe HuangYou", "站酷庆科黄油体"],
  ["longcang", "Long Cang", "龙藏手写体"], ["liujianmaocao", "Liu Jian Mao Cao", "刘建毛草体"],
  ["zhimangxing", "Zhi Mang Xing", "志莽行书"],
]) {
  const files = await get(`https://api.github.com/repos/google/fonts/contents/ofl/${directory}?ref=${fontsCommit}`);
  const file = files.find((entry) => entry.name.endsWith(".ttf"));
  if (!file) throw new Error(`Missing font ${directory}`);
  licenses[directory] = await get(`https://raw.githubusercontent.com/google/fonts/${fontsCommit}/ofl/${directory}/OFL.txt`, false);
  unique.push({ id: `google-${directory}`, kind: "font", label, family, url: `https://raw.githubusercontent.com/google/fonts/${fontsCommit}/${file.path.split("/").map(encodeURIComponent).join("/")}`, blob: file.sha, size: file.size, license: directory });
}
await writeFile(new URL("../src/shared/asset-manifest.json", import.meta.url), `${JSON.stringify({ sources: { fluentCommit, fontsCommit }, assets: unique, licenses }, null, 2)}\n`);
console.log(`Pinned ${unique.filter((asset) => asset.kind === "sticker").length} stickers and 7 fonts.`);
