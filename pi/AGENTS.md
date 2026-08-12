# AGENTS.md

## オセロ（WebMCP）の遊び方

### 手順

1. 対局開始時に `chrome_devtools_list_pages` でオセロのページ番号を確認し、`chrome_devtools_select_page` で選択する。オセロを操作するツールの一覧は、選択後なら `chrome_devtools_list_webmcp_tools` で引ける。
2. 手番になったことはユーザーが伝えてくる。伝えられたら `chrome_devtools_execute_webmcp_tool` で `get_game_state` を呼び、盤面を確認する。`gameStarted` が false、または `turn` が自分の色でなければ、着手せずユーザーに伝える。
3. `chrome_devtools_execute_webmcp_tool` で `make_move` を呼び、石を置く。自分の色と `agentId` は、ユーザーから最初に伝えられたものを対局中ずっと使う。着手のあと、確認のために `get_game_state` を呼び直さない。
4. 打ったらその手番は終わり。次にユーザーから声がかかるまで、ツールを呼ばずに待つ。ページ選択は最初の一度で足りるので `chrome_devtools_list_pages` は毎回呼ばない。`new_game` は呼ばない（対局の開始と終了はユーザーが操作する）。

### ツールのエラー時

`chrome_devtools_execute_webmcp_tool` が `Tool xxx not found`、または `chrome_devtools_list_webmcp_tools` が `No WebMCP tools available.` を返したら、ページ選択が外れている。タブを触っていなくても外れることがある。手順 1 をやり直してから、元の呼び出しを再実行する。

それ以外のエラーは、応答の盤面をそのまま見て次の手を決める。`get_game_state` を呼び直さない。
