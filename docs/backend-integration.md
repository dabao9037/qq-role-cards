# 后台接入点

这个仓库先交付“卡 + 好感度引擎 + 每 QQ 存档”。QQ 桥接侧按下面接。

## 1. 卡目录

后台只需要一个只读的卡目录：

```text
<cardsRoot>/<id>/card.json
```

`RoleCardStore` 以 `cardsRoot` 和 `dataRoot` 初始化；卡本体不写，运行时状态全在 `dataRoot`。

## 2. 存档键

```text
dataRoot/<cardId>/<qq>.json        # 好感度、身份线、衰减/每日额度
dataRoot/<cardId>/<qq>/            # 运行时照片/语音缓存
```

A 和 B 的 QQ 各一个文件；同一个 QQ 换身份线，读写同一个文件。

## 3. 绑定

桥接需要知道“这个 QQ 当前在跟哪张卡说话”。建议：

```text
state/role-card-bindings.json
{
  "private:10001": "shenyouchu",
  "private:10002": "another-card"
}
```

没有绑定时走普通模式，不加载角色卡。绑定切换不删旧存档；切回来还是原来那条线。

## 4. 工具门禁

在 `qq_send_sticker` / 发语音 / 发照片的处理入口统一调用：

```js
const allowed = store.describe(cardId, qq).canUse.sticker;
if (!allowed) throw new Error('好感度不足');
```

- 低于阈值：桥接层硬拒绝，不把工具暴露给模型。
- 高于阈值：允许，但角色仍可按语境拒绝。
- 普通模式不经过这个门禁。

## 5. Prompt 注入

只注入阶段，不注入数值：

```json
{
  "stageId": "talking",
  "stageLabel": "说上话",
  "allowed": ["sticker"],
  "identityId": "ordinary"
}
```

角色卡模式不要再把全局的主动间隔、表情概率注入成可调配置；这些读 `card.json`。

## 6. 回复概率

每条用户消息进来，先查回复概率：

```js
const chance = getReplyChance(card, state.value);
if (Math.random() >= chance) {
  // 不回复，但仍然记录用户来过，用于“用户刚说话”判断
  return;
}
```

- 0 好感：1%
- 1–4：5%
- 5–9：5%→25% 线性
- 10–19：30%
- 20 以上：100%

被概率挡掉时不要报错，也不要给用户提示。

## 7. 互动更新

每轮有效对话后，由 AI 给出事件类型（`chat` / `selfDisclosure` / `help` / `sharedEvent` / `conflict` / `boundaryViolation`），桥接调用：

```js
store.applyEvent(cardId, qq, eventType);
```

引擎自己处理单次截断、单日上限、衰减字段。不提供“设置好感”的 API。

## 8. 后台 20 分钟静默推进

每个 `(cardId, qq)` 一条任务：

- 间隔 20 分钟
- `silent: true`，不主动发消息
- 不设 token 上限
- 只改剧情/心情/事件/日记
- 每轮先 `store.applyDecay(cardId, qq)`，再跑剧情推进
- 任务之间互不串线

## 9. 主动消息

注意：20 分钟后台推进是静默的；主动消息是另一条调度，按好感区间取间隔。

```js
const plan = getProactivePlan(card, state, {
  now,
  lastUserMessageAt,
  lastProactiveAt,
  lastProactiveAnswered
});
```

- 低于 40：不发。
- 40–49：24–30 小时
- 50–59：16–20 小时
- 60–69：10–14 小时
- 70–79：6–9 小时
- 80–89：4–6 小时
- 90–94：3–4 小时
- 95–100：2–3 小时
- 用户 30 分钟内说过话：不发
- 上一条主动没回：不发
- 00:00–07:00：不发

发出后记录 `lastProactiveAt`；用户回复后记为已回；没回就保持未回，不叠下一条。

## 10. 重置

后台唯一写操作：

```js
store.reset(cardId, qq);
```

删除该 QQ 的存档和运行时缓存；卡本体、其他 QQ、其他卡都不动。重置后回到 `card.json` 的初始状态：沈幼楚好感 20。

## 11. 当前实现状态

桥接 `qqbot-dsh-stack` 已接：

- `qq-bridge` 的卡片绑定、回复概率、唤醒注入、表情/语音门禁、好感增长
- 每 20 分钟独立 DSH 会话的静默后台时间线（只写 `backgroundLog`，不加好感、不发 QQ 消息）
- 主动消息调度（三条限制 + 分区间间隔）
- 后台导入/列卡/绑定/解绑/重置接口与控制台「人格与角色 → 角色卡」区
- 重置联动：删该 `(cardId, QQ)` 存档与运行时目录，清 DSH 会话、检查点、人账本缓存

仍未接：

- 真实照片生成与语音克隆；当前只有门禁和已有语音库发送
- `assets/portrait.png` 等卡形象素材
- 卡仓库到桥接 `role-cards/cards/` 的自动同步脚本

在这些接完前，角色卡模式只在 `roleCards.enabled=true` 且显式绑定私聊 QQ 时生效；默认关闭，不影响原来的普通模式。
