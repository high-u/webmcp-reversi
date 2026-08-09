# オセロ (Othello) - WebMCP対応版

WebMCP (Web Model Context Protocol) を使って、外部のAIエージェントが対局を操作できる最低限のオセロ実装。

## 技術スタック

- `index.html` / `style.css` / `app.js` の素のHTML/CSS/JavaScriptのみ
- ビルド不要。`file://` でも動くが、WebMCPの動作確認は `http://localhost` 経由を推奨(セキュアコンテキストの扱いが安定するため)

```bash
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## ゲーム仕様

- 標準的な8x8オセロのルール(合法手判定・石の反転・打てる場所がない場合の自動パス・両者パスで終局・石数勝敗判定)
- 「人間」と「AIエージェント(WebMCP経由)」が必ず1人ずつ対局する(人間対人間・エージェント対エージェントは不可)。人間がどちらの色(黒=先手 / 白=後手)を担当するかは対局開始前に選択できる
  - **人間**: ブラウザの盤面を直接クリックして着手する。人間の番のときだけ盤面クリックが有効になる
  - **AIエージェント**: このアプリ自体には対戦用の思考ルーチンは組み込まれていない。「AIエージェント」= WebMCPツール経由で外部から操作される人・プログラムを指す。`make_move` はエージェント側の色を常に暗黙に使い、エージェントの番でなければエラーになる(詳細は下記)
  - 「新しい対局」ボタン(またはWebMCPの `new_game` ツール)を押すまでは対局は開始されておらず、盤面クリックも `make_move` も無効

### 手番の区別: 「ブラウザUIから打つ」 vs 「WebMCP経由で打つ」

WebMCPのツール呼び出しには呼び出し元(どのエージェントか)を識別する仕組みが無いため、このアプリでは **「ブラウザUIのクリック = 人間」「WebMCPツール経由の呼び出し = エージェント」という運用上の前提**で区別している。

- ブラウザUIのクリックは、人間に割り当てられた色の番のときだけ有効(ボタンが押せる状態になる)
- WebMCPの `make_move` は常に「エージェントに割り当てられた色」として着手を試み、**今がエージェントの番でなければ(=人間の番なら)エラーを返す**。これにより、エージェントが人間の番を横取りして着手することはできない
- ただしこれは暗号的な認証ではなく、あくまで「WebMCP経由の呼び出しは全てエージェントからのもの」という前提に立った制御であることに注意

### 公開しているWebMCPツール

| ツール名 | 内容 |
|---|---|
| `get_game_state` | 盤面・手番・スコア・合法手一覧・プレイヤー割り当て(黒/白それぞれ人間かエージェントか)・対局開始済みか(`gameStarted`)・対局状況をJSONで返す(読み取り専用) |
| `make_move` | `{row, col}` (0-7の整数、任意で `color`)を指定して、**エージェントに割り当てられた色**の石を置く。対局未開始・エージェントの番でない・非合法手の場合はエラーを返す。`color` を指定した場合はエージェントの色と一致しないとエラーになる |
| `new_game` | ドロップダウンで選ばれている人間の担当色を確定させて対局を開始する(ブラウザの「新しい対局」ボタンと同じ処理) |

## WebMCPとは(調査結果)

- **正式名称**: Web Model Context Protocol。GoogleとMicrosoftのエンジニアが提唱し、W3C Web Machine Learning Community Groupで策定中の仕様(Draft Community Group Report、標準化トラック外)
- **目的**: Webページ自身が「これができます」とAIエージェントに構造化されたツール(JavaScript関数 + JSON Schema)として教える仕組み。スクリーンショット解析やDOM推測に頼らず、ページ側が明示的にツールを公開する
- Anthropicの(サーバー側の)Model Context Protocolとは別物。WebMCPはブラウザタブ内で完結する「クライアントサイドのMCPサーバー」に近い位置づけ
- 命令的API(`document.modelContext.registerTool()`)と宣言的API(`<form toolname="..." tooldescription="...">`)の2種類があるが、動的なゲームには命令的APIが適している

### API名の注意点: `document.modelContext` が正解

調査時、情報源によって以下の食い違いがあった。

- 2026年2月頃の記事の多くは `navigator.modelContext.registerTool()` と記載
- 公式のW3C仕様書(2026年7月28日付Draft)と公式GitHubリポジトリ(`webmachinelearning/webmcp`)は `document.modelContext.registerTool()` を使用

これは仕様が2026年2月→7月の間に `navigator` から `document` へ移行したためと見られる。**手元のChrome Canary 153.0.7998.0で実機確認した結果、`document.modelContext` が正しく、`navigator.modelContext` は存在しない(`undefined`)ことを確認済み。**

```js
console.log(typeof document.modelContext);              // "object"
console.log(typeof document.modelContext.registerTool); // "function"
console.log(typeof navigator.modelContext);              // "undefined"
```

`app.js` では `document.modelContext` を優先し、なければ `navigator.modelContext` にフォールバックする両対応の実装にしてある(将来的な仕様変更やブラウザ差異への保険)。

## 動作確認環境

- **Chrome Canary 153.0.7998.0 (x86_64)**
- `chrome://flags` で以下を有効化・再起動:
  - `#enable-webmcp-testing` (**WebMCP for testing** — WebMCP APIそのものを有効化)
  - `#devtools-webmcp-support` (**WebMCP support in DevTools** — DevTools側の対応)
- 確認用拡張機能: **WebMCP - Model Context Tool Inspector**(Chromeウェブストア)
  - ページを開いた状態でこの拡張を見ると、登録済みのWebMCPツールが一覧表示される
  - `get_game_state` / `make_move` / `new_game` が登録されていることを確認済み

## 動作確認済みのこと

- ゲームロジック(合法手判定・反転・自動パス・終局判定・勝敗判定)をNode.jsのvmサンドボックスで分離実行し、初期配置・着手・エラーハンドリング・ランダム対局10回の終局(石数合計が常に64)を検証
- HTML内のDOM要素IDとapp.jsの参照の整合性を検証
- Chrome Canary実機で `document.modelContext.registerTool()` が正常に動作し、3つのツールが登録されることを拡張機能で確認
- Claude Code(新しいセッション、`chrome-devtools` MCPサーバー経由)から `list_pages` → `list_webmcp_tools` を実行し、オセロのページ上の `get_game_state` / `make_move` / `new_game` の3ツールが `inputSchema` / `description` 込みで正しく見えることを確認
- `execute_webmcp_tool` 経由で実際に `get_game_state` / `make_move` / `new_game` を呼び出し、盤面が反転・手番交代することを確認(実際にClaude Codeを白番のエージェントとして対局し、複数手を打った)
- 対局未開始(`gameStarted:false`)の状態で `make_move` を呼ぶとエラーになることを確認
- 人間(黒)の番に、WebMCP経由で `color:"black"` を明示してエージェントが横取り着手を試みるとエラーになることを確認(修正前は実際にこの横取りが成功してしまうことを確認した上で、修正後にブロックされることを検証した)

## 未検証

- 人間 vs 人間、エージェント vs エージェントの構成は仕様上選択できないよう変更済み(人間とエージェントが必ず1人ずつになる)。この制約自体はUI上(ドロップダウンが単一選択になっている)確認済みだが、あらゆる操作順序での回避可否までは網羅的に検証していない

## 外部AIエージェントからの接続方法

WebMCPの仕様自体は「ページがツールを登録する」ところまでしか定義しておらず、それを**ブラウザの外にいる実際のMCPクライアント(Claude Code、Claude Desktopなど)にどう見せるかはブラウザ実装依存**とされている。`document.modelContext.registerTool()` で登録しただけでは、Claude Codeのような外部のMCPクライアントには何も見えない。ブラウザタブ内のツールと外部の実MCPプロトコル(stdio/JSON-RPC)の間に橋渡しが必要。

### 橋渡し役: `chrome-devtools-mcp`

Googleが公式に公開しているMCPサーバー([npmパッケージ](https://www.npmjs.com/package/chrome-devtools-mcp)、本来はブラウザ操作・デバッグ用)に、実験的な **WebMCPカテゴリ**が追加されており、これが橋渡しを担う。

- `list_webmcp_tools` — 今見ているページが公開しているWebMCPツール一覧を取得
- `execute_webmcp_tool` — `toolName` + JSON文字列の `input` を渡してツールを実行

有効化には `--categoryExperimentalWebmcp`(`--category-experimental-webmcp`)フラグが必要。Chrome側は150以降で `--enable-features=WebMCP` が必要とされる(Canaryで `chrome://flags` から有効化していれば同じ機能フラグが立っている)。

上記2つはWebMCPカテゴリ限定のツールだが、実際に使う際は`chrome-devtools-mcp`が標準で持つ以下のツールも合わせて使うことになる。

- `list_pages` — 接続中のChromeで開いているタブ(ページ)の一覧を取得する。`list_webmcp_tools` / `execute_webmcp_tool` は「今選択されているページ」に対して動くため、複数タブが開いている場合はまずこれで対象のページ(オセロなら`http://localhost:3000/`など)を確認する
- `select_page` — `list_pages` で得たページIDを指定して、以降のツール呼び出しの対象ページを切り替える(タブが1つしかない/既に対象タブが選択されていれば不要)

`--autoConnect`(`--auto-connect`)経由でChromeに新規接続する場合、最初に`list_pages`のような何らかのツールを呼んだタイミングでChrome側に接続許可(Allow remote debugging?)ダイアログが表示される(詳細は後述のセットアップ手順を参照)。

### MCPサーバーの一般的な仕組み(補足)

`chrome-devtools-mcp` は常駐させておくデーモンではなく、**MCPクライアントが必要なときに自動で子プロセスとして起動し、標準入出力(stdio)でJSON-RPCを喋るだけのコマンドラインプログラム**。単体でターミナルに打っても入力を待ち続けるだけで何も起きない。実運用は必ずMCPクライアント側の設定(`mcpServers` に「必要になったらこのコマンドを実行して」と書くだけ)を通して行う。設定ファイルの置き場所はクライアントごとに違うが(Claude Desktopなら`claude_desktop_config.json`、Cursorなら`.cursor/mcp.json`など)、中身の形はほぼ共通:

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

HTTP経由で使いたい特殊な事情がある場合は `mcp-proxy` で包んでHTTPサーバー化することも可能(`mcp-proxy --transport streamablehttp --port 8080 -- npx -y chrome-devtools-mcp@latest`)だが、今回の用途では不要。

### セットアップ手順

1. Chromeで `chrome://inspect/#remote-debugging` を開き、リモートデバッグ接続を許可する(一度だけ)。有効にすると `Server running at: 127.0.0.1:9222` と表示される
2. オセロのページ(`index.html`)をそのChrome Canaryで開いた状態にしておく
3. MCPクライアント(Claude Code)にサーバーを登録する(実施済み、下記コマンド)

```bash
claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest --category-experimental-webmcp --auto-connect --channel canary
```

→ `~/.claude.json` にユーザースコープで登録済み、`claude mcp list` で `✔ Connected` を確認済み。**新しいClaude Codeセッションから有効**(登録後に同じセッション内では読み込まれない)。

4. 新しいセッションで `list_webmcp_tools` を呼び、`get_game_state` / `make_move` / `new_game` が見えるか確認 → `execute_webmcp_tool({toolName:"make_move", input:'{"row":2,"col":3}'})` のように実行

**実際に確認できた接続時の挙動**: 新しいセッションで最初にchrome-devtools-mcpのツール(`list_pages`)を呼んだタイミングで、Chrome側に「Allow remote debugging? / An external app wants full control over this Chrome session to debug it.」という許可ダイアログが表示された。これは`chrome://inspect/#remote-debugging`を有効にしていても、実際に外部ツールが接続してくるたびに(セッションごとに)ユーザーの明示的な許可(Allow)が必要ということ。Claude Code側からこのダイアログを操作する手段はない(MCPツール呼び出しのみでブラウザUIを直接クリックする権限は持たない)ため、**ユーザー自身がChrome側でAllowを押す必要がある**。

### 注意点

- 上記はすべて **experimental**(フラグ名に `Experimental` と入っている通り、仕様・挙動とも変わりうる)
- `chrome-devtools-mcp` は「今アクティブなタブ」に対して動く前提のため、オセロのページをタブとして開いておく必要がある
- **`--auto-connect` は `--channel` を指定しないとデフォルトで安定版(stable)Chromeのプロファイルを探しにいく。** Chrome Canaryに繋ぎたい場合は必ず `--channel canary` を付けること。付け忘れると `Could not find DevToolsActivePort for chrome at ~/.config/google-chrome/DevToolsActivePort`(安定版のプロファイルパス)というエラーになる(実際に遭遇して特定済み)
- MCPサーバーの設定(`~/.claude.json`)を変更しても、**それを読み込んだ後に起動したClaude Codeセッションにしか反映されない**。設定変更後は新しいセッションを開始すること
- もう一つの経路として、将来的にChrome自体に組み込まれるAIアシスタントがユーザー操作なしにWebMCPツールを直接使う、というシナリオもspec上想定されているが、これは「Claude CodeのようなMCPクライアントから明示的に繋ぐ」用途とは別物

## 参考リンク

- [WebMCP仕様 (W3C Draft Community Group Report)](https://webmachinelearning.github.io/webmcp/)
- [webmachinelearning/webmcp (GitHub)](https://github.com/webmachinelearning/webmcp)
- [WebMCP is available for early preview (Chrome for Developers Blog)](https://developer.chrome.com/blog/webmcp-epp)
- [Debug WebMCP tools (Chrome DevTools ドキュメント)](https://developer.chrome.com/docs/devtools/application/webmcp)
- [ChromeDevTools/chrome-devtools-mcp (GitHub)](https://github.com/ChromeDevTools/chrome-devtools-mcp)
