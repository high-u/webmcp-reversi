# Note

> オセロをしよう!あなたのIDは"1180" で、白(後手)だよ。chrome-devtools の list_webmcp_tools を呼ぶと、オセロを操作するツールが分かるよ。まずは盤面の状況を確認して。


```bash
llama-server -hf google/gemma-4-26B-A4B-it-qat-q4_0-gguf \
  -c 32768 --n-cpu-moe 99 -fa on -np 1 \
  --chat-template-kwargs '{"enable_thinking": false}' \
  --temp 1.0 --top-p 0.95 --top-k 64 \
  --alias "gemma4-26b-a4b"
```

```bash
llama-server -hf unsloth/Qwen3.6-27B-MTP-GGUF:UD-IQ3_XXS \
  -c 65536 -fa on -np 1 \
  --spec-type draft-mtp --spec-draft-n-max 2 \
  --chat-template-kwargs '{"enable_thinking":false}' \
  --temp 0.7 --top-p 0.8 --top-k 20 --presence-penalty 1.5 --min-p 0.00 \
  -ctv q8_0 -ctk q8_0 \
  --alias "qwen3.6-27b"
```
