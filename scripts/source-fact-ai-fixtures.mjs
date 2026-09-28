// New author-only construction. Never imported by a qualification actor.
// Independent structural scenes: product still life, room/person, dashboard grid.
export const WIDTH = 224, HEIGHT = 168, FRAME_COUNT = 12;
export const GROUP_CONSTRUCTION = ["perspective-product-still-life/v1", "room-person-geometry/v1", "dashboard-chart-grid/v1"];
export const SCENARIOS = ["no-sticker", "static", "simultaneous", "single-frame", "first-frame", "last-frame", "cuts", "moving", "animated",
  "reappearance", "central", "tiny", "edge", "low-contrast", "fine-transparent-edge", "confusers", "identity-ambiguous", "semantic-ambiguous"];

export function fixtureRecipe(scenario, group, seed) {
  if (!SCENARIOS.includes(scenario) || !GROUP_CONSTRUCTION[group] || !Number.isSafeInteger(seed)) throw Error("invalid author recipe");
  const baseX = 8 + seed % 25, baseY = 20 + (seed >>> 6) % 18;
  const target = (id = "overlay-a", category = "static", x = baseX, y = baseY, width = 23, height = 23) =>
    ({ id, description: `Outlined ornamental ${id === "overlay-a" ? "badge" : id === "overlay-b" ? "diamond" : "ring"}`, category, state: "VISIBLE", bbox: { x, y, width, height } });
  const truth = ordinal => {
    if ((scenario === "identity-ambiguous" && ordinal >= 4) || (scenario === "semantic-ambiguous" && ordinal >= 4 && ordinal <= 8))
      return { state: "TRUTH_AMBIGUOUS", ambiguity: scenario === "identity-ambiguous" ? "identity" : "sticker-category",
        reason: scenario === "identity-ambiguous" ? "A cut erases association between indistinguishable ornaments." : "The visible graphic can equally be a native scene marking or a composited overlay." };
    let targets = [];
    if (scenario === "no-sticker" || scenario === "semantic-ambiguous") targets = [];
    else if (scenario === "first-frame") targets = ordinal === 0 ? [target()] : [];
    else if (scenario === "last-frame") targets = ordinal === 11 ? [target()] : [];
    else if (scenario === "single-frame") targets = ordinal === 5 ? [target()] : [];
    else if (scenario === "reappearance") targets = [0,1,2,8,9,10].includes(ordinal) ? [target("overlay-a", "moving", 8 + ordinal * 13, 47)] : [];
    else if (scenario === "cuts") targets = [ordinal < 4 ? target() : ordinal < 8 ? target("overlay-b", "static", 88, 60) : target("overlay-c", "static", 177, 107)];
    else if (scenario === "moving") targets = [target("overlay-a", "moving", 5 + ordinal * 16, 42 + ordinal * 3)];
    else if (scenario === "animated") targets = [target("overlay-a", "animated", 83, 68, 33, 33)];
    else if (scenario === "identity-ambiguous") targets = [target("overlay-a", "static", 55, 55), { ...target("overlay-b", "static", 125, 55), description: "Second indistinguishable outlined badge" }];
    else if (ordinal >= 2 && ordinal <= 9) {
      targets = [scenario === "central" ? target("overlay-a", "static", 99, 76) : scenario === "tiny" ? target("overlay-a", "static", 107, 60, 5, 5)
        : scenario === "edge" ? target("overlay-a", "static", 201, 31) : scenario === "fine-transparent-edge" ? target("overlay-a", "static", 90, 51, 31, 31) : target()];
      if (scenario === "simultaneous") targets.push(target("overlay-b", "static", 91, 62), target("overlay-c", "static", 181, 111));
    }
    return { state: "KNOWN", targets };
  };
  const cases = [{ caseId: scenario, scenario, startOrdinal: 0, endOrdinal: 12, rationale: "New independent author construction; all ordinals bound to actual canonical decode." }];
  if (scenario === "cuts") for (const ordinal of [4,8]) cases.push({ caseId: `cut-${ordinal}`, scenario, startOrdinal: ordinal - 1, endOrdinal: ordinal + 1, rationale: "Actual adjacent background and target change." });
  if (scenario.endsWith("ambiguous")) for (const ordinal of [4,5,6]) cases.push({ caseId: `ambiguous-${ordinal}`, scenario, startOrdinal: ordinal, endOrdinal: ordinal + 1, rationale: truth(ordinal).reason });
  const render = ordinal => {
    const bytes = Buffer.alloc(WIDTH * HEIGHT * 4);
    const cut = scenario === "cuts" ? Math.floor(ordinal / 4) : scenario === "identity-ambiguous" && ordinal >= 4 ? 1 : 0;
    const pixel = (x, y, rgb, alpha = 1) => {
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
      const at = (y * WIDTH + x) * 4;
      for (let k = 0; k < 3; k++) bytes[at + k] = Math.round(bytes[at + k] * (1 - alpha) + rgb[k] * alpha);
      bytes[at + 3] = 255;
    };
    const rect = (x, y, w, h, rgb) => { for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) pixel(col, row, rgb); };
    const circle = (x, y, r, rgb) => { for (let row = y - r; row <= y + r; row++) for (let col = x - r; col <= x + r; col++) if ((col - x) ** 2 + (row - y) ** 2 <= r * r) pixel(col, row, rgb); };
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const v = 65 + ((seed + x * 3 + y * 5) % 7) + cut * 20;
      pixel(x, y, group === 0 ? [v + y / 4, v + 30, v + 42] : group === 1 ? [v + x / 5, v + 40, v + y / 5] : [v / 2, v / 2 + 8, v / 2 + 15]);
    }
    if (group === 0) {
      for (let y = 91; y < HEIGHT; y++) rect(0, y, WIDTH, 1, [90 + (y % 9), 73, 61]);
      rect(124, 44, 42, 79, [166,155,139]); rect(120, 119, 53, 6, [44,43,42]); rect(137, 61, 17, 7, [48,61,70]);
      for (let i = 0; i < 5; i++) rect(128 + i * 6, 81, 3, 11, [52,58,68]); circle(193, 126, 15, [67,88,93]);
    } else if (group === 1) {
      rect(155, 20, 49, 55, [106,142,159]); rect(178, 20, 3, 55, [204,204,185]); rect(155, 46, 49, 3, [204,204,185]);
      circle(141, 85, 13, [189,153,127]); rect(127, 99, 27, 35, [51,72,104]); rect(105, 132, 88, 4, [39,47,55]);
    } else {
      rect(0, 0, WIDTH, 15, [20,28,37]); rect(9, 4, 27, 4, [225,225,218]);
      for (let i = 0; i < 3; i++) { rect(52 + i * 53, 53, 44, 44, [82,95,109]); for (let j = 0; j < 4; j++) rect(55 + i * 53 + j * 8, 86 - j * 6, 5, 8 + j * 6, [121,157,179]); }
      rect(4, 25, 27, 119, [46,54,65]);
    }
    // Caption-like text and native product/UI marks stay confusers, without recipe labels.
    rect(57, 151, 111, 9, [23,26,29]); for (let i = 0; i < 13; i++) rect(61 + i * 8, 154, 5, 2, [231,231,220]);
    if (scenario === "semantic-ambiguous" && ordinal >= 4 && ordinal <= 8) circle(144, 83, 6, [190,185,169]);
    const draw = (t, identical = false) => {
      const { x, y, width, height } = t.bbox;
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const dx = (col + .5) / width * 2 - 1, dy = (row + .5) / height * 2 - 1, r = Math.hypot(dx, dy);
        const boundary = .57 + .27 * Math.cos(6 * Math.atan2(dy, dx));
        const inside = identical || t.id === "overlay-a" ? r < boundary : t.id === "overlay-b" ? Math.abs(dx) + Math.abs(dy) < .9 : r > .45 && r < .86;
        const fringe = scenario === "fine-transparent-edge" && Math.abs(r - boundary) < .09;
        const animated = scenario === "animated" && (ordinal % 2 ? row < 5 && col < 5 : row >= height - 5 && col >= width - 5);
        if (inside || fringe || animated) {
          const at = ((y + row) * WIDTH + x + col) * 4;
          const rgb = scenario === "low-contrast" ? [...bytes.subarray(at, at + 3)].map(c => c + 15) : r > .4 ? [245,235,196] : [227,139,44];
          pixel(x + col, y + row, rgb, fringe ? .35 : 1);
        }
      }
    };
    const current = truth(ordinal);
    if (current.state === "KNOWN") for (const t of current.targets) draw(t, scenario === "identity-ambiguous");
    if (scenario === "identity-ambiguous" && ordinal >= 4) for (const x of [61,120]) draw(target("overlay-a", "static", x, 55), true);
    return bytes;
  };
  return { truth, cases, render, construction: GROUP_CONSTRUCTION[group], seed };
}
