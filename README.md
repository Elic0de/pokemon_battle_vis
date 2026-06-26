# Friend Battle for PTCG AI

Kaggle提出形式の `submission.tar.gz` をアップロードするだけで、友達のAgent同士をローカル対戦できます。

今の版は、Flask UI + SQLite + background worker 構成です。

```txt
submission.tar.gz upload
  ↓
Agent登録
  ├─ Battle Now: 最優先ジョブとして投入
  ├─ Self Check: アップロードされたAgentを同じAgent同士で動作確認
  └─ Auto League: 既存Agentとの低優先度ジョブを自動投入
  ↓
Workerが priority 順に対戦
  ↓
履歴・replay JSONL・Eloを保存
  ↓
外部VisualizerへPOSTして表示
```

## 起動

```bash
cd friend_battle
pip install -r requirements.txt
python app.py
```

開く:

```txt
http://127.0.0.1:5000
```

## できること

- `submission.tar.gz` / `.tgz` をブラウザからアップロード
- アップロードされたAgentを自動登録
- Battle Nowでアップロード直後に最優先対戦
- アップロードされたAgentを同じAgent同士でSelf Check
- Auto Leagueで既存Agentから最大5個を選び、自動で対戦ジョブ投入
- Flaskプロセス内のbackground workerが priority 順に実行
- Jobs画面で queued / running / done / failed を確認
- Ranking画面で Elo / 総勝率 / 先攻勝率 / 後攻勝率 / 直近20戦を確認
- Runs画面で対戦履歴を確認
- 各gameの `visualize_data` を `https://ptcgvis.heroz.jp/Visualizer/Replay/0` へブラウザPOSTして表示

## submission.tar.gz の想定

root直下、または任意のサブディレクトリに、以下が同じ階層で入っていればOKです。

```txt
main.py
deck.csv
```

例:

```txt
submission.tar.gz
  main.py
  deck.csv
```

または

```txt
submission.tar.gz
  submission/
    main.py
    deck.csv
```

アップロード時に `deck.csv` が60行か検査します。


## Battle Now / Self Check / Auto League

アップロード画面では3種類の投入を選べます。

```txt
Battle Now
  priority=0
  今すぐ見たい対戦。実行中ジョブがなければすぐrunningになります。

Self Check
  priority=1
  アップロードされたAgentを同じAgent同士で回す動作確認ジョブ。
  デフォルト2戦だけ回し、import error / deck不正 / illegal action / max_steps / replay生成失敗を検出します。
  失敗したAgentは `failed` にし、queued中のAuto Leagueジョブを止めます。

Manual
  priority=5
  Dashboardから手動投入する通常ジョブ。

Auto League
  priority=10
  アップロード後に既存Agentと自動で組まれる低優先度ジョブ。
```

Workerは以下の順でジョブを拾います。

```sql
ORDER BY priority ASC, created_at ASC
```

つまり、`submission.tar.gz` をアップロードしてBattle NowをONにすると、Auto Leagueより先に処理されます。
すでに別の対戦がrunning中の場合は中断せず、その次に実行されます。

## 自動対戦の設定

環境変数で調整できます。

```bash
IMMEDIATE_MATCH_GAMES=10 \
SELF_CHECK_GAMES=2 \
AUTO_MATCH_GAMES=20 \
AUTO_MATCH_OPPONENTS=5 \
FRIEND_BATTLE_MAX_STEPS=2000 \
python app.py
```

| 変数 | 意味 | デフォルト |
|---|---:|---:|
| `AUTO_MATCH_ENABLED` | upload後の自動ジョブ投入。`0`でOFF | `1` |
| `SELF_CHECK_ENABLED` | upload後のSelf Check。`0`でOFF | `1` |
| `IMMEDIATE_MATCH_GAMES` | Battle Nowの初期試合数 | `10` |
| `SELF_CHECK_GAMES` | Self Checkの試合数 | `2` |
| `AUTO_MATCH_GAMES` | 自動対戦の試合数 | `20` |
| `AUTO_MATCH_OPPONENTS` | 新Agentが戦う既存Agent数 | `5` |
| `FRIEND_BATTLE_MAX_STEPS` | 1試合の最大step | `2000` |
| `FRIEND_BATTLE_SWAP` | 先後入れ替え。`0`でOFF | `1` |
| `FRIEND_BATTLE_WORKER` | background worker。`0`でOFF | `1` |
| `FRIEND_BATTLE_ELO_INITIAL` | Elo初期値 | `1500` |
| `FRIEND_BATTLE_ELO_K` | Elo更新K値 | `32` |


## Ranking / Elo

ジョブが完了すると、replay JSONLを読み、1ゲームごとにEloを更新します。

- 初期Elo: `1500`
- K値: `32`
- 勝ち: `1.0`
- 負け: `0.0`
- 引き分け: `0.5`

Ranking画面では以下を表示します。

```txt
Rank | Agent | Elo | Games | W-L-D | First | Second | Last20
```

`First` / `Second` は replay に保存された `first_player` を使って集計します。古いreplayなどで先攻情報が無いゲームは、総合勝敗とEloには入りますが、先後別勝率には入りません。

二重加算防止のため、Elo更新済みゲームはSQLiteの `elo_games` テーブルに `run_id + game_index` で保存します。

## 外部VisualizerへPOST

Runs → run詳細 → gameごとの「Visualizer」を押すだけです。

内部ではブラウザが以下へPOSTします。

```txt
POST https://ptcgvis.heroz.jp/Visualizer/Replay/0
field: json
value: visualize_data
```

変更したい場合だけ環境変数を使います。

```bash
VISUALIZER_POST_URL='https://ptcgvis.heroz.jp/Visualizer/Replay/0' \
VISUALIZER_FIELD=json \
python app.py
```

## 手動ジョブ投入

DashboardからAgent A/Bを選んでQueueに入れられます。

```txt
Agent A
Agent B
Games
Max steps
Job type: Immediate / Manual / Auto
Swap
[Queueに入れる]
```

`Immediate` を選ぶと `priority=0`、`Self Check` を選ぶと `priority=1` で投入されます。Self Checkは同じAgentをA/Bに選んだ場合だけ投入できます。

同期実行ではなく、Queueに入り、workerが順番に実行します。

## CLIだけで対戦する場合

Flaskを使わずに直接実行できます。

```bash
python tools/friend_battle.py \
  --agent0 agents/me \
  --agent1 agents/friend \
  --games 10 \
  --swap
```

replay JSONLからVisualizerへPOSTするCLI:

```bash
python tools/post_replay.py \
  --replay replays/friend_battle.jsonl \
  --game 0 \
  --url 'https://ptcgvis.heroz.jp/Visualizer/Replay/0' \
  --field json
```

## ディレクトリ

```txt
friend_battle/
  app.py
  history.db                 # 自動生成
  agents/
    me/
      main.py
      deck.csv
    friend/
      main.py
      deck.csv
    uploaded-agent-xxxxxxxx/  # upload後に自動生成
  uploads/                   # upload archive保存。自動生成
  replays/jobs/              # job replay保存。自動生成
  runs/                      # run summary保存。自動生成
  tools/
    friend_battle.py
    post_replay.py
    history.py
```

## 注意

`submission.tar.gz` の `main.py` はローカルでPython実行されます。友達大会や自分の検証向けの簡易ツールなので、信頼できる相手のAgentだけアップロードしてください。
