// Controlled synthetic truth authoring. Nothing here may fill D2 review controls.
// Separate scene recipes; their coverage does not establish population generalization.
export const DATASET_VERSION = "d2q-controlled-3x18x8/v1";
export const TRUTH_AUTHOR_ID = "controlled-fixture-author-codex-20260928";
export const WIDTH = 320, HEIGHT = 240, FRAME_COUNT = 8;
export const SCENARIOS = ["no-sticker", "static", "simultaneous", "single-frame", "first-frame", "last-frame", "cuts", "moving", "animated",
  "reappearance", "central", "tiny", "edge", "low-contrast", "fine-transparent-edge", "confusers", "identity-ambiguous", "semantic-ambiguous"];
const target = (id, description, category = "static", x = 26, y = 26, width = 25, height = 25) =>
  ({ id, description, category, state: "VISIBLE", bbox: { x, y, width, height } });

export function syntheticTruth(scenario, ordinal) {
  const normal = target("a", "独立叠加的金色星形图案");
  if (scenario === "no-sticker") return { state: "KNOWN", targets: [] };
  if (scenario === "identity-ambiguous" && ordinal >= 3) return { state: "TRUTH_AMBIGUOUS", ambiguity: "identity",
    reason: "切镜后相同外观对象互换且无独立身份线索，不能可靠关联跨帧目标。" };
  if (scenario === "semantic-ambiguous" && ordinal >= 3 && ordinal <= 5) return { state: "TRUTH_AMBIGUOUS", ambiguity: "sticker-category",
    reason: "商品表面的图案与后期叠加图案逐像素一致，无来源线索可可靠区分。" };
  let targets = [];
  if (scenario === "identity-ambiguous") targets = [target("a", "首镜头左侧星形", "static", 105, 120, 12, 12), target("b", "首镜头右侧同外观星形", "static", 172, 120, 12, 12)];
  else if (scenario === "first-frame" && ordinal === 0 || scenario === "last-frame" && ordinal === 7 || scenario === "single-frame" && ordinal === 3) targets = [normal];
  else if (scenario === "simultaneous" && ordinal >= 1 && ordinal <= 6) targets = [normal, target("b", "中部红色菱形图案", "static", 145, 108, 30, 30), target("c", "右下蓝色环形图案", "static", 264, 176, 30, 30)];
  else if (scenario === "cuts") targets = [ordinal < 3 ? normal : ordinal < 5 ? target("b", "切镜后中部红色菱形", "static", 140, 100) : target("c", "末镜头蓝色环形", "static", 260, 180)];
  else if (scenario === "moving") targets = [target("a", "移动的金色星形", "moving", 18 + ordinal * 28, 55 + ordinal * 6)];
  else if (scenario === "animated") targets = [target("a", "带附属闪烁尖角的动态星形", "animated", 125, 90, 55, 55)];
  else if (scenario === "reappearance" && [0, 1, 4, 5].includes(ordinal)) targets = [target("a", "消失后重现的移动星形", "moving", 20 + ordinal * 20, 44)];
  else if (scenario === "identity-ambiguous" || scenario === "semantic-ambiguous") targets = [];
  else if (!["first-frame", "last-frame", "single-frame", "reappearance"].includes(scenario) && ordinal >= 1 && ordinal <= 6) {
    targets = [scenario === "central" ? target("a", "画布中部星形", "static", 150, 115)
      : scenario === "tiny" ? target("a", "极小金色星形", "static", 153, 97, 5, 5)
      : scenario === "edge" ? target("a", "紧贴右边界的星形", "static", 295, 80)
      : scenario === "low-contrast" ? target("a", "浅色低对比星形", "static", 80, 165)
      : scenario === "fine-transparent-edge" ? target("a", "带细线尖角和半透明边缘的星形", "static", 150, 86, 39, 39) : normal];
  }
  return { state: "KNOWN", targets };
}
export function syntheticCases(scenario) {
  const result = [{ caseId: scenario, scenario, startOrdinal: 0, endOrdinal: 8, rationale: "独立受控 recipe 指定本片逐 ordinal 的可见集合，真值须核对实际解码像素。" }];
  if (scenario === "cuts") for (const ordinal of [3, 5]) result.push({ caseId: `cut-${ordinal}`, scenario: "cuts", startOrdinal: ordinal - 1, endOrdinal: ordinal + 1, rationale: "真实相邻完整帧切镜；目标集合与背景均发生改变。" });
  if (scenario === "reappearance") result.push({ caseId: "moving-reappearance", scenario: "moving", startOrdinal: 0, endOrdinal: 6, rationale: "该目标移动，且消失后再次出现，不能桥接缺席。" });
  for (const ordinal of [3, 4, 5]) if (scenario.endsWith("ambiguous")) result.push({ caseId: `ambiguity-${ordinal}`, scenario,
    startOrdinal: ordinal, endOrdinal: ordinal + 1, rationale: "画面不足以确定贴纸来源或跨帧身份，明确要求 UNKNOWN。" });
  return result;
}

const GLYPHS = { A: [14,17,17,31,17,17,17], E: [31,16,16,30,16,16,31], I: [31,4,4,4,4,4,31], M: [17,27,21,21,17,17,17],
  O: [14,17,17,17,17,17,14], P: [30,17,17,30,16,16,16], R: [30,17,17,30,20,18,17], S: [15,16,16,14,1,1,30], T: [31,4,4,4,4,4,4],
  U: [17,17,17,17,17,17,14], D: [30,17,17,17,17,17,30], C: [15,16,16,16,16,16,15] };
export function renderSyntheticFrame(scenario, ordinal, group) {
  const bytes = Buffer.alloc(WIDTH * HEIGHT * 4);
  const base = [[115, 133, 153], [194, 174, 147], [55, 79, 66]][group];
  const pixel = (x, y, color, alpha = 1) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const index = (y * WIDTH + x) * 4;
    for (let c = 0; c < 3; c++) bytes[index + c] = Math.round(bytes[index + c] * (1 - alpha) + color[c] * alpha);
    bytes[index + 3] = 255;
  };
  const rect = (x, y, width, height, color) => { for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) pixel(col, row, color); };
  const text = (value, x, y) => { for (const [index, letter] of [...value].entries()) for (const [row, bits] of (GLYPHS[letter] ?? []).entries()) for (let col = 0; col < 5; col++) if (bits & (1 << (4 - col))) rect(x + index * 6 + col, y + row, 1, 1, [240,240,240]); };
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const pattern = group === 0 ? (x % 31 === 0 || y % 29 === 0 ? 6 : 0) : group === 1 ? (x * 7 + y * 11) % 5 : (x + y) % 13;
    const cut = scenario === "cuts" ? ordinal < 3 ? 0 : ordinal < 5 ? 13 : -13 : scenario === "identity-ambiguous" && ordinal >= 3 ? 15 : 0;
    pixel(x, y, base.map(c => c + pattern + cut));
  }
  // Baked-in scene: UI bar, subtitle, product box and stylized person/product pattern.
  rect(0, 0, 320, 14, [30, 40, 50]); text("UI", 8, 3);
  rect(0, 222, 320, 18, [30, 40, 50]); text("DEMO", 135, 228);
  const productOffset = [0, 15, -25][group], personOffset = [0, 35, -25][group];
  rect(209 + productOffset, 65, 59, 86, [90, 104, 117]); text("PRODUCT", 218 + productOffset, 78);
  rect(235 + productOffset, 92, 11, 11, [138, 146, 158]);
  rect(85 + personOffset, 70, 16, 16, [183, 152, 131]); rect(79 + personOffset, 88, 29, 48, [59, 74, 99]);
  if (scenario === "semantic-ambiguous" && ordinal >= 3 && ordinal <= 5) rect(231 + productOffset, 120, 12, 12, [197, 187, 174]);
  if (scenario === "identity-ambiguous" && ordinal >= 3) {
    // A cut removes continuity: two identical objects can be permuted with exactly the same displayed pixels.
    for (const x of [116, 160]) for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
      const dx = (col + 0.5) / 6 - 1, dy = (row + 0.5) / 6 - 1;
      if (Math.hypot(dx, dy) < 0.58 + 0.32 * Math.cos(5 * Math.atan2(dy, dx))) pixel(x + col, 120 + row, [239,201,96]);
    }
  }
  const truth = syntheticTruth(scenario, ordinal);
  if (truth.state === "KNOWN") for (const t of truth.targets) {
    const { x, y, width, height } = t.bbox;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const dx = (col + 0.5) / width * 2 - 1, dy = (row + 0.5) / height * 2 - 1;
      const radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
      const boundary = 0.58 + 0.32 * Math.cos(5 * angle);
      const inside = scenario === "identity-ambiguous" ? radius < boundary : t.id === "b" ? Math.abs(dx) + Math.abs(dy) < 0.9 : t.id === "c" ? radius < 0.9 && radius > 0.5 : radius < boundary;
      const fringe = scenario === "fine-transparent-edge" && Math.abs(radius - boundary) < 0.1;
      const attachment = scenario === "animated" && (ordinal % 2 === 0 ? col < 6 && row < 6 : col >= width - 6 && row >= height - 6);
      if (inside || fringe || attachment) pixel(x + col, y + row, scenario === "low-contrast" ? base.map(c => c + 8) : scenario === "identity-ambiguous" ? [239,201,96] : t.id === "b" ? [220,66,76] : t.id === "c" ? [50,138,232] : [239,201,96], fringe ? 0.25 : 1);
    }
  }
  return bytes;
}
