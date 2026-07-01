# GitHub Copilot クレジット消費量計算ツール

GitHub Copilot のクレジット消費量を事前に見積もるためのスタンドアロン Web ツールです。  
GitHub Copilot は 2026/6/1 に premium request 方式の課金を廃止し、トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）に移行しました。
プロンプト・添付ファイル・使用モデルを入力するだけで、**Copilot Chat / Copilot CLI / Copilot code review** の3機能について、1リクエスト（Chat/CLI）または1PR（code review）あたりのクレジット消費量を算出し、モデル間の比較も行えます。

> チーム単位の予算管理・プランティア適合判定、Copilot cloud agent（GitHub Actions minutes 消費含む）はスコープ外です。

---

## エンドユーザー向け: 使い方

### 1. ツールを開く

`dist/index.html` をダブルクリックしてブラウザで開く。  
インターネット接続・インストール不要。

### 2. 入力する

**機能を選択:** Copilot Chat / Copilot CLI / Copilot code review

**Chat / CLI の場合:**

| 項目 | 説明 |
|---|---|
| 使用モデル | 登録済みモデルから使用予定のものを選択（provider別にグルーピング表示） |
| プロンプト・指示文 | 実際に送信するプロンプトをそのまま貼り付ける |
| 参照コード・設計書（テキスト） | コピー&ペーストするコードや設計書テキスト |
| 添付ファイル | ファイル種別とサイズ(KB)を入力（複数可、参考値。精度を上げたい場合は本文をテキスト欄へ貼り付け） |
| 今回のリクエストに含める過去会話ターン数 | 今回の1回のリクエストに含める、直前までの会話ターン数 |
| 想定回答文字数 | 生成されるコード・文章の概算量 |
| キャッシュ入力割合 | 同一コンテキストを繰り返す場合は % を設定 |

※ system prompt・tool definitions 等の見えない文脈分は、機能ごとの概算オーバーヘッドとして自動加算されます。

**code review の場合:** モデルは GitHub 側で自動選択されるため選択欄はなく、変更行数（diff行数）のみ入力します。

### 3. 結果を確認する

- **消費クレジット・概算金額 (USD)**: 1リクエスト（Chat/CLI）または1PR（code review）あたりの消費量
- **モデル別比較表**（Chat/CLIのみ）: 登録済みモデルすべてのコストを昇順で比較

### 4. 事務局申請に活用する

計算結果を「事前見積もり提出フォーマット」に記載し、事務局に申請してください。

---

## 代表シナリオ（試してみる）

実際の数値（クレジット・USD）は `src/rates.js` の単価改定に応じて変わるため、本READMEには記載しません。
下記の入力例をそのままツールに入力し、実際の画面で結果を確認してください。

### シナリオ1: Chat でユニットテスト自動作成を依頼する

1. 機能: **Copilot Chat**
2. 使用モデル: **Claude Sonnet 5**（例。実際に使う予定のモデルに置き換えてよい）
3. プロンプト・指示文: 「このモジュールのユニットテストを作成してください。エッジケースも含めてください。」
4. 参照コード・設計書（テキスト）: テスト対象のソースファイル本文を貼り付ける、または添付ファイルとして Markdown/テキスト 20〜50KB 程度を追加
5. 今回のリクエストに含める過去会話ターン数: **0**（新規スレッドを想定）
6. 想定回答文字数: 生成されるテストコードの概算文字数（例: 1500）
7. キャッシュ入力割合: **0%**（初回リクエストを想定）
8. 「クレジット消費量を計算する」をクリックし、消費クレジット・USD・内訳・モデル比較表を確認する

### シナリオ2: code review で ~200行の PR をレビューする

1. 機能: **Copilot code review**
2. 変更行数（diff行数）: **200**
3. 「クレジット消費量を計算する」をクリックし、`200 × EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE`（`src/rates.js` 参照）に基づく概算クレジットを確認する
4. `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` は実測データ取得前の暫定係数のため、算出結果もあくまで参考値である点に注意する

---

## 管理者・開発者向け

### 必要環境

- Node.js 20 以上（テスト・ビルド用。エンドユーザーには不要）
- Chrome / Edge / Firefox 100 以上

### セットアップ

```bash
npm install
```

### テスト

```bash
npm test
```

### 開発サーバー（ES modules 動作確認）

```bash
npx serve . -p 3000
```

ブラウザで `http://localhost:3000` を開く。

### 配布版ビルド

```bash
npm run build
```

`dist/index.html` が生成される。このファイル単体を配布する。

---

## クレジット単価の更新方法

GitHub Copilot の料金体系が改訂された場合は以下の手順で更新する。

1. [GitHub Copilot 公式ドキュメント](https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements) で最新単価を確認
2. `src/rates.js` を編集
   - `MODEL_RATES`: モデル別クレジット単価（4フィールド: input / cachedInput / cacheWrite / output）
   - `FEATURE_OVERHEAD_TOKENS`: Chat/CLI の見えない文脈分オーバーヘッド（実測較正が必要な暫定値）
   - `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE`: code review の diff行あたり暫定係数
3. `npm run build` を実行
4. `dist/index.html` を再配布

> Copilot code review は GitHub 側の内部処理・モデル選択が非公開のため、変更行数 × 暫定係数で概算します。この係数は実測データ取得後に更新してください。

---

## 対応モデル

登録済みモデルすべて（provider別: OpenAI / Anthropic / Google / GitHub / Microsoft）が選択可能です。モデルの追加・削除は `src/rates.js` の `MODEL_RATES` のみで管理されるため、本READMEではモデル数・一覧を固定で記載しません。最新の一覧はツール内のモデル選択欄（provider別グルーピング）を参照してください。

> 単価は暫定値です。公式ドキュメントで最新値を確認のうえ `src/rates.js` を更新してください。

---

## ファイルサイズ推定の注意

ファイルサイズ(KB)からのトークン推定は簡易概算です。Word / Excel / PowerPoint / PDF は圧縮・画像・メタデータ・数式・表構造の影響が大きく、実際にCopilotへ投入されるトークン量とは差が出る可能性があります。精度を上げる場合は、対象本文をテキスト欄へ貼り付けてください。

---

## ディレクトリ構成

```
/
├── dist/index.html      ← 配布ファイル（これだけ配る）
├── src/
│   ├── rates.js         ← 単価テーブル + feature overhead + code review係数（更新対象）
│   ├── tokenizer.js     ← トークン推定ロジック
│   ├── calculator.js    ← クレジット計算ロジック
│   └── ui.js            ← UI
├── tests/               ← Jest ユニットテスト
├── build.js             ← ビルドスクリプト
└── docs/scenarios/      ← (任意) シナリオ別シミュレーション結果
```

---

## ライセンス・連絡先

社内利用限定ツール。問い合わせは事務局まで。
