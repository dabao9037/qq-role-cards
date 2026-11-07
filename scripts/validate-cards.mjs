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


function checkResponseChance(cardId, a) {
  const ranges = a.responseChance?.ranges;
  if (!Array.isArray(ranges) || !ranges.length) {
    fail(cardId, 'affection.responseChance.ranges 不能为空');
    return;
  }
  const sorted = [...ranges].sort((x, y) => x.min - y.min);
  if (sorted[0].min !== 0) fail(cardId, 'replyChance 必须从 0 开始');
  if (sorted.at(-1).max !== a.max) fail(cardId, `replyChance 必须覆盖到 ${a.max}`);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (!isFiniteNumber(r.min) || !isFiniteNumber(r.max) || r.min > r.max) {
      fail(cardId, `replyChance 区间不合法：${JSON.stringify(r)}`);
      continue;
    }
    if (i > 0 && r.min !== sorted[i - 1].max + 1) {
      fail(cardId, `replyChance 区间不连续：${sorted[i - 1].max} 后是 ${r.min}`);
    }
    const hasSingle = isFiniteNumber(r.chance);
    const hasLine = isFiniteNumber(r.start) && isFiniteNumber(r.end);
    if (!hasSingle && !hasLine) fail(cardId, `replyChance 区间缺少 chance 或 start/end：${r.min}-${r.max}`);
    for (const v of [r.chance, r.start, r.end].filter(isFiniteNumber)) {
      if (v < 0 || v > 1) fail(cardId, `replyChance 概率越界：${v}`);
    }
    if (hasLine && r.start > r.end) fail(cardId, `replyChance 线性区间 start 大于 end：${r.min}-${r.max}`);
  }
}

function checkProactive(cardId, p) {
  const proactive = p.proactive;
  if (!proactive || typeof proactive !== 'object') {
    fail(cardId, 'pacing.proactive 缺失');
    return;
  }
  if (proactive.enabled !== true) fail(cardId, 'pacing.proactive.enabled 必须为 true');
  if (!isFiniteNumber(proactive.minAffection)) fail(cardId, 'pacing.proactive.minAffection 不是数字');
  if (!isFiniteNumber(proactive.skipIfUserActiveWithinMinutes) || proactive.skipIfUserActiveWithinMinutes < 0) {
    fail(cardId, 'pacing.proactive.skipIfUserActiveWithinMinutes 必须是非负数字');
  }
  if (proactive.skipIfPreviousUnanswered !== true) fail(cardId, 'pacing.proactive.skipIfPreviousUnanswered 必须为 true');
  const quiet = proactive.quietHours ?? {};
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(quiet.start) || !time.test(quiet.end)) fail(cardId, 'pacing.proactive.quietHours 时间格式必须是 HH:MM');
  const intervals = proactive.intervals;
  if (!Array.isArray(intervals) || !intervals.length) {
    fail(cardId, 'pacing.proactive.intervals 不能为空');
    return;
  }
  const sorted = [...intervals].sort((x, y) => x.min - y.min);
  if (sorted[0].min !== proactive.minAffection) {
    fail(cardId, `proactive 第一个区间必须从 minAffection=${proactive.minAffection} 开始`);
  }
  if (sorted.at(-1).max !== 100) fail(cardId, 'proactive 最后一个区间必须到 100');
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (!isFiniteNumber(r.minMinutes) || !isFiniteNumber(r.maxMinutes) || r.minMinutes < 1 || r.minMinutes > r.maxMinutes) {
      fail(cardId, `proactive 区间 ${r.min}-${r.max} 的分钟数不合法`);
    }
    if (i > 0 && r.min !== sorted[i - 1].max + 1) {
      fail(cardId, `proactive 区间不连续：${sorted[i - 1].max} 后是 ${r.min}`);
    }
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

  const humanStyleRel = card.dialogue?.humanStyle;
  if (humanStyleRel) {
    const humanStylePath = path.join(cardDir, humanStyleRel);
    if (!fs.existsSync(humanStylePath)) {
      fail(cardId, `缺少 dialogue.humanStyle 文件：${humanStyleRel}`);
    } else {
      try {
        const bank = JSON.parse(fs.readFileSync(humanStylePath, 'utf8'));
        const entries = Array.isArray(bank) ? bank : bank?.entries;
        if (!Array.isArray(entries) || !entries.length) fail(cardId, 'human-style 必须有 entries');
        for (const entry of entries) {
          if (!entry?.id) fail(cardId, 'human-style 条目的 id 不能为空');
          if (!Array.isArray(entry?.keys) || !entry.keys.length) fail(cardId, `human-style ${entry?.id} 缺少 keys`);
          if (!Array.isArray(entry?.replies) || !entry.replies.length) fail(cardId, `human-style ${entry?.id} 缺少 replies`);
        }
      } catch (error) {
        fail(cardId, `human-style.json 不是合法 JSON：${error.message}`);
      }
    }
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
    checkResponseChance(cardId, a);
    const g = a.gain ?? {};
    for (const key of ['chat', 'selfDisclosure', 'help', 'sharedEvent', 'conflict', 'boundaryViolation', 'eventMin', 'eventMax', 'dailyGainCap']) {
      if (!isFiniteNumber(g[key])) fail(cardId, `affection.gain.${key} 不是数字`);
    }
    if (isFiniteNumber(g.eventMin) && isFiniteNumber(g.eventMax) && g.eventMin > g.eventMax) {
      fail(cardId, 'affection.gain.eventMin 不能大于 eventMax');
    }
    if (isFiniteNumber(g.dailyGainCap) && g.dailyGainCap < 0) fail(cardId, 'dailyGainCap 不能为负');
    const ins = a.insult;
    if (ins !== undefined) {
      if (!ins || typeof ins !== 'object' || Array.isArray(ins)) {
        fail(cardId, 'affection.insult 必须是对象');
      } else {
        if (!isFiniteNumber(ins.penalty) || ins.penalty >= 0) fail(cardId, 'affection.insult.penalty 必须是负数');
        if (isFiniteNumber(g.eventMin) && isFiniteNumber(ins.penalty) && ins.penalty < g.eventMin) fail(cardId, 'affection.insult.penalty 不能低于 eventMin');
        const contextMin = ins.contextMin ?? ins.teaseMin;
        if (!isFiniteNumber(contextMin) || contextMin < 0 || contextMin > a.max) fail(cardId, 'affection.insult.contextMin 必须在 0..max');
        for (const key of ['severe', 'mild']) {
          if (!Array.isArray(ins[key]) || !ins[key].length || ins[key].some((item) => typeof item !== 'string' || !item.trim())) {
            fail(cardId, `affection.insult.${key} 必须是非空字符串数组`);
          }
        }
      }
    }
    const d = a.decay ?? {};
    for (const key of ['afterDays', 'perDay', 'floor']) {
      if (!isFiniteNumber(d[key]) || d[key] < 0) fail(cardId, `affection.decay.${key} 必须是非负数字`);
    }
    if (isFiniteNumber(d.floor) && isFiniteNumber(a.initial) && d.floor > a.initial) {
      warn(cardId, 'decay.floor 高于 initial，衰减不会生效');
    }
  }

  const p = card.pacing ?? {};
  checkProactive(cardId, p);
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
