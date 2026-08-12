# オセロ (Othello) - WebMCP対応版

WebMCP (Web Model Context Protocol) を使って、外部のAIエージェントが対局を操作できるオセロ実装。Three.jsによる3D盤面と、Van.jsによるフローティングUIを持つ。

## 技術スタック

- **Three.js**(3D描画)+ **Vite**(ビルド/devサーバー)+ **Van.js**(軽量リアクティブUI)
- ゲームロジック(`src/othello.js`)とWebMCPツール登録(`src/webmcp.js`)を別ファイルに分離してある。`webmcp.js` は `othello.js` にのみ依存し、DOM描画やThree.jsのシーンには一切触れない。「外部のAIエージェントに何を公開しているか」を`webmcp.js`を読むだけで把握できるようにするため(ゲーム側からWebMCPへの依存は逆に問題ない)
- 刷新前の素のHTML/CSS/JS版(ビルド不要・`file://`でも動く実装)は `old/` ディレクトリにそのまま残してある

### ファイル構成

```
index.html          Viteのエントリ。#scene-container(3D描画先)と#overlay-root(UIオーバーレイ先)を用意するだけ
vite.config.js
src/
  main.js            engine/scene/ui/webmcpを初期化して繋ぐブートストラップ
  rules.js           盤面に対する純粋なルール(合法手判定・反転計算・石数集計)。状態を持たない
  othello.js         ゲームエンジン(盤面・ルール・状態)。DOM/Three.js/WebMCPに非依存。
                      状態を変更する関数は必ず内部でnotify()を呼ぶので、呼び出し側が再描画を呼び忘れることがない
  webmcp.js          WebMCPツール登録(get_game_state / make_move / new_game)。othello.jsのみに依存
  scene.js           Three.jsのシーン構築・盤と石の描画・raycastingによるクリック検知
  overlay.js         Van.jsで書く3D盤面上のフローティングUI(セットアップ帯/対局中HUD)
  style.css          ダーク基調のグローバルスタイル
  *.test.js          node --test で動くテスト(rules / othello / webmcp)。test-helpers.js はその小道具
old/                 刷新前の素のHTML/CSS/JS実装(参考用)
pi/                  ローカルLLM(pi)から対局させるためのMCP設定と手順書(AGENTS.md)
```

### セットアップ・起動

```bash
npm install
npm run dev
# 表示されるURL(通常 http://localhost:5173 )をブラウザで開く

npm test   # ゲームロジックと公開ツールのテスト(node --test、ブラウザ不要)
```

npm系のパッケージ(three / vanjs-core)をESMのbare specifierで読み込んでいるため、Viteのdevサーバー(または本番ビルド)を経由しない`file://`直開きはもう動かない。本番ビルドは `npm run build`(`dist/`に出力)、ビルド後の成果物確認は `npm run preview`。

## ゲーム仕様

- 標準的な8x8オセロのルール(合法手判定・石の反転・打てる場所がない場合の自動パス・両者パスで終局・石数勝敗判定)
- 黒(先手)・白(後手)それぞれについて「ユーザー」か「エージェント」かをセットアップ帯で選ぶ。ユーザー対エージェントのほか、ユーザー同士・エージェント同士の対局もできる
  - **ユーザー**: 3D盤面のマスをクリックして着手する(raycastingでどのマスかを判定)。その色の番のときだけ有効
  - **エージェント**: このアプリ自体には対戦用の思考ルーチンは組み込まれていない。「エージェント」= WebMCPツール経由で外部から操作される人・プログラムを指す。`make_move` には打つ色と `agentId` を明示させ、その色の番でなければエラーになる(詳細は下記)
  - 3D盤面は常時表示されており、その上にUIがフローティング表示される。対局前は**セットアップ帯**(黒・白それぞれのユーザー/エージェント選択+「対局開始」ボタン)、対局中・終局後は**HUD帯**(スコア・手番表示+「対局終了」ボタン)に切り替わる
  - 「対局開始」(またはWebMCPの `new_game` ツール)を押すまでは対局は開始されておらず、盤面クリックも `make_move` も無効。「対局終了」を押すといつでも(対局中でも終局後でも)盤面が初期化されセットアップ帯に戻る

### 手番の区別: 「ブラウザUIから打つ」 vs 「WebMCP経由で打つ」

WebMCPのツール呼び出しには呼び出し元を識別する仕組みが無いため、このアプリでは **「ブラウザUIのクリック = ユーザー」「WebMCPツール経由の呼び出し = エージェント」という運用上の前提**で区別し、その上で色ごとに `agentId` を発行している。

- ブラウザUIのクリックは、ユーザーに割り当てられた色の番のときだけ有効(ボタンが押せる状態になる)
- 対局開始時に、エージェントが担当する色ごとに4桁の16進数の `agentId` を生成してHUDに表示する。`make_move` は `color` と `agentId` の両方を必須にしており、**その色をエージェントが担当していない・`agentId` が一致しない・その色の番でない場合はエラーを返す**。これにより、エージェントが他方の色を横取りして着手することはできない(エージェント同士の対局で互いの手番を侵さないのも同じ仕組み)
- `get_game_state` は `players` を種別(`human` / `agent`)だけに潰して返し、`agentId` はどこにも含めない。ツール経由で他方のIDを引き出すことはできない
- ただしこれは暗号的な認証ではない。`agentId` は画面に表示してユーザーが口頭で伝える運用なので、画面を見られる相手には隠せない

### 公開しているWebMCPツール

| ツール名 | 内容 |
|---|---|
| `get_game_state` | 石のあるマス(`discs`)・手番・合法手(`legalMoves`)・スコア・直前の手(`lastMove`)・プレイヤー割り当て(黒/白それぞれユーザーかエージェントか)・対局開始済みか(`gameStarted`)・対局状況をJSONで返す(読み取り専用)。マスはすべて `a1`〜`h8` の表記 |
| `make_move` | `{square, color, agentId}` を指定して石を置く。`square` は `a1`〜`h8`。対局未開始・その色をエージェントが担当していない・`agentId` 不一致・その色の番でない・非合法手の場合はエラーを返す。成功時もエラー時も応答に着手後(またはその時点)の局面が丸ごと入るので、続けて `get_game_state` を呼ぶ必要はない |
| `new_game` | セットアップ帯で選択中の担当を確定させて対局を開始する(ブラウザの「対局開始」ボタンと同じ処理) |

## エージェント向けインターフェースの設計指針

WebMCPツールの形は、ローカルLLM(pi + qwen3.6-27b)に実際に対局させ、失敗した箇所を見て決めている。以下は2026-08-12時点の判断とその根拠。

### 座標系は一つだけにする

マスは `a1`〜`h8` だけで表す(`a`〜`h` が列で `a` が左端、`1`〜`8` が行で `1` が最上段)。`discs` / `legalMoves` / `lastMove` / `make_move` の引数がすべて同じ表記。

盤面を `a1`〜`h8` で見せながら `make_move` は0始まりの `{row, col}` で受けていた頃、モデルは毎回2つの座標系を変換していて、そこで非合法手を撃っていた。row/col はゲームと無関係な −1 の暗算を強いるだけで何の役にも立っていない。エンジン内部は row/col のままで、変換は `src/webmcp.js` の境界1箇所に閉じている。

### 探索は肩代わりする、評価は肩代わりしない

`legalMoves` は常に渡す。反転する石の数や位置、着手可能数といった「その手を打つとどうなるか」は渡さない。

「どこに置けるか」は探索問題、「どこに置くべきか」は評価問題で、オセロの中身は後者にしかない。前者を課題として残すと、小さいモデルは探索で力尽きて評価に到達せず、大きいモデルには自明なだけで、どちらにとっても価値がない。以前は合法手を渡すかどうかを選べたが、難易度調整として機能していなかったので廃止した。

反転数を渡さないのは、それだけを渡すと「最も多く返る手」を選ぶ方向に働くため。序中盤に石数を増やすのはオセロでは典型的な悪手なので、渡さない場合より弱くなりうる。渡すなら着手可能数まで揃える必要があるが、そこまで行くと評価の肩代わりになる。

### 盤面は石のあるマスのリストで渡す

`discs: { black: ["d3","d4","d5","e4"], white: ["e5"] }` の形。8x8のマス目配列も、文字で描いた盤面図も渡さない。並びは列優先(a1,a2,…,b1,…)。

- マス目配列(`[["empty","empty","black",…], …]`)は、モデルが「何番目の要素が d 列か」を数え直すことになる。実際にそこで手が止まっていた
- 盤面図(`3 . . . B W . . .`)は、桁を数えないとマスの名前が分からない。LLMは文字を数えるのが苦手で、しかも空白の連続はトークンとして不規則にまとまるため、セル数と文字位置が対応しない
- マス名のリストは、幾何を文字列の一致に変える。同じ列なら先頭の文字が同じ、斜めなら文字と数字が同時に ±1。列優先に並べるのは、縦方向の読み取りが一番あてにならないため
- 盤面図が必要ならモデルがリストから自分で組み立てる。その組み立て自体が盤面を把握する工程なので、完成品を渡して省略させない

### AGENTS.md には、ツール情報から読み取れることを書かない

`pi/AGENTS.md` はツールの description や inputSchema に書いてあることを繰り返さない。目的は**ツールのエラーと不要な呼び出しを減らすこと**であって、モデルの生成トークンやプロンプトを節約することではない。

ただしこの前提は、MCPクライアントがツール定義をモデルのコンテキストに載せている場合にしか成り立たない。プロキシ経由でツールを隠す構成では名前もスキーマもコンテキストに無く、AGENTS.md が唯一の情報源になってしまう(詳細は `pi.md`)。

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

`src/webmcp.js` では `document.modelContext` を優先し、なければ `navigator.modelContext` にフォールバックする両対応の実装にしてある(将来的な仕様変更やブラウザ差異への保険)。

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
- Three.js + Vite + Van.js への刷新後、`npm run dev` のViteサーバー上でも `document.modelContext.registerTool()` が問題なく動作し、`src/webmcp.js` から3ツールが登録されることを確認
- 3D盤面でのクリック(raycastingによるマス判定)が合法手判定・石の反転・手番交代に正しく反映されることを確認
- WebMCPの `make_move` で着手した内容が3D盤面(石の追加・色変更・直前手のハイライトリング・合法手ヒットの再計算)にリアルタイムで反映されることを確認(`othello.js` の subscribe/notify によりUIとWebMCPが同じ状態変更経路を通るため、再描画の呼び忘れが構造的に起きない)
- 「対局終了」ボタンで対局中・終局後どちらからでもセットアップ帯に戻り、盤面が初期化されることを確認

## 未検証

- 黒・白の両方をエージェントにした対局は、ツールのテストでは確認しているが、外部のMCPクライアントを2つ繋いだ通しの動作は検証していない
- マスの表記を `a1`〜`h8` に変えた後の実機での対局は、まだ通していない
- カメラワーク(対局開始時の演出、操作に応じた視点変更)は未実装。現状は固定カメラのみ

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
2. `npm run dev` でViteのdevサーバーを起動し、表示されたURL(通常 `http://localhost:5173`)をそのChrome Canaryで開いた状態にしておく
3. MCPクライアント(Claude Code)にサーバーを登録する(実施済み、下記コマンド)

```bash
claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest --category-experimental-webmcp --auto-connect --channel canary
```

→ `~/.claude.json` にユーザースコープで登録済み、`claude mcp list` で `✔ Connected` を確認済み。**新しいClaude Codeセッションから有効**(登録後に同じセッション内では読み込まれない)。

4. 新しいセッションで `list_webmcp_tools` を呼び、`get_game_state` / `make_move` / `new_game` が見えるか確認 → `execute_webmcp_tool({toolName:"make_move", input:'{"square":"d3","color":"black","agentId":"F4CA"}'})` のように実行(`agentId` は対局開始時にHUDに表示される)

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
