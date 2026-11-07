const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_KEYS = Object.freeze({
  chat: 'chat',
  selfDisclosure: 'selfDisclosure',
  help: 'help',
  sharedEvent: 'sharedEvent',
  conflict: 'conflict',
  boundaryViolation: 'boundaryViolation'
});

const CAPABILITIES = Object.freeze(['sticker', 'voice', 'photo']);

// 热情程度是亲密度的表现层，不是新的数值状态：
// 同一份好感只决定“这一轮话多少、主不主动”，不写入提示词，也不让用户看见。
const DEFAULT_WARMTH = Object.freeze([
  { id: 'cold', label: '生分', min: 0, max: 19, verbosity: 1, allowQuestion: false, hint: '只回必要的字，句子短；不主动展开，也不追问对方的事。' },
  { id: 'reserved', label: '客气', min: 20, max: 39, verbosity: 2, allowQuestion: false, hint: '会接话，但话不多；说自己的事只说半句，不主动追问。' },
  { id: 'normal', label: '平常', min: 40, max: 59, verbosity: 2, allowQuestion: true, hint: '正常接话，可以问一个具体问题；不用刻意热络。' },
  { id: 'warm', label: '亲近', min: 60, max: 79, verbosity: 3, allowQuestion: true, hint: '愿意多说两句，主动接对方的话头，偶尔关心一句；不黏人。' },
  { id: 'close', label: '熟络', min: 80, max: 100, verbosity: 3, allowQuestion: true, hint: '话明显多起来，会主动分享自己的事、接住对方的情绪；仍然有分寸，不刷屏。' }
]);

function assertCard(card) {
  if (!card?.id || !card.affection?.thresholds || !Array.isArray(card.affection?.stages)) {
    throw new Error('角色卡缺少 id / affection.thresholds / affection.stages');
  }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateKey(value) {
  return iso(value).slice(0, 10);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clone(state) {
  return { ...state };
}

export function createAffectionState(card, { qq, identityId = 'ordinary', now = new Date() } = {}) {
  assertCard(card);
  if (qq === undefined || qq === null || String(qq).trim() === '') {
    throw new Error('缺少 QQ 号');
  }
  const at = iso(now);
  const initial = Number(card.affection.initial ?? 0);
  return {
    cardId: card.id,
    qq: String(qq),
    identityId,
    value: clamp(initial, 0, card.affection.max),
    lastInteractionAt: null,
    lastDecayDate: null,
    decayAppliedDays: 0,
    dailyDate: dateKey(at),
    dailyGained: 0,
    createdAt: at,
    updatedAt: at
  };
}

export function getStage(card, value) {
  assertCard(card);
  const stages = [...card.affection.stages].sort((a, b) => a.min - b.min);
  return stages.find((stage) => value >= stage.min && value <= stage.max) ?? stages.at(-1);
}

export function getUnlocks(card, value) {
  const stages = [...card.affection.stages].sort((a, b) => a.min - b.min);
  const unlocks = new Set();
  for (const stage of stages) {
    if (value < stage.min) break;
    for (const unlock of stage.unlocks ?? []) unlocks.add(unlock);
  }
  return CAPABILITIES.filter((capability) => unlocks.has(capability));
}

function warmthBands(card) {
  const configured = Array.isArray(card?.affection?.warmth)
    ? card.affection.warmth
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id ?? '').trim(),
        label: String(item.label ?? '').trim(),
        min: Number(item.min),
        max: Number(item.max),
        verbosity: Number(item.verbosity),
        allowQuestion: item.allowQuestion !== false,
        hint: String(item.hint ?? '').trim().slice(0, 300)
      }))
      .filter((item) => item.id && Number.isFinite(item.min) && Number.isFinite(item.max))
    : [];
  const source = configured.length ? configured : DEFAULT_WARMTH;
  return [...source].sort((a, b) => a.min - b.min);
}

/**
 * 亲密度对应的“热情程度”。只给表达层用，不返回数值，也不写进用户可见状态。
 */
export function getWarmth(card, value) {
  const bands = warmthBands(card);
  const score = Number.isFinite(Number(value)) ? Number(value) : Number(card?.affection?.initial ?? 20);
  const band = bands.find((item) => score <= item.max) ?? bands.at(-1) ?? DEFAULT_WARMTH[2];
  return {
    id: band.id || 'normal',
    label: band.label || '平常',
    hint: band.hint || '',
    verbosity: clamp(Math.round(Number(band.verbosity) || 2), 1, 3),
    allowQuestion: band.allowQuestion !== false
  };
}

export function canUse(card, state, capability) {
  assertCard(card);
  if (!CAPABILITIES.includes(capability)) throw new Error(`未知能力：${capability}`);
  const threshold = Number(card.affection.thresholds[capability]);
  return Number.isFinite(threshold) && state.value >= threshold;
}

function resetDaily(state, at) {
  const key = dateKey(at);
  if (state.dailyDate === key) return;
  state.dailyDate = key;
  state.dailyGained = 0;
}

export function applyEvent(card, state, eventType, { now = new Date(), amount } = {}) {
  assertCard(card);
  if (!Object.hasOwn(EVENT_KEYS, eventType)) throw new Error(`未知好感事件：${eventType}`);
  const at = iso(now);
  const next = clone(state);
  resetDaily(next, at);

  const configured = Number(card.affection.gain[EVENT_KEYS[eventType]]);
  const raw = amount === undefined ? configured : Number(amount);
  if (!Number.isFinite(raw)) throw new Error(`事件 ${eventType} 的数值无效`);

  const gain = card.affection.gain;
  const clamped = clamp(raw, Number(gain.eventMin), Number(gain.eventMax));
  let delta = clamped;

  if (delta > 0) {
    const cap = Number(gain.dailyGainCap);
    const remaining = Math.max(0, cap - next.dailyGained);
    delta = Math.min(delta, remaining);
    next.dailyGained += delta;
  }

  next.value = round2(clamp(next.value + delta, 0, Number(card.affection.max)));
  next.lastInteractionAt = at;
  next.decayAppliedDays = 0;
  next.updatedAt = at;
  return next;
}

export function applyDecay(card, state, { now = new Date() } = {}) {
  assertCard(card);
  const next = clone(state);
  if (!next.lastInteractionAt) return next;

  const at = new Date(iso(now));
  const last = new Date(next.lastInteractionAt);
  if (at.getTime() <= last.getTime()) return next;

  const daysSinceInteraction = Math.floor((at.getTime() - last.getTime()) / DAY_MS);
  const grace = Number(card.affection.decay.afterDays);
  const owedDays = Math.max(0, daysSinceInteraction - grace);
  const newDays = owedDays - Number(next.decayAppliedDays ?? 0);
  if (newDays <= 0) return next;

  const perDay = Number(card.affection.decay.perDay);
  const floor = Number(card.affection.decay.floor ?? 0);
  next.value = round2(Math.max(floor, next.value - perDay * newDays));
  next.decayAppliedDays = owedDays;
  next.lastDecayDate = dateKey(at);
  next.updatedAt = at.toISOString();
  return next;
}

export function resetAffectionState(card, { qq, identityId = 'ordinary', now = new Date() } = {}) {
  return createAffectionState(card, { qq, identityId, now });
}


export function getReplyChance(card, value) {
  assertCard(card);
  const ranges = card.affection.responseChance?.ranges;
  if (!Array.isArray(ranges) || !ranges.length) return 1;
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  const range = sorted.find((r) => value >= r.min && value <= r.max);
  if (!range) return value < sorted[0].min ? 0 : 1;
  if (Number.isFinite(range.chance)) return round2(range.chance);
  const span = Math.max(1, range.max - range.min);
  const ratio = (value - range.min) / span;
  return round2(range.start + (range.end - range.start) * ratio);
}

export function shouldReply(card, state, { random = Math.random } = {}) {
  return random() < getReplyChance(card, state.value);
}

export function getProactiveInterval(card, value) {
  const proactive = card.pacing?.proactive;
  if (!proactive?.enabled || value < proactive.minAffection) return null;
  const ranges = proactive.intervals ?? [];
  const range = [...ranges].sort((a, b) => a.min - b.min).find((r) => value >= r.min && value <= r.max);
  return range ? { minMinutes: range.minMinutes, maxMinutes: range.maxMinutes } : null;
}

function minutesInTimeZone(now, timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function isQuietHours(card, now = new Date()) {
  const quiet = card.pacing?.proactive?.quietHours;
  if (!quiet?.start || !quiet?.end) return false;
  const [startH, startM] = quiet.start.split(':').map(Number);
  const [endH, endM] = quiet.end.split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  const current = minutesInTimeZone(now, quiet.timeZone ?? 'Asia/Shanghai');
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function getProactivePlan(
  card,
  state,
  { now = new Date(), lastUserMessageAt = null, lastProactiveAt = null, lastProactiveAnswered = true, random = Math.random } = {}
) {
  const proactive = card.pacing?.proactive;
  if (!proactive?.enabled || state.value < proactive.minAffection) {
    return { eligible: false, reason: 'below-threshold' };
  }
  if (lastUserMessageAt) {
    const idleMinutes = (new Date(now).getTime() - new Date(lastUserMessageAt).getTime()) / 60000;
    if (idleMinutes < proactive.skipIfUserActiveWithinMinutes) {
      return { eligible: false, reason: 'user-active' };
    }
  }
  if (lastProactiveAt && lastProactiveAnswered === false && proactive.skipIfPreviousUnanswered) {
    return { eligible: false, reason: 'previous-unanswered' };
  }
  if (isQuietHours(card, now)) {
    return { eligible: false, reason: 'quiet-hours' };
  }
  const interval = getProactiveInterval(card, state.value);
  if (!interval) return { eligible: false, reason: 'no-interval' };
  const span = interval.maxMinutes - interval.minMinutes;
  const minutes = interval.minMinutes + Math.floor(random() * (span + 1));
  const nowMs = new Date(now).getTime();
  // 间隔基线：上次主动发出 → 上次用户说话 → 无（首次立即可排）。
  // 用用户说话做首次基线，避免刚解锁 40 就在 30 分钟没说话后立刻冒泡。
  const lastMs = lastProactiveAt
    ? new Date(lastProactiveAt).getTime()
    : (lastUserMessageAt ? new Date(lastUserMessageAt).getTime() : 0);
  // 主动间隔从基线起算；未到最早间隔一律不eligible，
  // 否则调度器每分钟扫一次会变成每分钟发一条。
  if (lastMs && Number.isFinite(lastMs) && nowMs < lastMs + minutes * 60000) {
    return {
      eligible: false,
      reason: 'not-due',
      interval,
      nextAt: new Date(lastMs + minutes * 60000).toISOString()
    };
  }
  return {
    eligible: true,
    interval,
    nextAt: new Date(nowMs + minutes * 60000).toISOString()
  };
}
/**
 * 给模型看的摘要：只有阶段和允许的能力，不含数值，避免用户套话。
 */
export function toPromptSummary(card, state) {
  const stage = getStage(card, state.value);
  const allowed = CAPABILITIES.filter((capability) => canUse(card, state, capability));
  return {
    stageId: stage.id,
    stageLabel: stage.label,
    allowed,
    identityId: state.identityId
  };
}

export const AFFECTION_EVENTS = Object.freeze(Object.keys(EVENT_KEYS));
export const AFFECTION_CAPABILITIES = CAPABILITIES;
