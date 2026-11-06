import fs from 'node:fs';
import path from 'node:path';

import {
  applyDecay,
  applyEvent,
  canUse,
  createAffectionState,
  getStage,
  getUnlocks,
  resetAffectionState,
  toPromptSummary
} from './affection.js';

function safeSegment(value, label) {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
    throw new Error(`${label} 不合法：${text}`);
  }
  return text;
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * 角色卡存储。
 *
 * 一张卡 × 一个 QQ 一份存档；卡本体只读，运行时状态写到 dataRoot。
 * 不提供修改好感度数值的方法；唯一人工操作是 reset()，会把该 QQ 的
 * 好感、记忆、剧情、背景状态、运行时缓存全部清掉。
 */
export class RoleCardStore {
  constructor({ cardsRoot, dataRoot }) {
    if (!cardsRoot || !dataRoot) throw new Error('cardsRoot 和 dataRoot 必填');
    this.cardsRoot = path.resolve(cardsRoot);
    this.dataRoot = path.resolve(dataRoot);
  }

  listCardIds() {
    if (!fs.existsSync(this.cardsRoot)) return [];
    return fs
      .readdirSync(this.cardsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((id) => fs.existsSync(path.join(this.cardsRoot, id, 'card.json')))
      .sort();
  }

  loadCard(cardId) {
    const id = safeSegment(cardId, 'cardId');
    const cardPath = path.join(this.cardsRoot, id, 'card.json');
    if (!fs.existsSync(cardPath)) throw new Error(`角色卡不存在：${id}`);
    const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
    if (card.id !== id) throw new Error(`角色卡 id 与目录不一致：${id}`);
    if (card.mode !== 'card') throw new Error(`不是角色卡模式：${id}`);
    return card;
  }

  cardDir(cardId) {
    return path.join(this.cardsRoot, safeSegment(cardId, 'cardId'));
  }

  statePath(cardId, qq) {
    return path.join(
      this.dataRoot,
      safeSegment(cardId, 'cardId'),
      `${safeSegment(qq, 'qq')}.json`
    );
  }

  runtimeDir(cardId, qq) {
    return path.join(
      this.dataRoot,
      safeSegment(cardId, 'cardId'),
      safeSegment(qq, 'qq')
    );
  }

  loadState(cardId, qq, { identityId = 'ordinary', now = new Date() } = {}) {
    const card = this.loadCard(cardId);
    const file = this.statePath(cardId, qq);
    if (!fs.existsSync(file)) return createAffectionState(card, { qq, identityId, now });
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.cardId !== card.id || String(state.qq) !== String(qq)) {
      throw new Error(`存档与角色卡/QQ 不一致：${file}`);
    }
    return state;
  }

  saveState(state) {
    const card = this.loadCard(state.cardId);
    if (!Number.isFinite(state.value) || state.value < 0 || state.value > card.affection.max) {
      throw new Error(`好感度越界：${state.value}`);
    }
    writeJsonAtomic(this.statePath(state.cardId, state.qq), state);
    return state;
  }

  applyEvent(cardId, qq, eventType, { now = new Date(), amount, identityId = 'ordinary' } = {}) {
    const card = this.loadCard(cardId);
    const state = this.loadState(cardId, qq, { identityId, now });
    const next = applyEvent(card, state, eventType, { now, amount });
    return this.saveState(next);
  }

  applyDecay(cardId, qq, { now = new Date(), identityId = 'ordinary' } = {}) {
    const card = this.loadCard(cardId);
    const state = this.loadState(cardId, qq, { identityId, now });
    const next = applyDecay(card, state, { now });
    if (next.updatedAt !== state.updatedAt) this.saveState(next);
    return next;
  }

  describe(cardId, qq, { identityId = 'ordinary', now = new Date() } = {}) {
    const card = this.loadCard(cardId);
    const state = this.loadState(cardId, qq, { identityId, now });
    return {
      ...toPromptSummary(card, state),
      stage: getStage(card, state.value),
      unlocks: getUnlocks(card, state.value),
      canUse: {
        sticker: canUse(card, state, 'sticker'),
        voice: canUse(card, state, 'voice'),
        photo: canUse(card, state, 'photo')
      }
    };
  }

  /**
   * 重置该 (cardId, qq) 的整条线。
   * 删除存档与运行时缓存目录；角色卡本体不动，其他 QQ 不动。
   */
  reset(cardId, qq, { now = new Date(), identityId = 'ordinary' } = {}) {
    const card = this.loadCard(cardId);
    const file = this.statePath(cardId, qq);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    const runtime = this.runtimeDir(cardId, qq);
    if (fs.existsSync(runtime)) fs.rmSync(runtime, { recursive: true, force: true });
    return resetAffectionState(card, { qq, identityId, now });
  }
}

export default RoleCardStore;
