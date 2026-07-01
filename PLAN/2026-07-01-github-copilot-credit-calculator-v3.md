# GitHub Copilot クレジット消費量計算ツール 実装計画 v3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本文書は単独で完結する実装計画**です。旧計画書 `PLAN/2026-07-01-github-copilot-credit-calculator-v2.md` および `docs/superpowers/plans/2026-07-01-github-copilot-credit-calculator.md` を参照する必要はありません（旧文書は履歴として残されているのみで、更新されません）。

**Goal:** GitHub Copilot のクレジット消費量を事前見積もりできるスタンドアロン Web ツールをブラウザで動く単一 HTML ファイルとして構築する。対象は **Copilot Chat / Copilot CLI / Copilot code review** の3機能。個人が1リクエストあるいは1PRあたりの消費クレジット・ドル金額を事前確認できることに限定し、チーム単位の予算管理・プランティア判定は行わない。

## 背景（v2 からの前提修正）

GitHub Copilot は **2026/6/1 に premium request 方式の課金を廃止**し、**トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）**へ移行した（ユーザー提供スペックに基づく）。v2 まではこの新モデルに対応する一方で「チーム/プランティア適合判定」機能を追加していたが、ユーザーとの前提確認の結果、以下の通り**スコープを再修正**する。

- **単価は実値が判明済み**: OpenAI / Anthropic / Google / GitHub / Microsoft 計 20 モデルの `$ per 1,000,000 tokens` 単価（Input / Cached input / Cache write / Output）がユーザーから提供された。`src/rates.js` にこの実値を実装する（v2 の「7モデル暫定値」は使わない）。
- **チーム/プランティア機能は全廃**: 「シートあたり月間付与クレジット」「複数チーム単位の予算判定」という概念は本ツールのスコープ外とする。ツールは**消費クレジット・ドル金額の表示のみ**に単純化する。個人の月間上限に対する超過警告表示も行わない。
- **対象機能を拡大**: 従来の Chat 単体に加えて、
  - **Copilot Chat**: プロンプト・添付ファイル・会話履歴のトークン量とモデル単価から直接計算（従来通り）
  - **Copilot CLI**: Chat と同一の計算式を使う（`/context` 等で実測しやすく、係数キャリブレーションの基準にもなる）
  - **Copilot code review**: モデルをユーザーが選択できない（GitHub 側の調整済みモデルを使用）ため、PR の変更行数（diff行数）に経験係数を掛ける別ロジックで概算する
  を対象とする。
- **スコープ外機能**: Copilot cloud agent（セッション合計・GitHub Actions minutes 消費）、Code completions / Next edit suggestions（そもそも AI Credits 対象外）は本ツールでは扱わない。GitHub Actions minutes の見積もりも行わない（AI Credits のみを見積もる）。
- **ロングコンテキスト単価の自動判定**: GPT-5.4 / GPT-5.5（272K tokens超）、Gemini 3.1 Pro（200K tokens超）は入力トークン量に応じて単価が切り替わる。UI で手動選択させず、入力トークン合計から自動判定する。

**Architecture:** Vanilla JS の ES モジュール群（rates → tokenizer → calculator → ui）をパイプライン化し、Node.js + Jest でコアロジックを TDD、完成後に index.html に統合してブラウザ単体で動作させる。外部サーバー・ビルドツール不要。

**Tech Stack:** HTML5, Vanilla JavaScript (ES2022 modules), CSS3, Node.js 20+ (テスト専用), Jest 29

## Global Constraints

- 外部 CDN・ライブラリへの依存ゼロ（HTML をダブルクリックで起動、オフライン動作）
- 日本語 UI（ラベル・エラーメッセージ・ヘルプすべて日本語）
- モデル別クレジット単価・code review 係数は `src/rates.js` の定数テーブルで一元管理し、公式ドキュメント改訂時に1ファイル変更で更新可能にする（**プランティア関連ファイルは作らない**）
- 対応ブラウザ: Chrome 100+, Edge 100+, Firefox 100+（IE 不要）
- スマホ対応不要（PC ブラウザのみ）
- 既存の戦略コンサル向けワークスペース（`consulting-workspace` React アプリ）とは意図的に分離した自己完結ツールとする

---

## ファイル構成

```
/
├── index.html                     # UI シェル（開発用、ES modules で src/*.js を読む）
├── src/
│   ├── rates.js                   # モデル別クレジット単価 + code review係数（★唯一の更新対象）
│   ├── tokenizer.js               # テキスト/ファイル種別 → トークン数 推定
│   ├── calculator.js              # トークン数 + モデル/機能 → クレジット計算
│   └── ui.js                      # DOM イベント・結果描画
├── tests/
│   ├── tokenizer.test.js
│   └── calculator.test.js
├── build.js                       # dist/index.html 生成スクリプト
├── docs/
│   └── scenarios/
│       └── scenarios.md           # Chat/CLI/code review シナリオ
├── package.json
└── README.md
```

**インターフェース境界:**
- `tokenizer.js` は純粋関数のみ（DOM 依存なし、Node.js でテスト可）
- `rates.js` は定数テーブルのみ（ロジックなし）
- `calculator.js` は純粋関数のみ（`rates.js` をインポート）
- `ui.js` のみ DOM に触る
- `index.html` は最終統合ステップで `src/*.js` を `<script>` inline に埋め込む（`build.js`）

---

## Task 1: プロジェクトセットアップ + クレジット単価テーブル

**Files:**
- Modify/Create: `package.json`（既存があれば内容確認のみ、`build` スクリプトが無ければ追加）
- Create: `src/rates.js`
- Create: `tests/calculator.test.js`（空 stub）

**Interfaces:**
- Produces: `MODEL_RATES`, `USD_PER_CREDIT`, `CODE_REVIEW_CREDITS_PER_LINE`（`src/rates.js`、Task 3 が使用）

- [ ] **Step 1: package.json を確認・整備**

```json
{
  "name": "copilot-credit-calculator",
  "version": "1.0.0",
  "description": "GitHub Copilot クレジット消費量計算ツール",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch",
    "build": "node build.js"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "transform": {}
  }
}
```

- [ ] **Step 2: 依存関係インストール**

Run: `npm install`
Expected: `node_modules/` が作られ、exit 0

- [ ] **Step 3: クレジット単価テーブルを作成**

`src/rates.js`:
```javascript
// クレジット単価 (USD per 1,000,000 tokens)
// GitHub Copilot は 2026/6/1 に premium request 課金を廃止し、
// トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）へ移行した。
// 計算式: credits = tokens × usd_per_1m / 10,000 （$0.01/credit 換算込み）
// 出典: 事務局提供の単価表（2026-07-01 時点）
export const USD_PER_CREDIT = 0.01;

// Copilot code review はモデルをユーザーが選択できないため、
// PR 変更行数（diff行数）に経験係数を掛けた概算とする。
// ★要確認: 実測データが無いため暫定値。Phase 1 で実測較正すること。
export const CODE_REVIEW_CREDITS_PER_LINE = 0.05; // 要確認（暫定値）

const CLAUDE_SONNET_4_RATE = { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 };
const CLAUDE_OPUS_4_RATE   = { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 };

export const MODEL_RATES = {
  'gpt-5-mini': {
    label: 'GPT-5 mini', provider: 'OpenAI',
    input: 0.25, cachedInput: 0.025, cacheWrite: null, output: 2.00,
  },
  'gpt-5-3-codex': {
    label: 'GPT-5.3-Codex', provider: 'OpenAI',
    input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14.00,
  },
  'gpt-5-4': {
    label: 'GPT-5.4', provider: 'OpenAI',
    input: 2.50, cachedInput: 0.25, cacheWrite: null, output: 15.00,
    longContext: { thresholdTokens: 272000, input: 5.00, cachedInput: 0.50, cacheWrite: null, output: 22.50 },
  },
  'gpt-5-4-mini': {
    label: 'GPT-5.4 mini', provider: 'OpenAI',
    input: 0.75, cachedInput: 0.075, cacheWrite: null, output: 4.50,
  },
  'gpt-5-4-nano': {
    label: 'GPT-5.4 nano', provider: 'OpenAI',
    input: 0.20, cachedInput: 0.02, cacheWrite: null, output: 1.25,
  },
  'gpt-5-5': {
    label: 'GPT-5.5', provider: 'OpenAI',
    input: 5.00, cachedInput: 0.50, cacheWrite: null, output: 30.00,
    longContext: { thresholdTokens: 272000, input: 10.00, cachedInput: 1.00, cacheWrite: null, output: 45.00 },
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5', provider: 'Anthropic',
    input: 1.00, cachedInput: 0.10, cacheWrite: 1.25, output: 5.00,
  },
  'claude-sonnet-4': { label: 'Claude Sonnet 4', provider: 'Anthropic', ...CLAUDE_SONNET_4_RATE },
  'claude-sonnet-4-5': { label: 'Claude Sonnet 4.5', provider: 'Anthropic', ...CLAUDE_SONNET_4_RATE },
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', provider: 'Anthropic', ...CLAUDE_SONNET_4_RATE },
  'claude-opus-4-5': { label: 'Claude Opus 4.5', provider: 'Anthropic', ...CLAUDE_OPUS_4_RATE },
  'claude-opus-4-6': { label: 'Claude Opus 4.6', provider: 'Anthropic', ...CLAUDE_OPUS_4_RATE },
  'claude-opus-4-7': { label: 'Claude Opus 4.7', provider: 'Anthropic', ...CLAUDE_OPUS_4_RATE },
  'claude-opus-4-8': { label: 'Claude Opus 4.8', provider: 'Anthropic', ...CLAUDE_OPUS_4_RATE },
  'claude-sonnet-5': {
    label: 'Claude Sonnet 5', provider: 'Anthropic',
    input: 2.00, cachedInput: 0.20, cacheWrite: 2.50, output: 10.00,
    // ★要確認: プロモ価格。2026-08-31 まで。期限後に正規単価へ更新すること。
    promoExpiresAt: '2026-08-31',
  },
  'claude-opus-4-8-fast': {
    label: 'Claude Opus 4.8 fast mode (Preview)', provider: 'Anthropic',
    input: 10.00, cachedInput: 1.00, cacheWrite: 12.50, output: 50.00,
  },
  'gemini-2-5-pro': {
    label: 'Gemini 2.5 Pro', provider: 'Google',
    input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10.00,
  },
  'gemini-3-flash': {
    label: 'Gemini 3 Flash', provider: 'Google',
    input: 0.50, cachedInput: 0.05, cacheWrite: null, output: 3.00,
  },
  'gemini-3-1-pro': {
    label: 'Gemini 3.1 Pro', provider: 'Google',
    input: 2.00, cachedInput: 0.20, cacheWrite: null, output: 12.00,
    longContext: { thresholdTokens: 200000, input: 4.00, cachedInput: 0.40, cacheWrite: null, output: 18.00 },
  },
  'gemini-3-5-flash': {
    label: 'Gemini 3.5 Flash', provider: 'Google',
    input: 1.50, cachedInput: 0.15, cacheWrite: null, output: 9.00,
  },
  'raptor-mini': {
    label: 'Raptor mini', provider: 'GitHub',
    input: 0.25, cachedInput: 0.025, cacheWrite: null, output: 2.00,
  },
  'mai-code-1-flash': {
    label: 'MAI-Code-1-Flash', provider: 'Microsoft',
    input: 0.75, cachedInput: 0.075, cacheWrite: null, output: 4.50,
  },
};
```

- [ ] **Step 4: stub テスト作成**

`tests/calculator.test.js` に `import { MODEL_RATES, USD_PER_CREDIT, CODE_REVIEW_CREDITS_PER_LINE } from '../src/rates.js'` の存在確認テストのみ書く（本実装は Task 3）。

- [ ] **Step 5: コミット**

```bash
git add package.json src/rates.js tests/calculator.test.js
git commit -m "feat: add credit rate table for 20 models (chat/CLI/code review)"
```

---

## Task 2: `src/tokenizer.js`（TDD）

v2 と同一設計。既存実装が無いため新規作成する。

**Files:** Create `src/tokenizer.js`, `tests/tokenizer.test.js`

**Interfaces:**
- Produces: `estimateTextTokens(text, language)`, `estimateFileTokens(fileType, sizeKB, language)`, `estimateConversationTokens(messages)`

- [ ] **Step 1: テストを先に書く**（`tests/tokenizer.test.js`）
  - 日本語テキスト: 650 tokens/KB相当の概算になること
  - ファイル形式別換算係数（CLAUDE.md 記載値）: Markdown 650 / PDF 400 / Word(.docx) 300 / PowerPoint(.pptx) 250 / Excel(.xlsx) 200 tokens/KB
  - 会話履歴（複数メッセージ）の合計トークン数が各メッセージの合計と一致すること
- [ ] **Step 2: 実装して Green にする**
- [ ] **Step 3: コミット**

```bash
git add src/tokenizer.js tests/tokenizer.test.js
git commit -m "feat: implement token estimation for text, files, and conversation history"
```

---

## Task 3: `src/calculator.js`（TDD）

**Files:** Create `src/calculator.js`, Modify `tests/calculator.test.js`

**Interfaces:**
- Produces: `calculateCredits(tokens, modelKey)`, `compareModels(tokens)`, `calculateCodeReviewCredits(diffLines)`, `creditsToUSD(credits)`

- [ ] **Step 1: テストを先に書く**
  - `calculateCredits({ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens }, modelKey)`:
    - 計算式 `credits = Σ(tokens種別 × rate_per_1M / 10,000)` が正しく計算されること（`gpt-5-mini` 等で手計算値と一致確認）
    - `inputTokens` が `longContext.thresholdTokens` を超えたら `gpt-5-4` / `gpt-5-5` / `gemini-3-1-pro` で longContext レートが使われること
    - `cacheWrite: null` のモデル（例: `gpt-5-mini`）に `cacheWriteTokens` を渡しても 0 として無視されること
  - `compareModels(tokens)`: 全モデルを計算しクレジット昇順でソートして返すこと
  - `calculateCodeReviewCredits(diffLines)`: `diffLines × CODE_REVIEW_CREDITS_PER_LINE` と一致すること
  - `creditsToUSD(credits)`: `credits × 0.01` と一致すること
- [ ] **Step 2: 実装して Green にする**
- [ ] **Step 3: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: implement credit calculation for chat/CLI and code review"
```

---

## Task 4: UI 実装（`index.html` + `src/ui.js`）

**Files:** Create `index.html`, Create `src/ui.js`

- [ ] **Step 1: 機能セレクタを実装**
  - 「Copilot Chat」「Copilot CLI」「Copilot code review」の3択（ラジオボタンまたはセレクトボックス）
- [ ] **Step 2: Chat/CLI 用フォームを実装**
  - モデルドロップダウン（`MODEL_RATES` の20エントリを `provider` でグルーピング表示）
  - プロンプト入力欄、添付ファイル入力（形式・サイズ・言語）、会話履歴件数
  - キャッシュ入力トークン比率入力（0〜100%）
  - 想定回答文字数（出力トークン推定用）
  - 「計算する」ボタン → `calculateCredits` / `compareModels` を呼び出し結果表示
- [ ] **Step 3: code review 用フォームを実装**
  - モデルドロップダウンは表示しない
  - 「変更行数（diff行数）」の数値入力のみ
  - 「計算する」ボタン → `calculateCodeReviewCredits` を呼び出し結果表示
- [ ] **Step 4: 結果表示**
  - クレジット消費量とドル金額（`creditsToUSD`）を表示
  - Chat/CLI では全モデル比較テーブルをコスト昇順で表示
  - チーム人数・プランティア関連の表示要素は一切作らない
- [ ] **Step 5: ブラウザで手動確認**（`npx serve . -p 3000` 起動 → `http://localhost:3000`）
- [ ] **Step 6: コミット**

```bash
git add index.html src/ui.js
git commit -m "feat: implement UI for chat/CLI/code review credit estimation"
```

---

## Task 5: `build.js`

**Files:** Create `build.js`

- [ ] **Step 1: ビルドスクリプトを実装**
  - `src/*.js` の import/export 文を除去し `index.html` に `<script>` として inline embed した `dist/index.html` を生成
- [ ] **Step 2: `npm run build` を実行し `dist/index.html` を確認**
  - `file://` で単体起動し、Chat/CLI/code review の3モードすべてが動作すること
- [ ] **Step 3: コミット**

```bash
git add build.js dist/index.html
git commit -m "build: add dist/index.html build script and generated output"
```

---

## Task 6: シナリオ検証 + ドキュメント

**Files:** Create `docs/scenarios/scenarios.md`, Modify `README.md`

- [ ] **Step 1: シナリオ検証**
  - Chat: 「ユニットテスト自動作成」相当のプロンプト+添付ファイルで計算し、モデル比較結果を記録
  - CLI: 「コードレビューコメント生成」相当のプロンプトで計算
  - code review: 変更行数 200行程度のPRを想定して計算
  - 結果を `docs/scenarios/scenarios.md` にまとめる
- [ ] **Step 2: README.md を新スコープに合わせて全面書き換え**
  - 課金モデル説明（premium request廃止・従量課金・$0.01/credit）
  - 対象機能: Chat / CLI / code review（チーム機能は無い旨を明記）
  - 使い方（`dist/index.html` をダブルクリック）
  - 単価更新方法（`src/rates.js` のみが更新対象）
- [ ] **Step 3: コミット**

```bash
git add docs/scenarios/scenarios.md README.md
git commit -m "docs: usage guide and scenario simulation results for v3 scope"
```

---

## Task 7: CLAUDE.md 更新

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 背景セクションを更新**
  - premium request 廃止・トークンベース従量課金（$0.01/credit）への移行を明記
  - チーム/プランティア判定は行わない旨を明記（個人が1リクエスト/1PRあたりの消費を確認する用途に限定）
  - 対象機能が Copilot Chat / CLI / code review であることを明記
- [ ] **Step 2: ディレクトリ構成を更新**（`planTiers.js` は存在しないため記載しない）
- [ ] **Step 3: 「クレジット単価の更新」セクションを更新**
  - `src/rates.js` が唯一の更新対象であることを維持しつつ、`MODEL_RATES` に加え `CODE_REVIEW_CREDITS_PER_LINE` も更新対象であることを追記
- [ ] **Step 4: 対応モデル一覧を20モデルに更新**
- [ ] **Step 5: 「注意事項」を更新**
  - `CODE_REVIEW_CREDITS_PER_LINE` が暫定値であり実測較正が必要なこと
  - Claude Sonnet 5 のプロモ価格が 2026-08-31 までであり、期限後に単価更新が必要なこと
- [ ] **Step 6: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v3 scope (chat/CLI/code review, no team plan tiers)"
```

---

## 検証 (Verification)

### 自動テスト
```bash
npm test
```
Expected: 全テスト PASS（tokenizer + calculator[calculateCredits/compareModels/calculateCodeReviewCredits/creditsToUSD]）

### ブラウザ動作確認

**Case 1: 基本動作（Chat）**
1. `dist/index.html` をダブルクリックで開く
2. 機能を「Copilot Chat」、モデルを「Claude Sonnet 4.6」に設定
3. プロンプトに「テストコードを書いてください」(約15文字)と入力
4. ファイルに Excel 100KB (日本語) を追加
5. 「計算する」クリック → クレジット・USD が表示され、数値が 0 より大きいこと

**Case 2: モデル比較**
- 結果のモデル比較テーブルが全20モデル（Anthropicはバージョン別に複数行）を表示し、コスト昇順であること

**Case 3: キャッシュ効果**
- キャッシュ入力トークン比率を 50% に設定すると、0% 時よりクレジットが低下すること

**Case 4: ロングコンテキスト自動切替**
- 入力トークン合計を 272,000 超に設定して GPT-5.4 を選択すると、longContext 側の単価（input 5.00）が適用され、通常単価（2.50）より高い結果になること
- Gemini 3.1 Pro で 200,000 超のケースも同様に確認

**Case 5: code review**
- 機能を「Copilot code review」に切り替えるとモデルドロップダウンが非表示になること
- 変更行数に 200 を入力 → `200 × CODE_REVIEW_CREDITS_PER_LINE` と一致するクレジットが表示されること

**Case 6: 配布ファイル確認**
- `dist/index.html` 単体を別 PC にコピーしてブラウザで開き、インターネット接続なしで動作すること

---

## Phase 1 調査完了後の単価更新手順

1. GitHub Copilot 公式ドキュメント・事務局提供資料から各モデルの実単価を再確認
2. `src/rates.js` の `MODEL_RATES` 内、`// ★要確認` コメント付きエントリ（特に `claude-sonnet-5` のプロモ価格終了後の単価）を実値に更新
3. `CODE_REVIEW_CREDITS_PER_LINE` を実測データに基づき較正
4. `npm run build` を再実行
5. `dist/index.html` を配布
