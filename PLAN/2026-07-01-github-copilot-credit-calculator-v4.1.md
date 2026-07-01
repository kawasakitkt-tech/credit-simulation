# GitHub Copilot クレジット消費量計算ツール 実装計画 v4.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本文書は単独で完結する実装計画**です。旧計画書（`PLAN/2026-07-01-github-copilot-credit-calculator-v2.md`、`-v3.md`、`-v4.md`）は本文書に統合済みのため削除されています。`docs/superpowers/plans/2026-07-01-github-copilot-credit-calculator.md` は最初期の草案として履歴保存されているのみで参照不要です。
>
> **まだ実装には着手しないでください。** 本文書は実装指示書のレビュー・改善版であり、Task 0 から実際にコードを書き始めるのは別セッション（または本文書の末尾指示を外した後続の依頼）です。

## 変更履歴

- **v4.1 (2026-07-01)**: v4 に対する実装前レビューを反映。主な変更点:
  1. モデル数「20固定」の前提・テスト・文言を廃止し、`MODEL_RATES` の登録数に追従する形に変更
  2. `estimateConversationTokens`（累積会話量）を廃止し、1リクエストに含める過去会話量を表す `estimateHistoryTokens` に置き換え
  3. Chat/CLI に `FEATURE_OVERHEAD_TOKENS`（system prompt / tool definitions 等の概算オーバーヘッド）を追加し、`buildChatCliTokens` でトークンを組み立てる方針を明記
  4. ロングコンテキスト判定基準を `inputTokens + cachedInputTokens + cacheWriteTokens`（`contextTokens`）ベースであることをテスト・文言で明示
  5. `CODE_REVIEW_CREDITS_PER_LINE` を `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` に改名し、暫定値であることを強調
  6. CLAUDE.md 更新を Task 7 から Task 0 に前倒し、Task 構成を Task 0〜6 に再編
  7. `docs/scenarios/scenarios.md` を必須成果物から任意（README代表例1〜2件で代替可）に格下げ
  8. ファイルサイズKBベースのトークン推定が「参考値」であることをUI/READMEに明記する方針を追加
  9. `build.js` に最低限の生成物検証（必須スニペットチェック）を追加
  10. 計画書冒頭に「シンプル版」の設計思想を明記
- **v4 (2026-07-01)**: v2（team/plan-tier 草案）と v3（20モデル実単価・Chat/CLI/code review 分割）を統合。

---

## 設計思想（シンプル版）

本ツールは、GitHub Copilot 内部の正確なコンテキスト構築を再現するものではなく、事務局・利用者がモデル選択と概算消費量を事前判断するための**軽量見積もりツール**である。精度を上げるために prompt / reference / history / feature overhead / cache ratio を分けて扱うが、Office/PDF の自動解析、GitHub API 連携、実請求データ連携は初期スコープ外とする。迷ったら「複雑にしない」方を選ぶこと。

**Goal:** GitHub Copilot のクレジット消費量を事前見積もりできるスタンドアロン Web ツールを、ブラウザで動く単一 HTML ファイルとして構築する。対象は **Copilot Chat / Copilot CLI / Copilot code review** の3機能。個人が1リクエスト（Chat/CLI）あるいは1PR（code review）あたりに消費するクレジット・ドル金額を事前確認できることに限定する。チーム単位の予算管理・プランティア適合判定は本ツールのスコープ外。

## 前提

- GitHub Copilot は 2026/6/1 に premium request 方式の課金を廃止し、**トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）**に移行済み。
- モデル別単価（OpenAI / Anthropic / Google / GitHub / Microsoft 各社、`$ per 1,000,000 tokens` 単位、Input / Cached input / Cache write / Output の4区分）は事務局提供資料により判明済み。`src/rates.js` にこの実値を実装する。**モデル数は今後の追加・廃止で変動するため、本計画書・テスト・UI 文言のいずれにおいても特定の数（例: 20）を前提にしない。** `MODEL_RATES` に登録されているモデルすべてを動的に扱うこと。
- Copilot code review はモデルをユーザーが選択できない（GitHub 側の調整済みモデルを使用）ため、PR の変更行数（diff行数）に**実測前の暫定係数**を掛ける専用ロジックで概算する（詳細は後述）。
- GPT-5.4 / GPT-5.5（272K tokens 超）、Gemini 3.1 Pro（200K tokens 超）はロングコンテキスト時に単価が切り替わる。UI で手動選択させず、`contextTokens = inputTokens + cachedInputTokens + cacheWriteTokens` の合計値から自動判定する（`inputTokens` 単体では判定しない）。
- Chat / CLI は、ユーザーが入力するプロンプト・参照テキストだけでなく、system prompt・tool definitions・custom instructions 等の**見えない文脈**を消費する。初期版では機能ごとの固定オーバーヘッド係数（`FEATURE_OVERHEAD_TOKENS`）で概算する（詳細は後述）。
- **スコープ外機能**: Copilot cloud agent（セッション合計・GitHub Actions minutes 消費）、Code completions / Next edit suggestions（AI Credits 対象外）、チーム/プランティア適合判定、GitHub API 連携、プラン比較、チーム予算管理。GitHub Actions minutes の見積もりも行わない（AI Credits のみ見積もる）。

**Architecture:** Vanilla JS の ES モジュール群（rates → tokenizer → calculator → ui）をパイプライン化し、Node.js + Jest でコアロジックを TDD、完成後に index.html に統合してブラウザ単体で動作させる。外部サーバー・ビルドツール不要。

**Tech Stack:** HTML5, Vanilla JavaScript (ES2022 modules), CSS3, Node.js 20+ (テスト専用), Jest 29

## Global Constraints

- 外部 CDN・ライブラリへの依存ゼロ（HTML をダブルクリックで起動、オフライン動作）
- 日本語 UI（ラベル・エラーメッセージ・ヘルプすべて日本語）
- モデル別クレジット単価・code review 係数は `src/rates.js` の定数テーブルで一元管理し、公式ドキュメント改訂時に1ファイル変更で更新可能にする（プランティア関連ファイルは作らない）
- モデル数・機能数を固定値としてテスト・文言にハードコードしない（`Object.keys(MODEL_RATES).length` 等、テーブル側を単一の真実源とする）
- 対応ブラウザ: Chrome 100+, Edge 100+, Firefox 100+（IE 不要）
- スマホ対応不要（PC ブラウザのみ）
- 既存の戦略コンサル向けワークスペース（`consulting-workspace` React アプリ）とは意図的に分離した自己完結ツールとする

---

## ファイル構成

```
/
├── index.html                     # UI シェル（開発用、ES modules で src/*.js を読む）
├── src/
│   ├── rates.js                   # モデル別クレジット単価 + feature overhead + code review係数（★唯一の更新対象）
│   ├── tokenizer.js               # テキスト/ファイル種別 → トークン数 推定
│   ├── calculator.js              # トークン数 + モデル/機能 → クレジット計算
│   └── ui.js                      # DOM イベント・結果描画
├── tests/
│   ├── tokenizer.test.js
│   └── calculator.test.js
├── build.js                       # dist/index.html 生成スクリプト
├── docs/
│   └── scenarios/
│       └── scenarios.md           # (任意) Chat/CLI/code review シナリオ結果。README代表例で代替可
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

## Task 0: 既存ファイル確認 + CLAUDE.md / README 事前整合

**背景:** Claude Code は実装開始時に `CLAUDE.md` を最初に参照する可能性がある。旧スコープ（7モデル・Chat/CodeReview/Agent/CLI・月次上限1,900警告・チーム予算管理）を前提にした記述が残ったまま実装を進めると、後続タスクで混乱するため、着手前に整合させる。

**Files:**
- Modify: `CLAUDE.md`（現行は「対象218名」「月次上限3,000→1,900」「Chat/CodeReview/Agent/CLI」等、旧スコープの記述が中心）
- Modify: `README.md`（現行は7モデル・Agent機能・月次上限1,900前提の内容）
- Read-only 確認: `package.json`, `src/`, `dist/`, `tests/` の現状

- [ ] **Step 1: 既存ディレクトリ・既存ファイルを確認する**
  - `package.json` が本計画のスクリプト（`test`, `test:watch`, `build`）と一致しているか確認
  - `src/`, `dist/`, `tests/` が未作成であること（or 既存内容）を確認してから Task 1 以降に進む

- [ ] **Step 2: CLAUDE.md を本計画のスコープに合わせて修正**
  - 背景セクション: premium request 廃止・トークンベース従量課金（$0.01/credit）への移行を明記
  - 対象機能を **Copilot Chat / Copilot CLI / Copilot code review** の3つに限定すると明記
  - **cloud agent / Actions minutes / プラン比較 / チーム予算管理はスコープ外**と明記
  - ディレクトリ構成を本計画のファイル構成に更新
  - 「クレジット単価の更新」セクション: `src/rates.js` の `MODEL_RATES` に加え、`FEATURE_OVERHEAD_TOKENS` と `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` も更新対象であることを追記
  - 対応モデル一覧は「登録済みモデルすべて（provider別）」という表現にし、特定の数を書かない
  - 注意事項: `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` が実測前の暫定係数であり実測較正が必要なこと、Claude Sonnet 5 のプロモ価格に期限があること（該当する場合）を明記

- [ ] **Step 3: README.md を本計画のスコープに合わせて修正**
  - 対象機能・課金モデル説明を Chat/CLI/code review に更新
  - 「会話ターン数」等、旧UI文言が残っていれば Task 4 実装後の文言（下記参照）に揃える方針をメモしておく
  - モデル一覧が固定数を書かないようにする方針をメモしておく

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "docs: align CLAUDE.md/README with chat/CLI/code review scope before implementation"
```

---

## Task 1: プロジェクトセットアップ + クレジット単価テーブル

**Files:**
- Modify/Create: `package.json`
- Create: `src/rates.js`
- Create: `tests/calculator.test.js`（空 stub）

**Interfaces:**
- Produces: `MODEL_RATES`, `USD_PER_CREDIT`, `FEATURE_OVERHEAD_TOKENS`, `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE`（`src/rates.js`、Task 3 が使用）

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

// Chat/CLI利用時、ユーザー入力とは別に system prompt / tool definitions /
// custom instructions 等の見えない文脈が消費するトークンの概算固定値。
// TODO: 実測データが無いため暫定値。Phase 1 で実測較正すること。
export const FEATURE_OVERHEAD_TOKENS = {
  chat: 1500,
  cli: 2500,
};

// Copilot code review はモデルをユーザーが選択できないため、
// PR 変更行数（diff行数）に経験係数を掛けた概算とする。
// 変数名に EXPERIMENTAL を含め、他のモデル別単価と同列の確からしさに見えないようにする。
// 要確認: 実測データが無いため暫定値。Phase 1 で実測較正すること。
export const EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE = 0.05; // 要確認（暫定値）

const CLAUDE_SONNET_4_RATE = { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 };
const CLAUDE_OPUS_4_RATE   = { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 };

// 登録モデル数は今後増減しうる。テスト・UI ロジックは
// Object.keys(MODEL_RATES).length を単一の真実源として扱い、固定数を仮定しない。
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
    // 要確認: プロモ価格。2026-08-31 まで。期限後に正規単価へ更新すること。
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

- [ ] **Step 4: 空の stub テストを作成して Jest が動くことを確認**

`tests/calculator.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';
import { MODEL_RATES, USD_PER_CREDIT, EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE, FEATURE_OVERHEAD_TOKENS } from '../src/rates.js';

describe('rates.js', () => {
  it('MODEL_RATES に登録済みモデルが1つ以上定義されている（数を固定しない）', () => {
    expect(Object.keys(MODEL_RATES).length).toBeGreaterThanOrEqual(20);
  });

  it('USD_PER_CREDIT は 0.01', () => {
    expect(USD_PER_CREDIT).toBe(0.01);
  });

  it('EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE は正の数（暫定値）', () => {
    expect(EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE).toBeGreaterThan(0);
  });

  it('FEATURE_OVERHEAD_TOKENS に chat/cli が定義されている', () => {
    expect(FEATURE_OVERHEAD_TOKENS.chat).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.cli).toBeGreaterThan(0);
  });
});
```

> **注:** `toBeGreaterThanOrEqual(20)` は「現時点で20種以上ある」ことの確認であり、20固定を要求するものではない。モデルが将来削除されて20を割った場合は、この数値をその時点の登録数に合わせて更新してよい（`compareModels` 側のテストは `Object.keys(MODEL_RATES).length` を直接参照するため、モデル数変更に追従して自動で通る）。

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `npm test`
Expected: 全て PASS

- [ ] **Step 6: コミット**

```bash
git add package.json src/rates.js tests/calculator.test.js
git commit -m "feat: add credit rate table, feature overhead, and experimental code review coefficient"
```

---

## Task 2: トークン推定エンジン (tokenizer.js)

**Files:**
- Create: `src/tokenizer.js`
- Create: `tests/tokenizer.test.js`

**Interfaces:**
- Produces:
  - `estimateTextTokens(text: string): number` — 日本語/英語/コード混在テキスト → トークン数
  - `estimateFileTokens(fileSizeKB: number, fileType: 'md'|'docx'|'xlsx'|'pptx'|'pdf', encoding?: 'ja'|'en'): number`（**参考値**。下記注意参照）
  - `estimateHistoryTokens(previousTurns: number, avgUserChars: number, avgAssistantChars: number): number` — **今回の1リクエストに含める過去会話量**（旧 `estimateConversationTokens` を置き換え。累積合計ではない）

> **ファイルサイズKB推定に関する注意（必須修正8）:** ファイルサイズKBからの推定は簡易概算である。Word / Excel / PowerPoint / PDF は圧縮・画像・メタデータ・数式・表構造の影響が大きく、実際にCopilotへ投入されるトークン量とは差が出る可能性がある。精度を上げる場合は、対象本文をテキスト欄へ貼り付けるようUIで案内すること（README にも同内容を明記、Task 6）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/tokenizer.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';
import {
  estimateTextTokens,
  estimateFileTokens,
  estimateHistoryTokens,
} from '../src/tokenizer.js';

describe('estimateTextTokens', () => {
  it('英語テキストは約4文字で1トークン', () => {
    const tokens = estimateTextTokens('Hello world this is a test sentence.');
    expect(tokens).toBeGreaterThan(6);
    expect(tokens).toBeLessThan(12);
  });

  it('日本語テキストは約1.5文字で1トークン', () => {
    const tokens = estimateTextTokens('こんにちは世界これはテストです。');
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(15);
  });

  it('空文字列は0トークン', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('コードは英語よりやや多いトークン（特殊文字）', () => {
    const code = 'function hello() { return "world"; }';
    const tokens = estimateTextTokens(code);
    expect(tokens).toBeGreaterThan(8);
  });
});

describe('estimateFileTokens（参考値）', () => {
  it('Markdown 10KB → 約 3000 トークン前後（CLAUDE.md記載の650 tokens/KB, ja）', () => {
    const tokens = estimateFileTokens(10, 'md', 'ja');
    expect(tokens).toBeGreaterThan(2000);
    expect(tokens).toBeLessThan(5000);
  });

  it('Word (.docx) はオーバーヘッド込みで Markdown より少ない実データ率', () => {
    const mdTokens = estimateFileTokens(10, 'md', 'en');
    const docxTokens = estimateFileTokens(10, 'docx', 'en');
    expect(docxTokens).toBeLessThan(mdTokens);
  });

  it('Excel は行数×列数の実データ部分のみ計算', () => {
    const tokens = estimateFileTokens(50, 'xlsx', 'ja');
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('estimateHistoryTokens', () => {
  it('過去会話ターン数が0なら履歴トークンも0', () => {
    expect(estimateHistoryTokens(0, 500, 1000)).toBe(0);
  });

  it('過去会話ターン数に比例して履歴トークンが増える（累積ではなく線形）', () => {
    const oneTurn = estimateHistoryTokens(1, 500, 1000);
    const twoTurns = estimateHistoryTokens(2, 500, 1000);
    expect(twoTurns).toBeCloseTo(oneTurn * 2, 0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL（`tokenizer.js` が存在しない）

- [ ] **Step 3: tokenizer.js を実装**

`src/tokenizer.js`:
```javascript
// トークン推定係数（実測値に近い近似）
// 日本語: 1文字 ≈ 0.65 トークン（ひらがな/カタカナ/漢字はUTF-8で2-3バイト = 1-2トークン）
// 英語:   1文字 ≈ 0.25 トークン（4文字 = 1トークン）

const RATIO = {
  ja: 0.65,
  en: 0.25,
};

// 文字列中の日本語文字比率を計算して適切なレートを選択
function detectRatio(text) {
  if (!text) return RATIO.en;
  const jaPattern = /[　-鿿豈-﫿]/g;
  const jaCount = (text.match(jaPattern) || []).length;
  const jaRatio = jaCount / text.length;
  // 20%超が日本語ならJA係数
  if (jaRatio > 0.2) return RATIO.ja;
  return RATIO.en;
}

export function estimateTextTokens(text) {
  if (!text || text.length === 0) return 0;
  const ratio = detectRatio(text);
  return Math.ceil(text.length * ratio);
}

// ファイル種別ごとのトークン換算係数（ファイルサイズ KB あたり）。あくまで参考値。
// CLAUDE.md 記載の日本語係数と一致させる: md=650, pdf=400, docx=300, pptx=250, xlsx=200
// Word/Excel/PPT は XML ラッパーのオーバーヘッドがあるため実コンテンツより少ない
const FILE_TOKENS_PER_KB = {
  md:   { ja: 650, en: 250 },
  pdf:  { ja: 400, en: 180 },
  docx: { ja: 300, en: 130 },
  pptx: { ja: 250, en: 110 },
  xlsx: { ja: 200, en: 100 },
};

export function estimateFileTokens(fileSizeKB, fileType, encoding = 'ja') {
  const rates = FILE_TOKENS_PER_KB[fileType] ?? FILE_TOKENS_PER_KB.md;
  const rate = rates[encoding] ?? rates.ja;
  return Math.ceil(fileSizeKB * rate);
}

// 今回の1リクエストに含める過去会話ターンの履歴トークンを推定する。
// 「複数ターンの累積利用量」ではなく、今回送信するコンテキストに乗る履歴量のみを扱う。
export function estimateHistoryTokens(previousTurns, avgUserChars, avgAssistantChars) {
  if (previousTurns <= 0) return 0;

  const userTokens = estimateTextTokens('a'.repeat(avgUserChars));
  const assistantTokens = estimateTextTokens('a'.repeat(avgAssistantChars));

  return Math.ceil(previousTurns * (userTokens + assistantTokens));
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test tests/tokenizer.test.js`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/tokenizer.js tests/tokenizer.test.js
git commit -m "feat: token estimation engine with JA/EN/file-type/history support"
```

---

## Task 3: クレジット計算エンジン (calculator.js)

**Files:**
- Create: `src/calculator.js`
- Modify: `tests/calculator.test.js`

**Interfaces:**
- Consumes: `MODEL_RATES`, `USD_PER_CREDIT`, `FEATURE_OVERHEAD_TOKENS`, `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` from `src/rates.js`
- Produces:
  - `buildChatCliTokens(params): TokensResult` — prompt/reference/history/overhead/cache比率から `tokens` オブジェクトを組み立てる
  - `calculateCredits(tokens, modelKey): CreditResult`
  - `compareModels(tokens): CreditResult[]`
  - `calculateCodeReviewCredits(diffLines): CodeReviewResult`
  - `creditsToUSD(credits: number): number`

  ```
  tokens = {
    inputTokens: number,
    cachedInputTokens: number,
    cacheWriteTokens: number,
    outputTokens: number,
  }

  CreditResult = {
    modelKey, label,
    usedLongContextRate: boolean,
    breakdown: { inputCredits, cachedInputCredits, cacheWriteCredits, outputCredits },
    totalCredits: number,
    totalUSD: number,
  }

  CodeReviewResult = { diffLines, totalCredits, totalUSD }
  ```

  **計算式:** `credits = tokens × usd_per_1M_tokens / 10,000`（`USD_PER_CREDIT = 0.01` の換算込み）。
  **ロングコンテキスト判定（必須修正4）:** `contextTokens = inputTokens + cachedInputTokens + cacheWriteTokens` が `MODEL_RATES[modelKey].longContext.thresholdTokens` を超えたら、`longContext` 側の単価を使う（対象: `gpt-5-4`, `gpt-5-5`, `gemini-3-1-pro`）。**`inputTokens` 単体では判定しない**ため、キャッシュ利用が多いリクエストでも見逃さない。
  **`cacheWrite: null` のモデル:** `cacheWriteTokens` を渡しても常に 0 クレジットとして扱う。
  **Chat/CLI のトークン組み立て（必須修正3）:** UI 側は個別のトークン数を積み上げるのではなく、`buildChatCliTokens` を経由して `tokens` を組み立てる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` に以下を追記する（Task 1 の rates.js テストは残す）:
```javascript
import {
  calculateCredits,
  compareModels,
  calculateCodeReviewCredits,
  creditsToUSD,
  buildChatCliTokens,
} from '../src/calculator.js';
import { MODEL_RATES } from '../src/rates.js';

const baseTokens = {
  inputTokens: 10000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 2000,
};

describe('calculateCredits', () => {
  it('gpt-5-mini の手計算値と一致する', () => {
    // input: 10000 * 0.25 / 10000 = 0.25
    // output: 2000 * 2.00 / 10000 = 0.4
    const result = calculateCredits(baseTokens, 'gpt-5-mini');
    expect(result.breakdown.inputCredits).toBeCloseTo(0.25, 4);
    expect(result.breakdown.outputCredits).toBeCloseTo(0.4, 4);
    expect(result.totalCredits).toBeCloseTo(0.65, 4);
  });

  it('cacheWrite: null のモデルに cacheWriteTokens を渡しても0クレジット', () => {
    const result = calculateCredits({ ...baseTokens, cacheWriteTokens: 5000 }, 'gpt-5-mini');
    expect(result.breakdown.cacheWriteCredits).toBe(0);
  });

  it('inputTokens が閾値以下なら通常単価（gpt-5-4）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 100000 }, 'gpt-5-4');
    expect(result.usedLongContextRate).toBe(false);
  });

  it('contextTokens（input単体）が閾値超過ならロングコンテキスト単価（gpt-5-4, 272,000超）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 300000 }, 'gpt-5-4');
    expect(result.usedLongContextRate).toBe(true);
  });

  it('cachedInputTokens を含めて contextTokens が閾値超過した場合も longContextRate を使う（必須修正4）', () => {
    const result = calculateCredits({
      inputTokens: 250000,
      cachedInputTokens: 30000,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    }, 'gpt-5-4');

    expect(result.usedLongContextRate).toBe(true);
  });

  it('contextTokens（input単体）が閾値超過ならロングコンテキスト単価（gemini-3-1-pro, 200,000超）', () => {
    const result = calculateCredits({ ...baseTokens, inputTokens: 250000 }, 'gemini-3-1-pro');
    expect(result.usedLongContextRate).toBe(true);
  });

  it('存在しないモデルキーはエラーをスロー', () => {
    expect(() => calculateCredits(baseTokens, 'unknown-model')).toThrow('Unknown model');
  });
});

describe('compareModels', () => {
  it('登録済みモデルすべての比較配列をコスト昇順で返す（数を固定しない）', () => {
    const results = compareModels(baseTokens);
    expect(results.length).toBe(Object.keys(MODEL_RATES).length);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].totalCredits).toBeGreaterThanOrEqual(results[i - 1].totalCredits);
    }
  });
});

describe('calculateCodeReviewCredits', () => {
  it('diffLines × EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE と一致する', () => {
    const result = calculateCodeReviewCredits(200);
    expect(result.totalCredits).toBeCloseTo(200 * 0.05, 4);
  });
});

describe('creditsToUSD', () => {
  it('credits × 0.01 と一致する', () => {
    expect(creditsToUSD(100)).toBeCloseTo(1.0, 4);
  });
});

describe('buildChatCliTokens', () => {
  it('promptTokens + freshReferenceTokens + historyTokens + overheadTokens を inputTokens にする（chat）', () => {
    const tokens = buildChatCliTokens({
      promptTokens: 100,
      referenceTokens: 1000,
      historyTokens: 200,
      outputTokens: 500,
      cacheHitRatio: 0,
      feature: 'chat',
    });
    // overhead(chat)=1500 固定値。src/rates.js の FEATURE_OVERHEAD_TOKENS.chat と一致させる。
    expect(tokens.inputTokens).toBe(100 + 1000 + 200 + 1500);
    expect(tokens.cachedInputTokens).toBe(0);
  });

  it('cacheHitRatio に応じて cachedInputTokens と freshReferenceTokens に分かれる', () => {
    const tokens = buildChatCliTokens({
      promptTokens: 0,
      referenceTokens: 1000,
      historyTokens: 0,
      outputTokens: 0,
      cacheHitRatio: 0.5,
      feature: 'chat',
    });
    expect(tokens.cachedInputTokens).toBe(500);
    expect(tokens.inputTokens).toBe(500 + 1500); // freshReference(500) + overhead(1500)
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test tests/calculator.test.js`
Expected: FAIL（`calculator.js` 未作成）

- [ ] **Step 3: calculator.js を実装**

`src/calculator.js`:
```javascript
import {
  MODEL_RATES,
  EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE,
  USD_PER_CREDIT,
  FEATURE_OVERHEAD_TOKENS,
} from './rates.js';

function pickRateTable(modelRates, contextTokens) {
  if (modelRates.longContext && contextTokens > modelRates.longContext.thresholdTokens) {
    return modelRates.longContext;
  }
  return modelRates;
}

function toCredits(tokens, usdPer1M) {
  if (usdPer1M == null) return 0;
  return (tokens * usdPer1M) / 10000;
}

export function calculateCredits(tokens, modelKey) {
  const {
    inputTokens = 0,
    cachedInputTokens = 0,
    cacheWriteTokens = 0,
    outputTokens = 0,
  } = tokens;

  const modelRates = MODEL_RATES[modelKey];
  if (!modelRates) throw new Error(`Unknown model: ${modelKey}`);

  // ロングコンテキスト判定は inputTokens 単体ではなく contextTokens（必須修正4）で行う
  const contextTokens = inputTokens + cachedInputTokens + cacheWriteTokens;
  const rate = pickRateTable(modelRates, contextTokens);

  const inputCredits       = toCredits(inputTokens, rate.input);
  const cachedInputCredits = toCredits(cachedInputTokens, rate.cachedInput);
  const cacheWriteCredits  = toCredits(cacheWriteTokens, rate.cacheWrite);
  const outputCredits      = toCredits(outputTokens, rate.output);
  const totalCredits = inputCredits + cachedInputCredits + cacheWriteCredits + outputCredits;

  return {
    modelKey,
    label: modelRates.label,
    usedLongContextRate: rate !== modelRates,
    breakdown: {
      inputCredits: round4(inputCredits),
      cachedInputCredits: round4(cachedInputCredits),
      cacheWriteCredits: round4(cacheWriteCredits),
      outputCredits: round4(outputCredits),
    },
    totalCredits: round4(totalCredits),
    totalUSD: round4(creditsToUSD(totalCredits)),
  };
}

// 登録済みモデルすべてを動的に比較する。モデル数は Object.keys(MODEL_RATES) に追従するため、
// モデルの追加・削除があってもこの関数・呼び出し側のテストは変更不要。
export function compareModels(tokens) {
  return Object.keys(MODEL_RATES)
    .map((modelKey) => calculateCredits(tokens, modelKey))
    .sort((a, b) => a.totalCredits - b.totalCredits);
}

export function calculateCodeReviewCredits(diffLines) {
  const totalCredits = diffLines * EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE;
  return {
    diffLines,
    totalCredits: round4(totalCredits),
    totalUSD: round4(creditsToUSD(totalCredits)),
  };
}

export function creditsToUSD(credits) {
  return credits * USD_PER_CREDIT;
}

// Chat/CLI 用の tokens オブジェクトを組み立てる。
// system prompt / tool definitions / custom instructions 等の見えないオーバーヘッドを
// FEATURE_OVERHEAD_TOKENS で加算し、cacheHitRatio に応じて reference tokens を
// cachedInputTokens と freshReferenceTokens に振り分ける。
export function buildChatCliTokens({
  promptTokens = 0,
  referenceTokens = 0,
  historyTokens = 0,
  outputTokens = 0,
  cacheHitRatio = 0,
  feature = 'chat',
}) {
  const normalizedCacheHitRatio = Math.min(Math.max(cacheHitRatio, 0), 1);
  const overheadTokens = FEATURE_OVERHEAD_TOKENS[feature] ?? 0;

  const cachedInputTokens = Math.ceil(referenceTokens * normalizedCacheHitRatio);
  const freshReferenceTokens = Math.ceil(referenceTokens * (1 - normalizedCacheHitRatio));

  return {
    inputTokens: Math.ceil(promptTokens + freshReferenceTokens + historyTokens + overheadTokens),
    cachedInputTokens,
    cacheWriteTokens: 0,
    outputTokens: Math.ceil(outputTokens),
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test`
Expected: 全テスト PASS（rates + tokenizer + calculator）

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: credit calculation with context-based long-context detection and feature overhead"
```

---

## Task 4: UI 実装 (index.html + ui.js)

**Files:**
- Create: `index.html`
- Create: `src/ui.js`

**Interfaces:**
- Consumes: `estimateTextTokens`, `estimateFileTokens`, `estimateHistoryTokens` (tokenizer.js)
- Consumes: `buildChatCliTokens`, `calculateCredits`, `compareModels`, `calculateCodeReviewCredits`, `creditsToUSD` (calculator.js)
- Consumes: `MODEL_RATES` (rates.js)

> **Note:** ブラウザは ES modules を `file://` で読む際に CORS 制限がある。開発中は `npx serve .` でローカルサーバーを立て、配布時は全 JS を inline embed する（Task 5）。

- [ ] **Step 1: 機能セレクタを実装**

`<select id="featureMode">` で「Copilot Chat」「Copilot CLI」「Copilot code review」の3択を切り替える。`chat`/`cli` は同一フォーム・同一計算式（`buildChatCliTokens` → `calculateCredits`/`compareModels`）を使い、`codeReview` は専用フォームに切り替える。

- [ ] **Step 2: index.html の骨格を作成**

`index.html`（要点。CSS はカード型レイアウトで既存版を踏襲）:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Copilot クレジット消費量計算ツール</title>
  <style>
    /* カード型レイアウト、フォーム、結果テーブルのスタイル。
       既存の GitHub 風配色（border #d0d7de, accent #0969da, 警告 #cf222e）を踏襲する。 */
  </style>
</head>
<body>
  <h1>GitHub Copilot クレジット消費量計算ツール</h1>
  <p class="subtitle">
    2026/6/1 に premium request 課金は廃止され、GitHub AI Credits（1クレジット = $0.01）の従量課金制に移行しました。
    Chat / CLI / code review の消費量を事前見積もりし、事務局承認プロセスに活用してください。
  </p>

  <div class="provisional-note">
    ⚠️ <code>EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE</code> は実測前の暫定値です。<code>src/rates.js</code> の値を確認してください。
  </div>

  <div class="overhead-note">
    ℹ️ Chat/CLI では system prompt・tool definitions 等の見えない文脈分として、機能ごとの概算オーバーヘッド（<code>FEATURE_OVERHEAD_TOKENS</code>）を入力トークンに自動加算しています。
  </div>

  <div class="filesize-note">
    ℹ️ ファイルサイズ(KB)からのトークン推定は簡易概算です。Word/Excel/PowerPoint/PDF は圧縮・画像・メタデータ等の影響で実際のトークン量と差が出ることがあります。精度を上げたい場合は本文をテキスト欄へ貼り付けてください。
  </div>

  <div class="card">
    <label for="featureMode">機能</label>
    <select id="featureMode">
      <option value="chat">Copilot Chat</option>
      <option value="cli">Copilot CLI</option>
      <option value="codeReview">Copilot code review</option>
    </select>
  </div>

  <!-- Chat/CLI 用フォーム -->
  <div class="card" id="chatCliForm">
    <h2>入力設定</h2>
    <label for="modelId">使用モデル</label>
    <select id="modelId"></select> <!-- provider ごとに <optgroup> でグルーピング -->

    <label for="promptText">プロンプト・指示文</label>
    <textarea id="promptText"></textarea>
    <span class="help-text" id="promptTokenHint"></span>

    <label for="contextText">参照コード・設計書（テキスト）</label>
    <textarea id="contextText"></textarea>
    <span class="help-text" id="contextTokenHint"></span>

    <div id="fileList"></div>
    <button id="btnAddFile">＋ ファイルを追加</button>

    <label for="historyTurns">今回のリクエストに含める過去会話ターン数</label>
    <input type="number" id="historyTurns" value="0" min="0" max="100">
    <span class="help-text">参照する過去会話ターン数。多いほど履歴分のトークンが今回のリクエストに加算されます。</span>

    <label for="outputChars">想定回答文字数</label>
    <input type="number" id="outputChars" value="1500" min="1">

    <label for="cachedInputPct">キャッシュ入力割合 (%)</label>
    <input type="number" id="cachedInputPct" value="0" min="0" max="100">

    <button class="btn-calc" id="btnCalcChat">クレジット消費量を計算する</button>
  </div>

  <!-- code review 用フォーム -->
  <div class="card" id="codeReviewForm" style="display:none">
    <h2>Copilot code review</h2>
    <p class="help-text">モデルは GitHub 側で自動選択されるため選択欄はありません。</p>
    <label for="diffLines">変更行数（diff行数）</label>
    <input type="number" id="diffLines" value="200" min="1">
    <button class="btn-calc" id="btnCalcCodeReview">クレジット消費量を計算する</button>
  </div>

  <!-- 結果エリア -->
  <div id="results" style="display:none">
    <div class="card">
      <h2>計算結果</h2>
      <div class="result-grid">
        <div class="result-tile"><div class="value" id="resCredits">-</div><div class="label">消費クレジット</div></div>
        <div class="result-tile"><div class="value" id="resUSD">-</div><div class="label">概算金額 (USD)</div></div>
      </div>
      <table><thead><tr><th>内訳</th><th>クレジット</th></tr></thead><tbody id="breakdownBody"></tbody></table>
    </div>

    <div class="card" id="comparisonCard">
      <h2>モデル別比較（登録済みモデルすべて、provider ごとにグルーピング表示）</h2>
      <table><thead><tr><th>モデル</th><th>提供元</th><th>クレジット</th><th>USD</th></tr></thead><tbody id="comparisonBody"></tbody></table>
    </div>
  </div>

  <script type="module" src="src/ui.js"></script>
</body>
</html>
```

- [ ] **Step 3: ui.js を実装**

`src/ui.js` の要点:
```javascript
import { MODEL_RATES } from './rates.js';
import { estimateTextTokens, estimateFileTokens, estimateHistoryTokens } from './tokenizer.js';
import { buildChatCliTokens, calculateCredits, compareModels, calculateCodeReviewCredits, creditsToUSD } from './calculator.js';

// モデルセレクトを provider ごとに <optgroup> でグルーピングして生成（Object.entries(MODEL_RATES) 由来、数は固定しない）
function populateModelSelect() { /* ... */ }

// featureMode の切り替えで chatCliForm / codeReviewForm の表示を切り替え、
// codeReview 選択時は comparisonCard を非表示にする
function bindFeatureModeToggle() { /* ... */ }

// プロンプト・参照テキスト・添付ファイル・過去会話ターン数からトークンを集計し、
// buildChatCliTokens に渡して tokens オブジェクトを組み立てる
function collectChatCliTokens(feature) {
  const promptTokens = estimateTextTokens(document.getElementById('promptText').value);
  const contextTokens = estimateTextTokens(document.getElementById('contextText').value);
  let fileTokens = 0;
  document.querySelectorAll('.file-item').forEach((row) => {
    fileTokens += estimateFileTokens(/* ... */);
  });
  const historyTurns = parseInt(document.getElementById('historyTurns').value) || 0;
  const historyTokens = estimateHistoryTokens(historyTurns, /* avgUserChars */ 500, /* avgAssistantChars */ 1000);
  const outputTokens = estimateTextTokens('a'.repeat(parseInt(document.getElementById('outputChars').value) || 0));
  const cacheHitRatio = (parseFloat(document.getElementById('cachedInputPct').value) || 0) / 100;

  return buildChatCliTokens({
    promptTokens,
    referenceTokens: contextTokens + fileTokens,
    historyTokens,
    outputTokens,
    cacheHitRatio,
    feature,
  });
}

function bindCalcChatButton() {
  document.getElementById('btnCalcChat').addEventListener('click', () => {
    const feature = document.getElementById('featureMode').value; // 'chat' | 'cli'
    const tokens = collectChatCliTokens(feature);
    const modelId = document.getElementById('modelId').value;
    const result = calculateCredits(tokens, modelId);
    const comparisons = compareModels(tokens);
    renderChatResult(result, comparisons);
  });
}

function bindCalcCodeReviewButton() {
  document.getElementById('btnCalcCodeReview').addEventListener('click', () => {
    const diffLines = parseInt(document.getElementById('diffLines').value) || 0;
    const result = calculateCodeReviewCredits(diffLines);
    renderCodeReviewResult(result);
  });
}

// renderChatResult / renderCodeReviewResult: #resCredits, #resUSD, #breakdownBody,
// #comparisonBody (chat/CLIのみ) を更新し #results を表示する

populateModelSelect();
bindFeatureModeToggle();
bindCalcChatButton();
bindCalcCodeReviewButton();
```

- [ ] **Step 4: ローカルサーバーで動作確認**

Run: `npx serve . -p 3000`
Open: `http://localhost:3000`

確認項目:
- [ ] 機能セレクタで Chat/CLI/code review を切り替えるとフォームが正しく切り替わる
- [ ] モデルドロップダウンが provider ごとにグルーピング表示される
- [ ] プロンプト欄に日本語を入力するとトークン数ヒントが更新される
- [ ] 「今回のリクエストに含める過去会話ターン数」を増やすと入力トークンが増える
- [ ] 「計算する」ボタンでクレジット・USD が表示される
- [ ] Chat/CLI ではモデル比較テーブルが登録済みモデルすべてを対象にコスト昇順で表示される
- [ ] code review ではモデル比較テーブルが表示されない
- [ ] overhead / ファイルサイズ推定の注意書きが表示されている

- [ ] **Step 5: コミット**

```bash
git add index.html src/ui.js
git commit -m "feat: implement UI for chat/CLI/code review credit estimation"
```

---

## Task 5: スタンドアロン配布版の生成 (build.js)

**Files:**
- Create: `build.js`
- Produces: `dist/index.html`

**Context:** `file://` プロトコルでは ES modules の CORS 制限があるため、配布版は JS を全て `<script>` タグに inline で埋め込む。この方式（正規表現による import/export 除去）は壊れやすいため、最低限の生成物検証を追加する（必須修正9）。

- [ ] **Step 1: build.js を作成**

```javascript
// build.js — ブラウザで ES modules を使うと file:// で CORS エラーになるため
// 全 JS を 1 ファイルに inline embed して dist/index.html を出力する
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const rates      = readFileSync('src/rates.js',      'utf8');
const tokenizer  = readFileSync('src/tokenizer.js',  'utf8');
const calculator = readFileSync('src/calculator.js', 'utf8');
const ui         = readFileSync('src/ui.js',         'utf8');

let html = readFileSync('index.html', 'utf8');

// ES module の import/export を除去（inline では不要）
const strip = (s) => s
  .replace(/^export\s+(function|const|class)/gm, '$1')
  .replace(/^export\s+\{[^}]+\};\s*$/gm, '')
  .replace(/^import\s+.*?from\s+['"][^'"]+['"];\s*$/gm, '');

const combined = [rates, tokenizer, calculator, ui].map(strip).join('\n\n');

html = html.replace(
  '<script type="module" src="src/ui.js"></script>',
  `<script>\n${combined}\n</script>`
);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html, 'utf8');

// 最低限の生成物検証（必須修正9）:
// strip の正規表現が壊れて import/export が残ったり、関数が inline されなかった場合に
// ビルドを失敗させて気づけるようにする。
const requiredSnippets = [
  'MODEL_RATES',
  'estimateTextTokens',
  'estimateHistoryTokens',
  'calculateCredits',
  'buildChatCliTokens',
  'populateModelSelect',
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    throw new Error(`Build failed: missing ${snippet}`);
  }
}

console.log('Built dist/index.html');
```

- [ ] **Step 2: ビルドを実行**

Run: `npm run build`
Expected: `Built dist/index.html` が表示され、`dist/index.html` が生成される（`requiredSnippets` チェックに失敗した場合は例外で停止する）

- [ ] **Step 3: (任意) Jest でビルド成果物の存在確認テストを追加**

MVPでは Step 1 の `build.js` 内検証のみで可とする。追加する場合は以下のようなテストでよい。

```javascript
import { existsSync, statSync } from 'fs';

it('dist/index.html が生成されている', () => {
  expect(existsSync('dist/index.html')).toBe(true);
  expect(statSync('dist/index.html').size).toBeGreaterThan(10000);
});
```

- [ ] **Step 4: dist/index.html をブラウザで直接開いて動作確認（file:// プロトコル）**

Task 4 Step 4 と同じ確認項目をすべて再確認する。

- [ ] **Step 5: コミット**

```bash
git add build.js dist/index.html
git commit -m "build: add dist/index.html build script with output validation"
```

---

## Task 6: README 更新 + 最終検証（シナリオ検証は任意）

**Files:**
- Modify: `README.md`
- (任意) Create: `docs/scenarios/scenarios.md`（必須修正7: MVPでは必須成果物ではない。README代表例1〜2件で代替可）

- [ ] **Step 1: README.md を新スコープに合わせて全面書き換え**
  - 課金モデル説明（premium request 廃止・従量課金・$0.01/credit）
  - 対象機能: Chat / CLI / code review（チーム機能は無い旨を明記）
  - 使い方（`dist/index.html` をダブルクリック）
  - 単価更新方法（`src/rates.js` の `MODEL_RATES` / `FEATURE_OVERHEAD_TOKENS` / `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` が更新対象）
  - 対応モデル一覧は「登録済みモデルすべて（provider別）」と表現し、特定の数を書かない
  - `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` が実測前の暫定係数であることを明記:
    ```text
    Copilot code review は GitHub 側の内部処理・モデル選択が非公開のため、
    変更行数 × 暫定係数で概算します。
    この係数は実測データ取得後に更新してください。
    ```
  - ファイルサイズKB推定の限界を明記:
    ```text
    ファイルサイズKBからの推定は簡易概算です。
    Word / Excel / PowerPoint / PDF は圧縮・画像・メタデータ・数式・表構造の影響が大きく、
    実際にCopilotへ投入されるトークン量とは差が出る可能性があります。
    精度を上げる場合は、対象本文をテキスト欄へ貼り付けてください。
    ```
  - 代表シナリオ1〜2例（例: Chat/UT自動作成、code review/PR200行）を簡潔に記載すれば `docs/scenarios/scenarios.md` は作成不要

- [ ] **Step 2: (任意) シナリオ検証と docs/scenarios/scenarios.md 作成**
  - Chat: 「ユニットテスト自動作成」相当のプロンプト＋添付ファイルで計算し、モデル比較結果を記録
  - CLI: 「コードレビューコメント生成」相当のプロンプトで計算
  - code review: 変更行数 200行程度の PR を想定して計算
  - 作成する場合のみ `docs/scenarios/scenarios.md` にまとめる。作成しない場合は README の代表例のみで良い。

- [ ] **Step 3: 最終検証（下記「検証」セクションを実施）**

- [ ] **Step 4: コミット**

```bash
git add README.md
git commit -m "docs: finalize usage guide for chat/CLI/code review scope"
```

（`docs/scenarios/scenarios.md` を作成した場合は `git add docs/scenarios/scenarios.md` も追加）

---

## 検証 (Verification)

### 自動テスト
```bash
npm test
```
Expected: 全テスト PASS（rates + tokenizer + calculator[calculateCredits/compareModels/calculateCodeReviewCredits/creditsToUSD/buildChatCliTokens]）

### ブラウザ動作確認

**Case 1: 基本動作（Chat）**
1. `dist/index.html` をダブルクリックで開く
2. 機能を「Copilot Chat」、モデルを「Claude Sonnet 4.6」に設定
3. プロンプトに「テストコードを書いてください」(約15文字)と入力
4. ファイルに Excel 100KB (日本語) を追加
5. 「計算する」クリック → クレジット・USD が表示され、数値が 0 より大きいこと

**Case 2: モデル比較**
- 結果のモデル比較テーブルが登録済みモデルすべて（Anthropicはバージョン別に複数行）を表示し、コスト昇順であること
- モデルを `src/rates.js` に追加・削除しても、比較テーブルの行数がそれに追従すること（数を固定していないことの確認）

**Case 3: キャッシュ効果**
- キャッシュ入力トークン比率を 50% に設定すると、0% 時よりクレジットが低下すること

**Case 4: ロングコンテキスト自動切替**
- 入力トークン合計を 272,000 超に設定して GPT-5.4 を選択すると、longContext 側の単価（input 5.00）が適用され、通常単価（2.50）より高い結果になること
- Gemini 3.1 Pro で 200,000 超のケースも同様に確認
- キャッシュ入力トークンを含めた `contextTokens` が閾値を超えるが `inputTokens` 単体では超えないケースでも longContext 側が適用されること

**Case 5: 過去会話ターン数（履歴）**
- 「今回のリクエストに含める過去会話ターン数」を 0→3 に増やすと、入力トークン・クレジットが線形に増加すること（累積的に急増しないこと）

**Case 6: code review**
- 機能を「Copilot code review」に切り替えるとモデルドロップダウン・モデル比較テーブルが非表示になること
- 変更行数に 200 を入力 → `200 × EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` と一致するクレジットが表示されること

**Case 7: 配布ファイル確認**
- `dist/index.html` 単体を別 PC にコピーしてブラウザで開き、インターネット接続なしで動作すること

---

## Phase 1 調査完了後の単価更新手順

1. GitHub Copilot 公式ドキュメント・事務局提供資料から各モデルの実単価を再確認
2. `src/rates.js` の `MODEL_RATES` 内、`// 要確認` コメント付きエントリ（特に `claude-sonnet-5` のプロモ価格終了後の単価）を実値に更新
3. `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` を実測データに基づき較正
4. `FEATURE_OVERHEAD_TOKENS`（chat/cli）を実測データに基づき較正
5. `npm run build` を再実行
6. `dist/index.html` を配布
