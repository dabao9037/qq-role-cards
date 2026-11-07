import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createAffectionState,
  applyEvent,
  applyDecay,
  canUse,
  getProactiveInterval,
  getProactivePlan,
  getReplyChance,
  getStage,
  getUnlocks,
  getWarmth,
  resetAffectionState,
  shouldReply,
  toPromptSummary
} from '../src/affection.js';

const card = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../cards/shenyouchu/card.json'), 'utf8'));
const T0 = new Date('2026-11-06T00:00:00.000Z');
const day = (n) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

function withValue(state, value) {
  return { ...state, value };
}

test('初始好感为 20，按卡和 QQ 隔离', () => {
  const a = createAffectionState(card, { qq: '10001', now: T0 });
  const b = createAffectionState(card, { qq: '10002', now: T0 });
  assert.equal(a.value, 20);
  assert.equal(a.cardId, 'shenyouchu');
  assert.notEqual(a.qq, b.qq);
});

test('聊天加 0.2，单日上限 5', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  for (let i = 0; i < 100; i++) s = applyEvent(card, s, 'chat', { now: T0 });
  assert.equal(s.value, 25);
  assert.equal(s.dailyGained, 5);
});

test('跨天后单日额度重置', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  for (let i = 0; i < 100; i++) s = applyEvent(card, s, 'chat', { now: T0 });
  s = applyEvent(card, s, 'chat', { now: day(1) });
  assert.equal(s.value, 25.2);
});

test('单次事件截断到 -10 ~ +5', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  s = applyEvent(card, s, 'boundaryViolation', { now: T0, amount: -999 });
  assert.equal(s.value, 10);
  s = applyEvent(card, s, 'sharedEvent', { now: T0, amount: 999 });
  assert.equal(s.value, 15);
});

test('阶段与解锁按阈值生效', () => {
  const s = createAffectionState(card, { qq: '10001', now: T0 });
  assert.equal(getStage(card, 0).label, '陌生');
  assert.equal(canUse(card, withValue(s, 44), 'sticker'), false);
  assert.equal(canUse(card, withValue(s, 45), 'sticker'), true);
  assert.equal(canUse(card, withValue(s, 69), 'voice'), false);
  assert.equal(canUse(card, withValue(s, 70), 'voice'), true);
  assert.equal(canUse(card, withValue(s, 89), 'photo'), false);
  assert.equal(canUse(card, withValue(s, 90), 'photo'), true);
  assert.deepEqual(getUnlocks(card, 50), ['sticker']);
  assert.deepEqual(getUnlocks(card, 75), ['sticker', 'voice']);
  assert.deepEqual(getUnlocks(card, 95), ['sticker', 'voice', 'photo']);
});

test('热情程度随亲密度变化，只给表达层且不暴露数值', () => {
  assert.deepEqual(getWarmth(card, 0), {
    id: 'cold', label: '生分', hint: '只回必要的字，句子短；不主动展开，也不追问对方的事。', verbosity: 1, allowQuestion: false
  });
  assert.equal(getWarmth(card, 20).id, 'reserved');
  assert.equal(getWarmth(card, 45).id, 'normal');
  assert.equal(getWarmth(card, 70).id, 'warm');
  assert.equal(getWarmth(card, 95).id, 'close');
  assert.equal(getWarmth(card, 95).allowQuestion, true);
  assert.equal(getWarmth(card, 95).verbosity, 3);
  assert.equal(Object.keys(getWarmth(card, 95)).includes('value'), false);
});

test('长期不聊按天衰减，且 20 分钟重复调用不重复扣', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  s = withValue(s, 10);
  s = applyEvent(card, s, 'chat', { now: T0 });
  s = applyDecay(card, s, { now: day(1) });
  s = applyDecay(card, s, { now: day(2) });
  assert.equal(s.value, 10.2);
  s = applyDecay(card, s, { now: day(4) });
  assert.equal(s.value, 9.2);
  s = applyDecay(card, s, { now: day(4) });
  assert.equal(s.value, 9.2);
  s = applyDecay(card, s, { now: day(6) });
  assert.equal(s.value, 7.2);
});

test('衰减不会低于 floor', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  s = withValue(s, 1);
  s = applyEvent(card, s, 'chat', { now: T0 });
  s = applyDecay(card, s, { now: day(30) });
  assert.equal(s.value, 0);
});

test('重置回到初始状态，不保留旧值', () => {
  const old = createAffectionState(card, { qq: '10001', now: T0 });
  const reset = resetAffectionState(card, { qq: '10001', now: day(10) });
  assert.equal(reset.value, card.affection.initial);
  assert.equal(reset.lastInteractionAt, null);
  assert.notEqual(old.createdAt, reset.createdAt);
});

test('给模型的摘要不暴露数值', () => {
  const s = withValue(createAffectionState(card, { qq: '10001', now: T0 }), 75);
  const summary = toPromptSummary(card, s);
  assert.deepEqual(summary, {
    stageId: 'close',
    stageLabel: '亲近',
    allowed: ['sticker', 'voice'],
    identityId: 'ordinary'
  });
  assert.equal(JSON.stringify(summary).includes('75'), false);
});

test('身份线不改变好感数值', () => {
  let a = createAffectionState(card, { qq: '10001', identityId: 'ordinary', now: T0 });
  let b = createAffectionState(card, { qq: '10001', identityId: 'chenhansheng', now: T0 });
  a = applyEvent(card, a, 'selfDisclosure', { now: T0 });
  b = applyEvent(card, b, 'selfDisclosure', { now: T0 });
  assert.equal(a.value, b.value);
  assert.notEqual(a.identityId, b.identityId);
});


test('回复概率按区间生效', () => {
  assert.equal(getReplyChance(card, 0), 0.01);
  assert.equal(getReplyChance(card, 1), 0.05);
  assert.equal(getReplyChance(card, 4), 0.05);
  assert.equal(getReplyChance(card, 5), 0.05);
  assert.equal(getReplyChance(card, 7), 0.15);
  assert.equal(getReplyChance(card, 9), 0.25);
  assert.equal(getReplyChance(card, 10), 0.3);
  assert.equal(getReplyChance(card, 19), 0.3);
  assert.equal(getReplyChance(card, 20), 1);
});

test('0 好感仍保留 1% 破冰，20 以上必回', () => {
  const zero = withValue(createAffectionState(card, { qq: '10001', now: T0 }), 0);
  const normal = withValue(createAffectionState(card, { qq: '10001', now: T0 }), 20);
  assert.equal(shouldReply(card, zero, { random: () => 0.005 }), true);
  assert.equal(shouldReply(card, zero, { random: () => 0.02 }), false);
  assert.equal(shouldReply(card, normal, { random: () => 0.99 }), true);
});

test('主动间隔按好感区间取', () => {
  assert.equal(getProactiveInterval(card, 39), null);
  assert.deepEqual(getProactiveInterval(card, 40), { minMinutes: 1440, maxMinutes: 1800 });
  assert.deepEqual(getProactiveInterval(card, 50), { minMinutes: 960, maxMinutes: 1200 });
  assert.deepEqual(getProactiveInterval(card, 60), { minMinutes: 600, maxMinutes: 840 });
  assert.deepEqual(getProactiveInterval(card, 70), { minMinutes: 360, maxMinutes: 540 });
  assert.deepEqual(getProactiveInterval(card, 80), { minMinutes: 240, maxMinutes: 360 });
  assert.deepEqual(getProactiveInterval(card, 90), { minMinutes: 180, maxMinutes: 240 });
  assert.deepEqual(getProactiveInterval(card, 95), { minMinutes: 120, maxMinutes: 180 });
});

test('主动消息限制：低于40、用户刚说话、上条未回、深夜', () => {
  const at = (value) => withValue(createAffectionState(card, { qq: '10001', now: T0 }), value);
  const dayNoon = new Date('2026-11-06T04:00:00.000Z'); // 上海 12:00

  assert.equal(getProactivePlan(card, at(39), { now: dayNoon }).reason, 'below-threshold');
  assert.equal(
    getProactivePlan(card, at(40), { now: dayNoon, lastUserMessageAt: new Date(dayNoon.getTime() - 10 * 60000) }).reason,
    'user-active'
  );
  assert.equal(
    getProactivePlan(card, at(40), {
      now: dayNoon,
      lastProactiveAt: new Date(dayNoon.getTime() - 25 * 3600000),
      lastProactiveAnswered: false
    }).reason,
    'previous-unanswered'
  );
  assert.equal(
    getProactivePlan(card, at(40), { now: new Date('2026-11-06T22:00:00.000Z') }).reason,
    'quiet-hours'
  );

  // 首次主动也按“上次用户说话”起算 24~30h，不是 1 小时没说话就冒泡。
  assert.equal(
    getProactivePlan(card, at(40), {
      now: dayNoon,
      lastUserMessageAt: new Date(dayNoon.getTime() - 60 * 60000)
    }).reason,
    'not-due'
  );
  const plan = getProactivePlan(card, at(40), {
    now: dayNoon,
    lastUserMessageAt: new Date(dayNoon.getTime() - 25 * 3600000),
    random: () => 0
  });
  assert.equal(plan.eligible, true);
  assert.equal(plan.nextAt, new Date(dayNoon.getTime() + 1440 * 60000).toISOString());
});
