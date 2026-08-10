# pi (earendil-works/pi) 設定メモ

調査元: https://github.com/earendil-works/pi (docs/README.md, docs/extensions.md, docs/models.md, docs/providers.md, docs/settings.md, および `pi-mcp-adapter` https://github.com/nicobailon/pi-mcp-adapter)

## MCPサーバー設定(WebMCP / Chrome)

### 前提: piにMCPは組み込まれていない

pi は設計方針として意図的にMCPをコア機能に含めていない。

> **No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support.

代わりに「拡張(Extension)」経由でMCPサポートを追加する設計。`packages/coding-agent/README.md` の Extensions 節にも「MCP server integration」が拡張で実現できる例として挙がっている。

### 標準的な追加方法: `pi-mcp-adapter` 拡張

npm上の `pi-mcp-adapter`(https://github.com/nicobailon/pi-mcp-adapter)を使う。README冒頭の Quick Start がそのまま「Chrome DevTools(WebMCP)のMCPサーバー」の設定例になっている。

**1. インストール**
```bash
pi install npm:pi-mcp-adapter
```
インストール後、pi の再起動が必要。

**2. 設定ファイル(プロジェクトローカル推奨: `.mcp.json`)**

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--category-experimental-webmcp", "--auto-connect", "--channel", "canary"]
    }
  }
}
```

Chrome側のセットアップ(`chrome://flags` での有効化など)は `README.md` の「外部AIエージェントからの接続方法」を参照。

**3. 設定ファイルの優先順位**(数字が大きいほど優先)
1. `~/.config/mcp/mcp.json`(ユーザーグローバル共有)
2. `~/.agents/mcp.json`
3. `~/.agents/mcp/mcp.json`
4. `~/.pi/agent/mcp.json`(pi専用グローバル override)
5. `.mcp.json`(プロジェクトローカル共有) ← 通常はここ
6. `.pi/mcp.json`(pi専用プロジェクト override)

**4. 対話的セットアップも可能**
手書きせず pi 内で `/mcp setup` を実行すると、既存のClaude Code/Cursor/Codexなどのホスト設定を検出してインポートするか、`.mcp.json` を新規作成するかをガイド付きで選べる。

**5. ツールの呼び出され方**
デフォルトは「プロキシ方式」— サーバーごとの全ツールをコンテキストに展開せず、`mcp({ search: "..." })` / `mcp({ tool: "...", args: {...} })` という1つのツール経由で必要な時だけ呼ぶ(コンテキスト節約、~200トークン)。個別ツールとしてLLMに直接見せたい場合はサーバー設定に `"directTools": true` を追加。

**6. 起動タイミング**
サーバーはデフォルト `lifecycle: "lazy"` — 実際にツールが呼ばれるまでChrome DevTools MCPサーバーは起動しない。常時接続にしたい場合は `"lifecycle": "keep-alive"` を追加。

**7. 設定変更後はキャッシュに注意**
ツール一覧は `~/.pi/agent/mcp-cache.json` にディスクキャッシュされる。`lifecycle: "lazy"` のため、`.mcp.json`/`.pi/mcp.json` を書き換えて pi を再起動しても、実際に再接続するまでキャッシュ内の古いツール一覧が使われ続ける。設定変更後は明示的に `/mcp reconnect <server>` を実行すること。

**主なコマンド**
| コマンド | 内容 |
|---|---|
| `/mcp` | 状態パネル・初回オンボーディング |
| `/mcp setup` | ガイド付きセットアップ(インポート/新規作成) |
| `/mcp tools` | 全ツール一覧 |
| `/mcp reconnect [server]` | 再接続 |
| `/mcp disable <server>` / `/mcp enable <server>` | 有効/無効切り替え(`.pi/mcp.json`に書き込み、`/reload`必要) |

---

## モデル設定

### 1. 認証(モデルを使えるようにする)

**サブスクリプション(`/login` → プロバイダ選択)**
- Claude Pro/Max
- ChatGPT Plus/Pro(Codex)
- GitHub Copilot
- xAI(Grok)
- OpenRouter(OAuthでAPIキー発行)
- Radius

トークンは `~/.pi/agent/auth.json` に保存され自動リフレッシュ。

**APIキー(環境変数 or `/login`)** — 主なもの:
| プロバイダ | 環境変数 |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Amazon Bedrock | `AWS_BEARER_TOKEN_BEDROCK` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL` |

他にMistral/Groq/Cerebras/DeepSeek/Cloudflare/Vertex AIなど多数対応(`docs/providers.md`に全表)。

**資格情報の解決優先順位**: CLI `--api-key` > `auth.json` > 環境変数 > `models.json` のカスタムプロバイダキー

### 2. どのモデルを使うか(実行時指定)

```bash
pi --provider anthropic --model claude-sonnet-4-20250514
pi --model openai/gpt-4o                # provider/id 形式も可
pi --model sonnet:high                  # モデル名 + thinkingレベル省略記法
pi --thinking xhigh                     # off/minimal/low/medium/high/xhigh/max
pi --models "claude-*,gpt-4o"           # Ctrl+P サイクル対象を限定
pi --list-models [検索語]                # 利用可能モデル一覧
```

インタラクティブ中は `/model` でモデル切り替え、`/login` で認証追加、`/settings` で下記の設定をGUI的に編集可能。

### 3. デフォルト値の永続化(`~/.pi/agent/settings.json` or プロジェクトの `.pi/settings.json`)

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"],
  "thinkingBudgets": { "minimal": 1024, "low": 4096, "medium": 10240, "high": 32768 }
}
```
- `defaultProvider` / `defaultModel` / `defaultThinkingLevel` — 起動時デフォルト
- `enabledModels` — `Ctrl+P` でサイクルする候補(`--models` と同じパターン形式)
- `thinkingBudgets` — thinkingレベルごとのトークン予算をカスタム上書き
- プロジェクト設定はグローバル設定を上書き(ネストしたオブジェクトはマージ)

### 4. ローカル/カスタムモデルを追加(Ollama, vLLM, LM Studio, プロキシなど)

`~/.pi/agent/models.json` に追加。組み込みにない任意のOpenAI互換/Anthropic互換/Google互換サーバーを登録できる:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b", "reasoning": true }
      ]
    }
  }
}
```
対応API種別: `openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai`。このファイルは `/model` を開くたびにリロードされるので、再起動不要で編集を反映できる。組み込みプロバイダに `baseUrl` を上書き設定してプロキシ経由にすることも、`modelOverrides` で個別モデルの `contextWindow`/`cost`/`compat` だけを上書きすることも可能。

---

まとめ:「今すぐこのモデルで」は `--provider`/`--model`/`--thinking` フラグか `/model`、「毎回このモデルをデフォルトに」は `settings.json` の `defaultModel` 系、「そもそも一覧にないモデル/自前サーバーを足す」は `models.json`、という3層構造。
