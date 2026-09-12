export const BUNDLED_STICKERS = [
  { id: "local-limited-discount", label: "限时折扣", fileName: "limited-discount.png", mimeType: "image/png", animated: false, sha256: "6bc65ed940c8a516eb15b7d270786a5859dc516a5ee4696cc2bc63a3251de19a" },
  { id: "local-limited-special", label: "限时特价斜标", fileName: "limited-special.png", mimeType: "image/png", animated: false, sha256: "607a87a134053afca188e9ed9ffd259c69ca5bb93dc4c12e2fe7bfae014eabe5" },
  { id: "local-limited-flash-sale", label: "限时秒杀", fileName: "limited-flash-sale.png", mimeType: "image/png", animated: false, sha256: "7dfde1aae4a5762432616dce0446b08e0f4ed2a3ede275de69f6ebe3f5e13270" },
  { id: "local-hot-sale-flame", label: "HOT SALE 火焰", fileName: "hot-sale-flame.png", mimeType: "image/png", animated: false, sha256: "bd232d61668b3cf9686c2c0e4f86181b55f2842370ed11404319f80fe2e45553" },
  { id: "local-hot-flame", label: "HOT 火焰", fileName: "hot-flame.png", mimeType: "image/png", animated: false, sha256: "e8bc50ffa514cedda70cee4ed7407f1201e06b9e4cccbea95752392d6d6b97df" },
  { id: "local-limited-seckill-go", label: "限时秒杀 GO", fileName: "limited-seckill-go.png", mimeType: "image/png", animated: false, sha256: "77d956dd13e7ce05fe88bbe60c91cbd1d3cad1c44986467b308351a0498e36fc" },
  { id: "local-special-recommendation", label: "特别推荐", fileName: "special-recommendation.png", mimeType: "image/png", animated: false, sha256: "26c0c990f718ab2cf3238c2f584104aae20812711e4cea25626ff22b30b1da2a" },
  { id: "local-super-value-special-price", label: "超值特价", fileName: "super-value-special-price.png", mimeType: "image/png", animated: false, sha256: "0d6815a4779228ba5f733965c3128d1f5606563b0e081af044b0ee0caa9368ab" },
  { id: "local-buy-buy-buy", label: "买买买", fileName: "buy-buy-buy.png", mimeType: "image/png", animated: false, sha256: "ce199f5d003830b2e45929b3d2cd7eeccdc66315a25ce9981612b22e5f796233" },
  { id: "local-hot-sale-english", label: "HOT SALE", fileName: "hot-sale-english.png", mimeType: "image/png", animated: false, sha256: "dd613207e9900a7304709581ae36664cba342ac1a81548f1cefc590f7ed2facf" },
  { id: "local-black-red-promo-brush", label: "黑红促销笔刷", fileName: "black-red-promo-brush.png", mimeType: "image/png", animated: false, sha256: "26f642e45540c89660c51abd16e8da7edd7f3fed531bca701ae588a6e33d8eb2" },
  { id: "local-commerce-label-collection", label: "促销标签合集", fileName: "commerce-label-collection.png", mimeType: "image/png", animated: false, sha256: "06a255428ab154ac1f9ec566a1e7a569d38157816f1af7afe3e966860d0df576" },
  { id: "local-hot-selling", label: "热卖中", fileName: "hot-selling.png", mimeType: "image/png", animated: false, sha256: "be0af8a9f0417827ab0546dd68dab8b4da15ed668cc8f4a10f13c413701e06ef" },
  { id: "local-panic-buying-time", label: "抢购时间", fileName: "panic-buying-time.png", mimeType: "image/png", animated: false, sha256: "7436eda7a0a452bfe1804b18a372b65c15dce1c9412960af615d69b0066384b6" },
  { id: "local-limited-seckill-square", label: "限量秒杀", fileName: "limited-seckill-square.png", mimeType: "image/png", animated: false, sha256: "6a6cf3052d6d5f0e5b4e4c0ed0577b7484b92115f61b250f30d93ff754065eae" },
  { id: "local-click-mini-cart", label: "点击小黄车（动效）", fileName: "click-mini-cart.gif", mimeType: "image/gif", animated: true, sha256: "316c848fdddcae58e9cd79972f8296b5c14943d0f29ee98a514cd23daed8f8fa" },
  { id: "local-princess-order", label: "公主请下单（动效）", fileName: "princess-order.gif", mimeType: "image/gif", animated: true, sha256: "5fe3d6ef9c55a30f9f9358d9dbf27532a18ea7d15dab8d087fa62a46cdab7f97" },
  { id: "local-click-order-arrow", label: "点击下单箭头（动效）", fileName: "click-order-arrow.gif", mimeType: "image/gif", animated: true, sha256: "c8251c5f17ba96b5cc6c7d85db7455da39f7d891084f6d91e1eaec05079aada7" },
] as const;

export type BundledStickerId = typeof BUNDLED_STICKERS[number]["id"];
