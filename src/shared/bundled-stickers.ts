export const BUNDLED_STICKERS = [
  { id: "local-limited-discount", label: "限时折扣", fileName: "limited-discount.png", mimeType: "image/png", animated: false, sha256: "6bc65ed940c8a516eb15b7d270786a5859dc516a5ee4696cc2bc63a3251de19a" },
  { id: "local-limited-special", label: "限时特价斜标", fileName: "limited-special.png", mimeType: "image/png", animated: false, sha256: "607a87a134053afca188e9ed9ffd259c69ca5bb93dc4c12e2fe7bfae014eabe5" },
  { id: "local-limited-flash-sale", label: "限时秒杀", fileName: "limited-flash-sale.png", mimeType: "image/png", animated: false, sha256: "7dfde1aae4a5762432616dce0446b08e0f4ed2a3ede275de69f6ebe3f5e13270" },
  { id: "local-hot-sale-flame", label: "HOT SALE 火焰", fileName: "hot-sale-flame.png", mimeType: "image/png", animated: false, sha256: "bd232d61668b3cf9686c2c0e4f86181b55f2842370ed11404319f80fe2e45553" },
  { id: "local-hot-flame", label: "HOT 火焰", fileName: "hot-flame.png", mimeType: "image/png", animated: false, sha256: "e8bc50ffa514cedda70cee4ed7407f1201e06b9e4cccbea95752392d6d6b97df" },
  { id: "local-click-mini-cart", label: "点击小黄车（动效）", fileName: "click-mini-cart.gif", mimeType: "image/gif", animated: true, sha256: "316c848fdddcae58e9cd79972f8296b5c14943d0f29ee98a514cd23daed8f8fa" },
  { id: "local-princess-order", label: "公主请下单（动效）", fileName: "princess-order.gif", mimeType: "image/gif", animated: true, sha256: "5fe3d6ef9c55a30f9f9358d9dbf27532a18ea7d15dab8d087fa62a46cdab7f97" },
  { id: "local-click-order-arrow", label: "点击下单箭头（动效）", fileName: "click-order-arrow.gif", mimeType: "image/gif", animated: true, sha256: "c8251c5f17ba96b5cc6c7d85db7455da39f7d891084f6d91e1eaec05079aada7" },
] as const;

export type BundledStickerId = typeof BUNDLED_STICKERS[number]["id"];
