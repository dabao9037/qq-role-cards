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
state/role-bindings.json
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

## 6. 互动更新

每轮有效对话后，由 AI 给出事件类型（`chat` / `selfDisclosure` / `help` / `sharedEvent` / `conflict` / `boundaryViolation`），桥接调用：

```js
store.applyEvent(cardId, qq, eventType);
```

引擎自己处理单次截断、单日上限、衰减字段。不提供“设置好感”的 API。

## 7. 后台 20 分钟静默推进

每个 `(cardId, qq)` 一条任务：

- 间隔 20 分钟
- `silent: true`，不主动发消息
- 不设 token 上限
- 只改剧情/心情/事件/日记
- 每轮先 `store.applyDecay(cardId, qq)`，再跑剧情推进
- 任务之间互不串线

## 8. 重置

后台唯一写操作：

```js
store.reset(cardId, qq);
```

删除该 QQ 的存档和运行时缓存；卡本体、其他 QQ、其他卡都不动。重置后回到 `card.json` 的初始状态。

## 9. 还没接的

- 桥接里的 active card 绑定与切换
- 工具门禁的实际调用
- 20 分钟调度器
- 后台导入卡、列出卡、只读配置页
- 记忆/剧情存储与重置联动
- 语音与生图

这些接完之前，线上仍是原来的普通模式，不会因为仓库里多了一张卡就改变行为。
