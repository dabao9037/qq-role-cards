import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RoleCardStore } from '../src/store.js';

const cardsRoot = path.join(import.meta.dirname, '../cards');
const T0 = new Date('2026-11-06T00:00:00.000Z');

function makeStore() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-role-cards-'));
  return { store: new RoleCardStore({ cardsRoot, dataRoot }), dataRoot };
}

test('列出并加载沈幼楚卡', () => {
  const { store } = makeStore();
  assert.deepEqual(store.listCardIds(), ['shenyouchu']);
  assert.equal(store.loadCard('shenyouchu').name, '沈幼楚');
});

test('A/B 两个 QQ 的存档互不影响', () => {
  const { store } = makeStore();
  store.applyEvent('shenyouchu', '10001', 'selfDisclosure', { now: T0 });
  const a = store.loadState('shenyouchu', '10001', { now: T0 });
  const b = store.loadState('shenyouchu', '10002', { now: T0 });
  assert.equal(a.value, 2);
  assert.equal(b.value, 0);
});

test('身份线共用同一份好感度', () => {
  const { store } = makeStore();
  store.applyEvent('shenyouchu', '10001', 'help', { now: T0, identityId: 'ordinary' });
  const canon = store.loadState('shenyouchu', '10001', {
    now: T0,
    identityId: 'chenhansheng'
  });
  assert.equal(canon.value, 2);
});

test('没有修改数值的方法', () => {
  const { store } = makeStore();
  assert.equal(typeof store.setAffection, 'undefined');
  assert.equal(typeof store.setValue, 'undefined');
});

test('重置只清当前 QQ，并删掉运行时缓存', () => {
  const { store, dataRoot } = makeStore();
  store.applyEvent('shenyouchu', '10001', 'selfDisclosure', { now: T0 });
  store.applyEvent('shenyouchu', '10002', 'selfDisclosure', { now: T0 });

  const runtime = store.runtimeDir('shenyouchu', '10001');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'photo.jpg'), 'runtime');

  const reset = store.reset('shenyouchu', '10001', { now: T0 });
  assert.equal(reset.value, 0);
  assert.equal(fs.existsSync(store.statePath('shenyouchu', '10001')), false);
  assert.equal(fs.existsSync(runtime), false);
  assert.equal(store.loadState('shenyouchu', '10001', { now: T0 }).value, 0);
  assert.equal(store.loadState('shenyouchu', '10002', { now: T0 }).value, 2);
  assert.ok(dataRoot);
});

test('越界存档拒绝写入', () => {
  const { store } = makeStore();
  const state = store.loadState('shenyouchu', '10001', { now: T0 });
  assert.throws(() => store.saveState({ ...state, value: 101 }), /好感度越界/);
});
