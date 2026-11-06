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
