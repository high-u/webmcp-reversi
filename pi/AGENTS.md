# AGENTS.md

## オセロ（WebMCP）の遊び方

ツールは `mcp({tool: "chrome_devtools_<ツール名>", args: "<JSON文字列>"})` で呼ぶ。

### 操作ツール

オセロを操作するツールの一覧は `list_webmcp_tools` で引ける。

### 手順 

1. 対局開始時に `list_pages` でオセロのページ番号を確認し、`select_page` で選択する。
2. 自分の手番になったら `execute_webmcp_tool` で `get_game_state` を呼び、盤面を確認する。
3. `execute_webmcp_tool` で `make_move` を呼び、自分の石を置く。更新後の盤面がそのまま返る。
4. 次の手番は 2 に戻る。ページ選択は最初の一度で足りるので `list_pages` は毎回呼ばない。

登録ツール（`get_game_state` / `make_move` / `new_game`）の一覧は `list_webmcp_tools` で引ける。

### ツールのエラー発生時

`execute_webmcp_tool` が `Tool xxx not found`、または `list_webmcp_tools` が `No WebMCP tools available.` を返したら、ページ選択が外れている。手番の間隔が空いて MCP 接続が再確立されると、タブを触っていなくても選択が先頭ページに戻ることがある。手順 1 をやり直してから、元の呼び出しを再実行する。

