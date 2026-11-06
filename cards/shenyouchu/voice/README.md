# 语音素材

语音后续接入。这里先放音色配置和参考音频，不把运行时生成的语音写回来。

建议结构：

```text
voice/
  profile.json      # 音色 id、后端、语速/情绪映射
  samples/          # 参考音频（授权使用的自己的声音）
```

没有确定方案前保持 `card.json` 的 `voice.enabled=false`，不要放未授权的声音样本。
