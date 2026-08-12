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

## ツールの見え方と directTools

以下は上のドキュメント調査ではなく、インストール済みのソースを直接読んで確認した内容(pi 0.84.1 / pi-mcp-adapter 2.21.2)。オセロを打たせていて実際に踏んだ問題の原因調査から。

### 1. プロキシ方式では、モデルはツール名もスキーマも知らない

システムプロンプトに入るのは `mcp` という1つのツールの description だけで、その中身は**サーバー名とツール本数のみ**(`pi-mcp-adapter/direct-tools.ts` の `buildProxyDescription`)。個々のツール名も `inputSchema` も入っていない。

```
MCP gateway — server status, tool search/describe, auth, and single MCP tool calls. ...

Direct tools available (call as normal tools): chrome-devtools (4)

Servers: chrome-devtools (27 tools)
```

モデルがツールの引数を知る手段は `mcp({search})` / `mcp({describe})` / `mcp({server})` を明示的に呼ぶことだけ。プロキシ方式の「~200トークン」という安さは、この探索の往復とのトレードオフ。

### 2. `mcp` の引数はすべて optional なので、必須引数の欠落を手前で弾けない

`index.ts` の `registerProxyTool` で、`tool` も `args` も `Type.Optional`。つまり `mcp({tool: "chrome_devtools_select_page", args: "{}"})` は `mcp` のスキーマとしては完全に正しく、生成時の制約もクライアント側の検証も一切かからない。実際に弾くのは接続先のMCPサーバー。

```
Error: MCP error -32602: Input validation error: Invalid arguments for tool select_page: Required at pageId

Expected parameters:
  pageId (number) *required* - The ID of the page to select. ...
```

`Expected parameters:` 以降はアダプタがエラー時に付け足すもの(`proxy-modes.ts`)。エラーを見て自己復旧はできるが、1往復無駄になる。

**帰結**: AGENTS.md にツール名だけ書くと、モデルは名前を知っているので探索を飛ばし、しかし引数は知らない、という穴に落ちる。「ツール情報(description / inputSchema)から取得できることは書かない」という方針は、スキーマが最初からコンテキストにある前提の話で、プロキシ方式では成立しない。

### 3. directTools でスキーマをコンテキストに載せる

サーバー定義に追加する。配列で指定する場合は**接頭辞なしの元のツール名**を並べる(登録される名前は `chrome_devtools_<名前>`)。

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--category-experimental-webmcp", "--auto-connect"],
      "directTools": ["list_pages", "select_page", "list_webmcp_tools", "execute_webmcp_tool"]
    }
  }
}
```

これで4つが `read` / `bash` などと同列の通常ツールとして登録され、`select_page` は `pageId` 必須のスキーマ付きになる。残りはプロキシ経由のまま。効果は2つ。

- 必須引数の欠落が生成時に効く
- ツール名の取り違えが消える(プロキシ方式では `list_pages` と接頭辞なしで呼んで `not found. Did you mean: chrome_devtools_list_pages` を食っていた)

代償はプロンプトの増加。READMEの推奨は5〜20個程度、75個以上になるならプロキシか明示的な配列を使えとある(閾値超過時は `console.warn` が出る)。

**反映タイミング**: 直接ツールはメタデータキャッシュから登録される。`directTools` は `computeServerHash` の対象外なので、既存キャッシュを無効化しない = 次回起動でそのまま反映され、`/mcp reconnect` は不要。

**上の「7. 設定変更後はキャッシュに注意」の補足**: `computeServerHash` が見ているのは `command` / `args` / `env` / `cwd` / `url` / `headers` / `auth` / `socket` / `protocolVersion` / `exposeResources` / `includeTools` / `excludeTools`。ここを変えればキャッシュは自動的に無効になる。逆に `lifecycle` / `idleTimeout` / `requestTimeoutMs` / `debug` / `directTools` は対象外。キャッシュのTTLは7日。

### 4. 設定が効いているかの確認方法

**起動時のリストにツールは出ない。** 起動時に表示されるセクションは Context / Skills / Prompts / Extensions / Themes の5つだけで(`dist/modes/interactive/interactive-mode.js` の `showLoadedResources`)、ツールのセクションは存在しない。`--verbose` を付けても増えない。pi 本体に `/tools` 相当のコマンドもない。

起動後の確認は2通り。

| 方法 | 分かること |
|---|---|
| `/mcp`(引数なし) | サーバーごとの direct 数(`4/31`)、ツールごとに ●=direct / ○=proxy、トークン概算 |
| `/mcp tools` | 全ツール名の一覧。**direct/proxy の区別は付かない**(`state.toolMetadata` を並べるだけ) |

directTools の確認に使えるのは `/mcp` のパネルの方。ただしこのパネルはトグルすると設定ファイルを書き換えるので、確認だけなら触らずに閉じる。

---

## AGENTS.md の読み込み

### 読み込まれる範囲

`dist/core/resource-loader.js` の `loadProjectContextFiles`。ディレクトリごとに以下の候補の**最初に見つかった1つ**だけを採用する。

```
AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD
```

読む順は、グローバル(`~/.pi/agent`)→ cwd から `/` まで**上に遡って**各階層、で近いものが後ろ。**サブディレクトリは一切見ない。**

つまり `pi/AGENTS.md` を効かせるには `pi/` ディレクトリで pi を起動する必要がある。リポジトリルートで起動しても読まれない(`.pi/mcp.json` も同じ解決なので、MCPが動いていれば cwd は合っている)。

システムプロンプトには `<project_context>` 内に `<project_instructions path="...">` として追加される。

### 読み込みが表示されない場合

`~/.pi/agent/settings.json` の `quietStartup: true` が起動時のリスト表示そのものを抑止している。

```js
const showListing = options?.force || this.options.verbose || !this.settingsManager.getQuietStartup();
```

`force: true` を渡す呼び出し元は存在しないので、上書きする手段は `--verbose`(一時的)か、この設定を `false` にする(恒久的)かの2つ。

MCPの起動メッセージは `pi-mcp-adapter` 拡張側の別経路で出るため、`quietStartup: true` でも表示される。「MCPは出ているのにAGENTS.mdは何も出ない」の正体はこれで、読み込み自体は最初からできていた。

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
