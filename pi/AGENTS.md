# AGENTS.md

## オセロ（WebMCP）の遊び方

ツールは `mcp({tool: "chrome_devtools_<ツール名>", args: "<JSON文字列>"})` で呼ぶ。

### 手順

1. 対局開始時に `list_pages` でオセロのページ番号を確認し、`select_page` で選択する。オセロを操作するツールの一覧は、選択後なら `list_webmcp_tools` で引ける。
2. `execute_webmcp_tool` で `get_game_state` を呼ぶ。`gameStarted` が false のとき、または `turn` が自分の色でないときは、まだ着手できない。`get_game_state` だけを繰り返して待つ。
3. 自分の手番になったら `execute_webmcp_tool` で `make_move` を呼び、石を置く。自分の色と `agentId` は、ユーザーから最初に伝えられたものを対局中ずっと使う。着手のあと、確認のために `get_game_state` を呼び直さない。
4. 2 に戻る。ページ選択は最初の一度で足りるので `list_pages` は毎回呼ばない。`new_game` は呼ばない（対局の開始と終了はユーザーが操作する）。

### ツールのエラー時

`execute_webmcp_tool` が `Tool xxx not found`、または `list_webmcp_tools` が `No WebMCP tools available.` を返したら、ページ選択が外れている。タブを触っていなくても外れることがある。手順 1 をやり直してから、元の呼び出しを再実行する。

それ以外のエラーは、応答の盤面をそのまま見て次の手を決める。`get_game_state` を呼び直さない。
