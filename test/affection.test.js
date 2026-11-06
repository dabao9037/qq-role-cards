import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createAffectionState,
  applyEvent,
  applyDecay,
  canUse,
  getStage,
  getUnlocks,
  resetAffectionState,
  toPromptSummary
} from '../src/affection.js';

const card = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../cards/shenyouchu/card.json'), 'utf8'));
const T0 = new Date('2026-11-06T00:00:00.000Z');
const day = (n) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

function withValue(state, value) {
  return { ...state, value };
}

test('初始好感为 0，按卡和 QQ 隔离', () => {
  const a = createAffectionState(card, { qq: '10001', now: T0 });
  const b = createAffectionState(card, { qq: '10002', now: T0 });
  assert.equal(a.value, 0);
  assert.equal(a.cardId, 'shenyouchu');
  assert.notEqual(a.qq, b.qq);
});

test('聊天加 0.2，单日上限 8', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  for (let i = 0; i < 100; i++) s = applyEvent(card, s, 'chat', { now: T0 });
  assert.equal(s.value, 8);
  assert.equal(s.dailyGained, 8);
});

test('跨天后单日额度重置', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  for (let i = 0; i < 100; i++) s = applyEvent(card, s, 'chat', { now: T0 });
  s = applyEvent(card, s, 'chat', { now: day(1) });
  assert.equal(s.value, 8.2);
});

test('单次事件截断到 -10 ~ +5', () => {
  let s = createAffectionState(card, { qq: '10001', now: T0 });
  s = applyEvent(card, s, 'boundaryViolation', { now: T0, amount: -999 });
  assert.equal(s.value, 0);
  s = applyEvent(card, s, 'sharedEvent', { now: T0, amount: 999 });
  assert.equal(s.value, 5);
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
