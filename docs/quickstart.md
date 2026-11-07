# 沈幼楚角色卡：快速配置

这份是给接手的人看的，目标是：把 `shenyouchu` 这张卡挂到一个已经跑起来的 `qq-bridge` 上，只在私聊生效。

## 1. 先有运行时

没有 QQ 桥接的，先按 [`qqbot-dsh-stack`](https://github.com/dabao9037/qqbot-dsh-stack) 的 README 一键部署。  
不想装整套，只把卡接进现有 `/opt/qq-bridge` 也行。

## 2. 放卡

```bash
git clone https://github.com/dabao9037/qq-role-cards.git
sudo mkdir -p /opt/qq-bridge/role-cards/cards
sudo cp -a qq-role-cards/cards/shenyouchu /opt/qq-bridge/role-cards/cards/
sudo chown -R root:root /opt/qq-bridge/role-cards/cards/shenyouchu
```

卡目录只读；运行时状态写到 `/opt/qq-bridge/state/role-cards/`，不会改卡本体。

## 3. 开角色卡

编辑 `/opt/qq-bridge/config.json`，加上：

```json
{
  "roleCards": {
    "enabled": true,
    "cardsRoot": "role-cards/cards",
    "dataRoot": "state/role-cards",
    "bindingsFile": "state/role-card-bindings.json",
    "proactive": { "enabled": true, "checkIntervalMs": 60000 }
  }
}
```

重启：

```bash
sudo systemctl restart qq-bridge
sudo systemctl status qq-bridge --no-pager
```

确认接口能列到卡：

```bash
TOKEN=$(sudo cat /opt/qq-bridge/state/console-token)
curl -s -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/role-cards
```

返回里应看到 `shenyouchu`，版本 `1.6.1`。

## 4. 绑定私聊 QQ

把 `123456789` 换成要绑定的 QQ：

```bash
TOKEN=$(sudo cat /opt/qq-bridge/state/console-token)
curl -s -X POST http://127.0.0.1:3100/api/role-cards/bind \
  -H "x-console-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"private:123456789","cardId":"shenyouchu"}'
```

只绑私聊；群聊不进入角色卡。绑定后第一次说话会建独立存档。

## 5. 验证

私聊发：

```text
在吗
```

应进入角色卡模式，但不会暴露好感数值。再用下面三句验语境：

1. `今天被领导骂了，真傻逼` —— 不应还嘴，先问发生了什么。
2. `你傻逼吧` —— 应针对这句顶回来，不扯旧事。
3. `对不起，我刚刚喝多了` —— 低好感也应回，不先纠名字、不拿“去忙了”岔开。

## 6. 常见问题

- **群里不回角色卡**：正常，只支持私聊。
- **接口 401**：`x-console-token` 和 `/opt/qq-bridge/state/console-token` 不一致，重启桥接后再取。
- **绑定后还是普通人设**：看 `roleCards.enabled` 是否为 `true`，以及绑定的 key 是不是 `private:<QQ>`。
- **想重置某条线**：`POST /api/role-cards/reset`，body `{"key":"private:<QQ>"}`；保留绑定，清好感、记忆、剧情和运行时缓存。
- **角色卡模式关闭时**：普通模式照常，不影响原有 `roles/*.md`。

## 7. 版本

当前卡版本 `1.6.1`：骂人指向、道歉优先、连续未回消息、6 小时冲突冷却、人类式遗忘。  
角色卡只负责“她是谁、怎么反应”；QQ 登录、模型 key、OneBot token 由 `qqbot-dsh-stack` 管，不放进这个仓库。
