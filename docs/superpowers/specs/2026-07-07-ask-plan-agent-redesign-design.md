# Ask / Plan / Agent 3モード再設計 設計書

日付: 2026-07-07
ステータス: ユーザー承認済み設計（実装前）

## 目的

GitHub Copilot クレジット消費量計算ツールの対象機能を
**Ask モード / Plan モード / Agent モード** の3つに変更する。
従来の Chat / CLI / code review は廃止する。

- Ask: 1回のモデル呼び出し（推論・コンテキスト読み込み・応答が1ステップ）
- Plan / Agent: モデル呼び出しが自律的に複数回起こるエージェントループ。
  反復回数・サブエージェント数を含めて近似計算する
- UI は画面幅に自動調整（レスポンシブ）し、Apple のサイトのような
  スタイリッシュなライト基調デザインに刷新する

## 決定事項（ユーザー確認済み）

1. Plan/Agent の反復回数・サブエージェント数は
   **プリセット（タスク規模: 軽微/中規模/大規模）＋詳細調整で上書き可**
2. カラーテーマは **ライト基調**（apple.com 風: #f5f5f7 背景・白カード・#0071e3 アクセント）
3. **モデル別比較表は残す**（全モード共通で表示）
4. 計算アプローチは **案A: 反復シミュレーションモデル** を採用

## 計算ロジック

### 共通エンジン `estimateAgenticTokens`（Plan/Agent 共用・純粋関数）

| パラメータ | 意味 |
|---|---|
| `baseContextTokens` (C0) | 初回送信コンテキスト = モードオーバーヘッド + プロンプト + 参照情報 |
| `iterations` (N) | モデル呼び出し回数（ツール呼び出しラウンド数）。最小1にクランプ |
| `growthPerIterationTokens` (G) | 1反復ごとに追加される量（ツール実行結果＋前回出力） |
| `outputPerIterationTokens` (O) | 1反復あたりの出力（思考・ツール呼び出し指示） |
| `finalOutputTokens` (F) | 最終成果物の出力（Plan=計画書、Agent=コード＋説明） |
| `subagents` (S) | サブエージェント数。各1体を小型の同型ループとして計算し合算 |

反復ごとの動き:

- 1回目: C0 をキャッシュ書き込み、出力 O
- i回目 (i≥2): 蓄積済み `C0+(i-2)·G` はキャッシュ読み込み、
  新規増分 G はキャッシュ書き込み、出力 O
- 最終回に F を追加出力

閉形式の集計:

```
cacheWriteTokens  = C0 + (N-1)·G
cachedInputTokens = (N-1)·C0 + G·(N-1)(N-2)/2
outputTokens      = N·O + F
inputTokens       = 0（エージェントループでは全入力がキャッシュ経由）
```

サブエージェント分は S 体それぞれを固定小型ループ
（既定: N=6, C0=3,000＋メイン参照トークン×0.5, G=3,000, O=800, F=0）として
同エンジンで計算し合算する。

### calculator の修正: cacheWrite 単価なしモデルの扱い

`cacheWrite: null` のモデル（OpenAI / Google / GitHub / Microsoft）は
現行実装ではキャッシュ書き込みが 0 クレジット計算になる。
**`cacheWrite` 単価が無いモデルはキャッシュ書き込みトークンを通常 input 単価で課金**
するよう `calculateCredits` を修正する（実態に合致）。

### Ask モード

1回呼び出し。入力項目:

- プロンプト本文（テキスト → トークン推定）
- 参照テキスト / 添付ファイル（種別 + KB）
- **何回目のやり取りか (T)** — 2つを同時に駆動する:
  - 履歴トークン: `(T-1) × 平均ターンサイズ` を入力に加算
    （平均ターンサイズ = ユーザー500文字＋アシスタント1,000文字を
    `estimateHistoryTokens` で換算。現行実装の既定値を踏襲）
  - キャッシュ率: T=1→0%, T=2→25%, T=3〜4→35%, T≥5→50%
    （参照情報＋履歴に適用）
- 想定回答文字数 → 出力トークン

従来の `cacheScenario` セレクトは廃止し「何回目か」1入力に統合する。

### Plan / Agent モードのプリセット（暫定値・要較正）

| モード | 規模 | N | G | O | F | サブエージェント |
|---|---|---|---|---|---|---|
| Plan | 軽微 | 4 | 3,000 | 300 | 2,000 | 0 |
| Plan | 中規模 | 8 | 4,000 | 400 | 4,000 | 0 |
| Plan | 大規模 | 14 | 5,000 | 500 | 8,000 | 2 |
| Agent | 軽微 | 6 | 3,000 | 800 | 1,000 | 0 |
| Agent | 中規模 | 15 | 4,000 | 1,000 | 1,500 | 1 |
| Agent | 大規模 | 30 | 5,000 | 1,200 | 2,000 | 3 |

モードオーバーヘッド（system prompt + tool definitions、暫定）:
Ask=1,500 / Plan=4,000 / Agent=6,000 tokens。

プリセットは `EXPERIMENTAL_AGENTIC_PRESETS` として rates.js に定義し、
`// 要確認（暫定値）` コメントを付ける。実測データ取得後に較正する。
詳細調整 UI（折りたたみ）で N / G / O / F / サブエージェント数を上書きできる。

### 削除するもの

- `calculateCodeReviewCredits` / `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE`
- `buildChatCliTokens` / `estimateCacheHitRatio` / CLI 関連
  （`buildAskTokens` に置換）

## UI 設計

### レイアウト

- ヒーロー部: 大きな見出し（clamp 28→48px）＋グレーのサブコピー
- モード切替: iOS 風セグメンテッドコントロール（radio＋ラベルのピル UI、
  選択中は白背景＋影）。`<select>` は廃止
- モード説明カード: 選択モードの動作を1〜2行で説明
- 入力カード（白・角丸18px・淡い影）:
  - 共通: モデル選択 / プロンプト / 参照テキスト / 添付ファイル
  - Ask のみ: 何回目のやり取りか・想定回答文字数
  - Plan/Agent のみ: タスク規模セグメント（軽微/中規模/大規模）＋
    `<details>` の詳細調整（N/G/O/F/サブ数）
  - 計算ボタン: ピル型ブルー（#0071e3, border-radius: 980px）
- 結果カード: 消費クレジットを特大表示（clamp(2.5rem, 6vw, 4rem)）、
  USD 併記、内訳表（入力/キャッシュ読み/キャッシュ書き/出力）、
  Plan/Agent では反復数・サブエージェント数の前提も表示
- モデル別比較カード: 全登録モデルの比較表（従来同様、provider 表示付き）

### Apple 風スタイル

- 背景 #f5f5f7、カードは白・角丸18px・`box-shadow: 0 4px 24px rgba(0,0,0,.06)`
- フォント: `-apple-system, "SF Pro JP", "Hiragino Sans", "Yu Gothic UI", sans-serif`
- 見出し `font-weight: 700` + `letter-spacing: -0.02em`
- 入力欄は角丸12px・フォーカス時ブルーリング

### レスポンシブ

- コンテナ: `max-width: 980px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 40px)`
- 入力カード内: `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`
  → 狭幅で自動1カラム化
- タイポグラフィは `clamp()` で画面幅に追従
- 比較表は狭幅時に横スクロール（`overflow-x: auto`）

### 入力項目の変更

- 添付ファイル種別に「ソースコード / フォルダ（合計KB）」を追加
  （約300 tokens/KB。ディレクトリ参照の要件に対応）
- code review フォーム・CLI チェックボックスは削除

## モジュール構成の変更

| ファイル | 変更 |
|---|---|
| `src/rates.js` | `MODEL_RATES` 不変。`FEATURE_OVERHEAD_TOKENS` を `{ ask, plan, agent }` に変更。code review 係数を削除。`EXPERIMENTAL_AGENTIC_PRESETS` と `ASK_TURN_CACHE_RATIOS` を追加 |
| `src/tokenizer.js` | `FILE_TOKENS_PER_KB` に `code`（~300 tokens/KB）を追加。他は現状維持 |
| `src/calculator.js` | `calculateCredits` に cacheWrite 単価なし→input 単価フォールバック。`estimateAgenticTokens` / `buildAskTokens` / `buildAgenticTokens` を追加。`buildChatCliTokens` / `estimateCacheHitRatio` / `calculateCodeReviewCredits` を削除 |
| `src/ui.js` | 全面書き換え（DOM 操作のみ、純粋関数を持たない原則は維持） |
| `index.html` | 全面書き換え（Apple 風・レスポンシブ） |
| `tests/*.test.js` | 削除機能のテスト除去。エンジン・Ask・フォールバックのテスト追加 |
| `build.js` | dist 生成ガードを新 UI（3モード・プリセット）向けに更新 |
| `CLAUDE.md` / `README.md` | 機能一覧・計算ロジック・較正対象の記述を更新 |

## エラー処理・境界条件

- `iterations` は最小1にクランプ（N=1 ならキャッシュ読み0）
- 詳細調整の数値入力は負値・非数を 0 または最小値に丸める
- 未知モデルキーは従来通り throw（既存テスト挙動を維持）

## テスト方針

- 純粋関数（tokenizer / calculator）は Jest 必須、UI は手動確認（従来方針）
- エンジン集計式は閉形式なので手計算した固定期待値で検証:
  - N=1 境界（キャッシュ読み0・書き込み C0 のみ）
  - キャッシュ累積式（(N-1)C0 + G(N-1)(N-2)/2）
  - サブエージェント合算
  - `buildAskTokens`: T=1 で履歴0・キャッシュ0%
  - `cacheWrite: null` モデルの input 単価フォールバック
- `npm test` 全緑 → `npm run build` → `dist/index.html` を手動確認

## スコープ外

- Copilot cloud agent / プラン比較 / チーム予算管理（従来通り）
- プリセット係数の実測較正（実装後の別フェーズ）
- ダークモード対応
