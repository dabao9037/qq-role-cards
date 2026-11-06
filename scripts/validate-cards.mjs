import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const cardsDir = path.join(root, 'cards');
const errors = [];
const warnings = [];

function fail(card, msg) {
  errors.push(`${card}: ${msg}`);
}

function warn(card, msg) {
  warnings.push(`${card}: ${msg}`);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v ?? ''));
}

function checkThresholds(cardId, a) {
  const { sticker, voice, photo } = a.thresholds ?? {};
  for (const [name, v] of Object.entries({ sticker, voice, photo })) {
    if (!isFiniteNumber(v)) fail(cardId, `affection.thresholds.${name} 不是数字`);
    else if (v < 0 || v > a.max) fail(cardId, `affection.thresholds.${name} 超出 0..${a.max}`);
  }
  if (isFiniteNumber(sticker) && isFiniteNumber(voice) && !(sticker < voice)) {
    fail(cardId, '阈值必须递增：sticker < voice');
  }
  if (isFiniteNumber(voice) && isFiniteNumber(photo) && !(voice < photo)) {
    fail(cardId, '阈值必须递增：voice < photo');
  }
}

function checkStages(cardId, a) {
  const stages = a.stages;
  if (!Array.isArray(stages) || !stages.length) {
    fail(cardId, 'affection.stages 不能为空');
    return;
  }
  const sorted = [...stages].sort((x, y) => x.min - y.min);
  if (sorted[0].min !== 0) fail(cardId, '第一个阶段必须从 0 开始');
  if (sorted.at(-1).max !== a.max) fail(cardId, `最后一个阶段必须到 ${a.max}`);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!isFiniteNumber(s.min) || !isFiniteNumber(s.max) || s.min > s.max) {
      fail(cardId, `阶段 ${s.id} 区间不合法`);
      continue;
    }
    if (i > 0 && s.min !== sorted[i - 1].max + 1) {
      fail(cardId, `阶段 ${s.id} 与前一个阶段之间有缝隙或重叠`);
    }
    for (const unlock of s.unlocks ?? []) {
      const threshold = a.thresholds?.[unlock];
      if (isFiniteNumber(threshold) && s.min !== threshold) {
        fail(cardId, `阶段 ${s.id} 解锁 ${unlock}，但起点 ${s.min} 不等于阈值 ${threshold}`);
      }
    }
  }
  for (const key of ['sticker', 'voice', 'photo']) {
    const threshold = a.thresholds?.[key];
    if (!isFiniteNumber(threshold)) continue;
    const stage = sorted.find((s) => (s.unlocks ?? []).includes(key));
    if (!stage) fail(cardId, `没有任何阶段解锁 ${key}`);
  }
}

function checkCard(cardDir) {
  const cardId = path.basename(cardDir);
  const cardPath = path.join(cardDir, 'card.json');
  if (!fs.existsSync(cardPath)) {
    fail(cardId, '缺少 card.json');
    return;
  }

  let card;
  try {
    card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
  } catch (error) {
    fail(cardId, `card.json 不是合法 JSON：${error.message}`);
    return;
  }

  if (card.schemaVersion !== 1) fail(cardId, 'schemaVersion 必须为 1');
  if (card.id !== cardId) fail(cardId, `id "${card.id}" 与目录名不一致`);
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(cardId)) fail(cardId, '目录 id 只能用小写字母、数字、下划线、横线');
  if (!card.name || String(card.name).length > 40) fail(cardId, 'name 不能为空且不超过 40 字');
  if (!isSemver(card.version)) fail(cardId, 'version 必须是 x.y.z');
  if (card.mode !== 'card') fail(cardId, 'mode 必须是 card');

  for (const key of ['persona', 'behavior']) {
    const rel = card[key];
    if (!rel || !fs.existsSync(path.join(cardDir, rel))) fail(cardId, `缺少 ${key} 文件：${rel}`);
  }

  const branches = card.identityBranches;
  if (!Array.isArray(branches) || !branches.length) fail(cardId, 'identityBranches 不能为空');
  else {
    const defaults = branches.filter((b) => b.default);
    if (defaults.length !== 1) fail(cardId, 'identityBranches 必须有且只有一个 default');
    const ids = new Set();
    for (const b of branches) {
      if (!b.id || ids.has(b.id)) fail(cardId, `identityBranch id 重复或为空：${b.id}`);
      ids.add(b.id);
      if (b.locked !== true) fail(cardId, `identityBranch ${b.id} 必须 locked=true`);
      if (b.default && b.locked !== true) fail(cardId, `默认身份 ${b.id} 必须锁定`);
    }
  }

  const a = card.affection;
  if (!a || typeof a !== 'object') {
    fail(cardId, '缺少 affection');
  } else {
    if (!isFiniteNumber(a.initial) || a.initial < 0 || a.initial > a.max) fail(cardId, 'affection.initial 必须在 0..max');
    if (!isFiniteNumber(a.max) || a.max <= 0) fail(cardId, 'affection.max 必须大于 0');
    if (a.manualEdit !== false) fail(cardId, 'affection.manualEdit 必须为 false');
    checkThresholds(cardId, a);
    checkStages(cardId, a);
    const g = a.gain ?? {};
    for (const key of ['chat', 'selfDisclosure', 'help', 'sharedEvent', 'conflict', 'boundaryViolation', 'eventMin', 'eventMax', 'dailyGainCap']) {
      if (!isFiniteNumber(g[key])) fail(cardId, `affection.gain.${key} 不是数字`);
    }
    if (isFiniteNumber(g.eventMin) && isFiniteNumber(g.eventMax) && g.eventMin > g.eventMax) {
      fail(cardId, 'affection.gain.eventMin 不能大于 eventMax');
    }
    if (isFiniteNumber(g.dailyGainCap) && g.dailyGainCap < 0) fail(cardId, 'dailyGainCap 不能为负');
    const d = a.decay ?? {};
    for (const key of ['afterDays', 'perDay', 'floor']) {
      if (!isFiniteNumber(d[key]) || d[key] < 0) fail(cardId, `affection.decay.${key} 必须是非负数字`);
    }
    if (isFiniteNumber(d.floor) && isFiniteNumber(a.initial) && d.floor > a.initial) {
      warn(cardId, 'decay.floor 高于 initial，衰减不会生效');
    }
  }

  const p = card.pacing ?? {};
  if (!isFiniteNumber(p.proactiveMinMinutes) || !isFiniteNumber(p.proactiveMaxMinutes)) {
    fail(cardId, 'pacing 主动间隔必须是数字');
  } else if (p.proactiveMinMinutes > p.proactiveMaxMinutes) {
    fail(cardId, 'pacing.proactiveMinMinutes 不能大于 proactiveMaxMinutes');
  }
  for (const key of ['stickerChance', 'voiceChance', 'photoChance']) {
    if (!isFiniteNumber(p[key]) || p[key] < 0 || p[key] > 1) fail(cardId, `pacing.${key} 必须在 0..1`);
  }

  const bg = card.background ?? {};
  if (bg.enabled !== true) warn(cardId, 'background.enabled 不是 true');
  if (bg.intervalMinutes !== 20) fail(cardId, 'background.intervalMinutes 必须是 20');
  if (bg.silent !== true) fail(cardId, 'background.silent 必须为 true');
  if (bg.tokenLimit !== null) fail(cardId, 'background.tokenLimit 必须为 null（不设上限）');
  if (bg.affectionChange !== 0) fail(cardId, 'background.affectionChange 必须为 0');

  if (card.assets?.portrait) {
    const portrait = path.join(cardDir, card.assets.portrait);
    if (!fs.existsSync(portrait)) warn(cardId, `形象图还没放：${card.assets.portrait}`);
  }
  for (const rel of card.assets?.gallery ?? []) {
    if (!fs.existsSync(path.join(cardDir, rel))) warn(cardId, `gallery 文件不存在：${rel}`);
  }
  for (const rel of card.voice?.samples ?? []) {
    if (!fs.existsSync(path.join(cardDir, rel))) warn(cardId, `voice 样本不存在：${rel}`);
  }
}

const dirs = fs.existsSync(cardsDir)
  ? fs.readdirSync(cardsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(cardsDir, d.name))
  : [];

if (!dirs.length) fail('cards', '没有任何角色卡');
for (const dir of dirs) checkCard(dir);

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} 个错误，${warnings.length} 个警告`);
  process.exit(1);
}
console.log(`OK ${dirs.length} 张角色卡，${warnings.length} 个警告`);
