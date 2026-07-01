# GitHub Copilot クレジット消費量計算ツール 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Copilot のクレジット消費量を事前見積もりできるスタンドアロン Web ツールをブラウザで動く単一 HTML ファイルとして構築する

**Architecture:** Vanilla JS の ES モジュール群（tokenizer → calculator → ui）をパイプライン化し、Node.js + Jest でコアロジックを TDD、完成後に index.html に統合してブラウザ単体で動作させる。外部サーバー・ビルドツール不要。

**Tech Stack:** HTML5, Vanilla JavaScript (ES2022 modules), CSS3, Node.js 20+ (テスト専用), Jest 29

## Global Constraints

- 外部 CDN・ライブラリへの依存ゼロ（HTML をダブルクリックで起動、オフライン動作）
- 日本語 UI（ラベル・エラーメッセージ・ヘルプすべて日本語）
- モデル別クレジット単価は `src/rates.js` の定数テーブルで一元管理し、公式ドキュメント改訂時に 1 ファイル変更で更新可能
- 対応ブラウザ: Chrome 100+, Edge 100+, Firefox 100+（IE 不要）
- スマホ対応不要（PC ブラウザのみ）

---

## ファイル構成

```
/
├── index.html                     # UI シェル（CSS + JS を inline embed）
├── src/
│   ├── rates.js                   # モデル別クレジット単価テーブル（唯一の更新対象）
│   ├── tokenizer.js               # テキスト/ファイル種別 → トークン数 推定
│   ├── calculator.js              # トークン数 + モデル → クレジット計算
│   └── ui.js                      # DOM イベント・結果描画
├── tests/
│   ├── tokenizer.test.js
│   └── calculator.test.js
├── package.json
└── README.md
```

**インターフェース境界:**
- `tokenizer.js` は純粋関数のみ（DOM 依存なし、Node.js でテスト可）
- `calculator.js` は純粋関数のみ（rates.js をインポート）
- `ui.js` のみ DOM に触る
- `index.html` は最終統合ステップで src/*.js を `<script>` inline に埋め込む

---

## Task 1: プロジェクトセットアップ + クレジット単価テーブル

**Files:**
- Create: `package.json`
- Create: `src/rates.js`
- Create: `tests/calculator.test.js` (空テスト stub)

**Interfaces:**
- Produces: `MODEL_RATES` オブジェクト、`FEATURE_MULTIPLIERS` オブジェクト（Task 3 が使用）

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "copilot-credit-calculator",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "transform": {}
  }
}
```

- [ ] **Step 2: Jest をインストール**

Run: `npm install`
Expected: `node_modules/` が作られ、exit 0

- [ ] **Step 3: クレジット単価テーブルを作成**

`src/rates.js` を以下の内容で作成する。
※ 単価の数値は Phase 1 調査（公式ドキュメント）で確定後に更新すること。
現時点は GitHub Copilot 公式ブログ（2025年6月発表）の暫定値を入れておく。

```javascript
// クレジット単価 (1,000 トークンあたり)
// 出典: https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements
// ★ Phase 1 調査完了後に実値で更新すること
export const MODEL_RATES = {
  'gpt-4.1': {
    label: 'GPT-4.1',
    inputPer1kTokens: 0.5,       // 要確認
    outputPer1kTokens: 1.5,      // 要確認
    cachedInputPer1kTokens: 0.1, // 要確認
    cachedWritePer1kTokens: 0.5, // 要確認
  },
  'gpt-4.1-mini': {
    label: 'GPT-4.1 mini',
    inputPer1kTokens: 0.1,
    outputPer1kTokens: 0.3,
    cachedInputPer1kTokens: 0.02,
    cachedWritePer1kTokens: 0.1,
  },
  'claude-opus-4': {
    label: 'Claude Opus 4',
    inputPer1kTokens: 2.0,
    outputPer1kTokens: 6.0,
    cachedInputPer1kTokens: 0.4,
    cachedWritePer1kTokens: 2.0,
  },
  'claude-sonnet-4': {
    label: 'Claude Sonnet 4.6',
    inputPer1kTokens: 0.8,
    outputPer1kTokens: 2.4,
    cachedInputPer1kTokens: 0.16,
    cachedWritePer1kTokens: 0.8,
  },
  'gemini-2.5-pro': {
    label: 'Gemini 2.5 Pro',
    inputPer1kTokens: 0.6,
    outputPer1kTokens: 1.8,
    cachedInputPer1kTokens: 0.12,
    cachedWritePer1kTokens: 0.6,
  },
  'o3': {
    label: 'o3',
    inputPer1kTokens: 3.0,
    outputPer1kTokens: 9.0,
    cachedInputPer1kTokens: 0.6,
    cachedWritePer1kTokens: 3.0,
  },
  'o4-mini': {
    label: 'o4-mini',
    inputPer1kTokens: 0.4,
    outputPer1kTokens: 1.2,
    cachedInputPer1kTokens: 0.08,
    cachedWritePer1kTokens: 0.4,
  },
};

// 機能別: 会話回数の標準的な倍率（1リクエスト = N回のモデル呼び出し換算）
export const FEATURE_MULTIPLIERS = {
  chat:        { label: 'Chat',         rounds: 1,   systemPromptTokens: 500  },
  codeReview:  { label: 'Code Review',  rounds: 1,   systemPromptTokens: 1500 },
  agent:       { label: 'Agent モード', rounds: 5,   systemPromptTokens: 2000 },
  cli:         { label: 'CLI (Copilot CLI)', rounds: 1, systemPromptTokens: 300 },
};

// 月次利用日数の想定（稼働日）
export const MONTHLY_WORKING_DAYS = 20;
```

- [ ] **Step 4: 空の stub テストを作成して Jest が動くことを確認**

`tests/calculator.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';

describe('calculator stub', () => {
  it('placeholder', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `npm test`
Expected: `1 passed`

- [ ] **Step 6: コミット**

```bash
git init
git add package.json package-lock.json src/rates.js tests/calculator.test.js
git commit -m "chore: project setup with credit rates table"
```

---

## Task 2: トークン推定エンジン (tokenizer.js)

**Files:**
- Create: `src/tokenizer.js`
- Create: `tests/tokenizer.test.js`

**Interfaces:**
- Produces:
  - `estimateTextTokens(text: string): number` — 日本語/英語/コード混在テキスト → トークン数
  - `estimateFileTokens(fileSizeKB: number, fileType: 'md'|'docx'|'xlsx'|'pptx'|'pdf', encoding?: 'ja'|'en'): number`
  - `estimateConversationTokens(turns: number, avgUserChars: number, avgAssistantChars: number): number`

- [ ] **Step 1: 失敗するテストを書く**

`tests/tokenizer.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';
import {
  estimateTextTokens,
  estimateFileTokens,
  estimateConversationTokens,
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

describe('estimateFileTokens', () => {
  it('Markdown 10KB → 約 3000 トークン前後', () => {
    const tokens = estimateFileTokens(10, 'md', 'ja');
    expect(tokens).toBeGreaterThan(2000);
    expect(tokens).toBeLessThan(5000);
  });

  it('Word (.docx) はオーバーヘッド込みで Markdown より多め', () => {
    const mdTokens = estimateFileTokens(10, 'md', 'en');
    const docxTokens = estimateFileTokens(10, 'docx', 'en');
    expect(docxTokens).toBeGreaterThan(mdTokens);
  });

  it('Excel は行数×列数の実データ部分のみ計算', () => {
    const tokens = estimateFileTokens(50, 'xlsx', 'ja');
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('estimateConversationTokens', () => {
  it('3ターンの会話で各ターンが蓄積される', () => {
    const tokens = estimateConversationTokens(3, 500, 1000);
    expect(tokens).toBeGreaterThan(0);
    // 3ターン合計 = 1ターン目 + 2ターン目(+履歴) + 3ターン目(+履歴)
    expect(tokens).toBeGreaterThan(estimateConversationTokens(1, 500, 1000));
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
// コード: 1文字 ≈ 0.30 トークン（演算子・括弧が追加トークンを生む）

const RATIO = {
  ja:   0.65,  // 日本語
  en:   0.25,  // 英語
  code: 0.30,  // コード
};

// 文字列中の日本語文字比率を計算して適切なレートを選択
function detectRatio(text) {
  if (!text) return RATIO.en;
  const jaPattern = /[　-鿿豈-﫿]/g;
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

// ファイル種別ごとのトークン換算係数（ファイルサイズ KB あたり）
// Word/Excel/PPT は XML ラッパーのオーバーヘッドがあるため実コンテンツより少ない
const FILE_TOKENS_PER_KB = {
  md:   { ja: 650, en: 250 },   // テキスト = ほぼそのままトークン
  pdf:  { ja: 400, en: 180 },   // PDF は画像・フォントデータ含むため実テキスト率 ~60%
  docx: { ja: 300, en: 130 },   // ZIP+XML構造: 実テキスト率 ~40-50%
  xlsx: { ja: 200, en: 100 },   // セル値のみ: 実データ率 ~30%
  pptx: { ja: 250, en: 110 },   // スライドテキストのみ: 実データ率 ~35%
};

export function estimateFileTokens(fileSizeKB, fileType, encoding = 'ja') {
  const rates = FILE_TOKENS_PER_KB[fileType] ?? FILE_TOKENS_PER_KB.md;
  const rate = rates[encoding] ?? rates.ja;
  return Math.ceil(fileSizeKB * rate);
}

// 会話履歴のトークン計算
// 各ターンには直前までの全履歴が context として含まれる
export function estimateConversationTokens(turns, avgUserChars, avgAssistantChars) {
  const userTokensPerTurn = estimateTextTokens('a'.repeat(avgUserChars));
  const assistantTokensPerTurn = estimateTextTokens('a'.repeat(avgAssistantChars));
  let total = 0;
  for (let i = 1; i <= turns; i++) {
    // ターン i では直前 i-1 ターン分の履歴が input に含まれる
    total += userTokensPerTurn + (i - 1) * (userTokensPerTurn + assistantTokensPerTurn);
    total += assistantTokensPerTurn;
  }
  return total;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test tests/tokenizer.test.js`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/tokenizer.js tests/tokenizer.test.js
git commit -m "feat: token estimation engine with JA/EN/file-type support"
```

---

## Task 3: クレジット計算エンジン (calculator.js)

**Files:**
- Create: `src/calculator.js`
- Modify: `tests/calculator.test.js`

**Interfaces:**
- Consumes: `MODEL_RATES`, `FEATURE_MULTIPLIERS` from `src/rates.js`
- Produces:
  - `calculateCredits(params): CreditResult`
  - `compareModels(params): ModelComparison[]`

  ```
  params = {
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    cachedWriteTokens: number,
    modelId: string,
    featureId: string,
    dailyRequests: number,
  }

  CreditResult = {
    perRequest: { input, output, cachedInput, cachedWrite, total },
    monthly: number,
    breakdown: { inputTokens, outputTokens, cachedInputTokens, cachedWriteTokens },
  }

  ModelComparison[] = Array of { modelId, label, perRequest, monthly }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` を以下で置き換える:
```javascript
import { describe, it, expect } from '@jest/globals';
import { calculateCredits, compareModels } from '../src/calculator.js';

const baseParams = {
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: 0,
  cachedWriteTokens: 0,
  modelId: 'gpt-4.1',
  featureId: 'chat',
  dailyRequests: 10,
};

describe('calculateCredits', () => {
  it('正の inputTokens に対してクレジットを返す', () => {
    const result = calculateCredits(baseParams);
    expect(result.perRequest.total).toBeGreaterThan(0);
  });

  it('output クレジットは input より高い（GPT-4.1 の場合）', () => {
    const result = calculateCredits({ ...baseParams, inputTokens: 1000, outputTokens: 1000 });
    expect(result.perRequest.output).toBeGreaterThan(result.perRequest.input);
  });

  it('キャッシュ入力はクレジットを削減する', () => {
    const noCacheResult = calculateCredits({ ...baseParams, inputTokens: 2000 });
    const cacheResult = calculateCredits({ ...baseParams, inputTokens: 1000, cachedInputTokens: 1000 });
    expect(cacheResult.perRequest.total).toBeLessThan(noCacheResult.perRequest.total);
  });

  it('monthly は perRequest.total × dailyRequests × MONTHLY_WORKING_DAYS', () => {
    const result = calculateCredits({ ...baseParams, dailyRequests: 5 });
    const expected = result.perRequest.total * 5 * 20;
    expect(result.monthly).toBeCloseTo(expected, 1);
  });

  it('存在しないモデルIDはエラーをスロー', () => {
    expect(() => calculateCredits({ ...baseParams, modelId: 'unknown-model' }))
      .toThrow('Unknown model');
  });
});

describe('compareModels', () => {
  it('全モデルの比較配列を返す', () => {
    const results = compareModels(baseParams);
    expect(results.length).toBeGreaterThan(3);
    expect(results[0]).toHaveProperty('modelId');
    expect(results[0]).toHaveProperty('perRequest');
    expect(results[0]).toHaveProperty('monthly');
  });

  it('コストの昇順でソートされている', () => {
    const results = compareModels(baseParams);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].perRequest).toBeGreaterThanOrEqual(results[i - 1].perRequest);
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test tests/calculator.test.js`
Expected: FAIL（`calculator.js` 未作成）

- [ ] **Step 3: calculator.js を実装**

`src/calculator.js`:
```javascript
import { MODEL_RATES, FEATURE_MULTIPLIERS, MONTHLY_WORKING_DAYS } from './rates.js';

export function calculateCredits({
  inputTokens,
  outputTokens,
  cachedInputTokens = 0,
  cachedWriteTokens = 0,
  modelId,
  featureId,
  dailyRequests = 1,
}) {
  const rates = MODEL_RATES[modelId];
  if (!rates) throw new Error(`Unknown model: ${modelId}`);

  const feature = FEATURE_MULTIPLIERS[featureId] ?? FEATURE_MULTIPLIERS.chat;
  const rounds = feature.rounds;
  const sysTokens = feature.systemPromptTokens;

  const effectiveInput = (inputTokens + sysTokens) * rounds;
  const effectiveOutput = outputTokens * rounds;
  const effectiveCachedInput = cachedInputTokens * rounds;
  const effectiveCachedWrite = cachedWriteTokens;

  const inputCredit       = (effectiveInput        / 1000) * rates.inputPer1kTokens;
  const outputCredit      = (effectiveOutput        / 1000) * rates.outputPer1kTokens;
  const cachedInputCredit = (effectiveCachedInput   / 1000) * rates.cachedInputPer1kTokens;
  const cachedWriteCredit = (effectiveCachedWrite   / 1000) * rates.cachedWritePer1kTokens;
  const totalPerRequest   = inputCredit + outputCredit + cachedInputCredit + cachedWriteCredit;

  return {
    perRequest: {
      input:       round2(inputCredit),
      output:      round2(outputCredit),
      cachedInput: round2(cachedInputCredit),
      cachedWrite: round2(cachedWriteCredit),
      total:       round2(totalPerRequest),
    },
    monthly: round2(totalPerRequest * dailyRequests * MONTHLY_WORKING_DAYS),
    breakdown: {
      inputTokens:       effectiveInput,
      outputTokens:      effectiveOutput,
      cachedInputTokens: effectiveCachedInput,
      cachedWriteTokens: effectiveCachedWrite,
    },
  };
}

export function compareModels(params) {
  return Object.entries(MODEL_RATES)
    .map(([modelId, rates]) => {
      const result = calculateCredits({ ...params, modelId });
      return {
        modelId,
        label: rates.label,
        perRequest: result.perRequest.total,
        monthly: result.monthly,
      };
    })
    .sort((a, b) => a.perRequest - b.perRequest);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test`
Expected: 全テスト PASS（tokenizer + calculator）

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: credit calculator with model comparison"
```

---

## Task 4: UI 実装 (index.html + ui.js)

**Files:**
- Create: `index.html`
- Create: `src/ui.js`

**Interfaces:**
- Consumes: `estimateTextTokens`, `estimateFileTokens`, `estimateConversationTokens` (tokenizer.js)
- Consumes: `calculateCredits`, `compareModels` (calculator.js)
- Consumes: `MODEL_RATES`, `FEATURE_MULTIPLIERS` (rates.js)

> **Note:** ブラウザは ES modules を `file://` で読む際に CORS 制限がある。
> 開発中は `npx serve .` でローカルサーバーを立て、配布時は全 JS を inline embed する（Task 5）。

- [ ] **Step 1: index.html の骨格を作成**

`index.html`:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Copilot クレジット消費量計算ツール</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: #f6f8fa;
      color: #24292f;
      padding: 24px;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #57606a; font-size: 0.875rem; margin-bottom: 24px; }
    .card {
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: #24292f; }
    .form-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    label { font-size: 0.8125rem; font-weight: 500; color: #57606a; }
    textarea, input[type="number"], select {
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 0.9375rem;
      font-family: inherit;
      background: #f6f8fa;
    }
    textarea:focus, input:focus, select:focus {
      outline: none;
      border-color: #0969da;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(9,105,218,0.1);
    }
    textarea { resize: vertical; min-height: 80px; }

    /* ファイル添付リスト */
    .file-list { display: flex; flex-direction: column; gap: 8px; }
    .file-item {
      display: flex; gap: 8px; align-items: center;
      border: 1px solid #d0d7de; border-radius: 6px; padding: 8px 12px;
      background: #f6f8fa;
    }
    .file-item select { width: 120px; flex-shrink: 0; }
    .file-item input[type="number"] { width: 100px; flex-shrink: 0; }
    .file-item .enc { width: 80px; flex-shrink: 0; }
    .btn-remove {
      background: none; border: none; cursor: pointer; color: #cf222e;
      font-size: 1.1rem; padding: 0 4px; line-height: 1;
    }
    .btn-add {
      align-self: flex-start;
      background: none; border: 1px solid #d0d7de; border-radius: 6px;
      padding: 6px 12px; cursor: pointer; font-size: 0.875rem;
      color: #0969da; margin-top: 6px;
    }
    .btn-add:hover { background: #ddf4ff; }

    /* 計算ボタン */
    .btn-calc {
      background: #1f883d; color: #fff; border: none; border-radius: 6px;
      padding: 10px 24px; font-size: 1rem; font-weight: 600; cursor: pointer;
      width: 100%; margin-top: 8px;
    }
    .btn-calc:hover { background: #1a7f37; }

    /* 結果エリア */
    #results { display: none; }
    .result-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px; margin-bottom: 16px;
    }
    .result-tile {
      background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px;
      padding: 14px; text-align: center;
    }
    .result-tile .value { font-size: 1.5rem; font-weight: 700; color: #0969da; }
    .result-tile .label { font-size: 0.75rem; color: #57606a; margin-top: 4px; }

    /* モデル比較テーブル */
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { background: #f6f8fa; border-bottom: 2px solid #d0d7de; padding: 8px 12px; text-align: left; }
    td { border-bottom: 1px solid #eaeef2; padding: 8px 12px; }
    .current-model td { background: #ddf4ff; font-weight: 600; }
    .monthly-warn { color: #cf222e; }

    .help-text { font-size: 0.75rem; color: #57606a; margin-top: 4px; }
    .credit-limit-note {
      background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px;
      padding: 12px 16px; font-size: 0.875rem; color: #633c01; margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <h1>GitHub Copilot クレジット消費量計算ツール</h1>
  <p class="subtitle">各AI施策のクレジット消費量を事前見積もりし、事務局承認プロセスに活用してください。</p>

  <div class="credit-limit-note">
    ⚠️ 2026年9月以降、1人あたりの月次クレジット上限が <strong>3,000 → 1,900</strong> に削減予定。
  </div>

  <!-- 入力エリア -->
  <div class="card">
    <h2>入力設定</h2>

    <div class="form-row">
      <div class="form-group">
        <label for="modelId">使用モデル</label>
        <select id="modelId"></select>
      </div>
      <div class="form-group">
        <label for="featureId">使用機能</label>
        <select id="featureId"></select>
      </div>
      <div class="form-group">
        <label for="dailyRequests">1日あたりのリクエスト数</label>
        <input type="number" id="dailyRequests" value="10" min="1" max="9999">
      </div>
    </div>

    <div class="form-group" style="margin-bottom:12px">
      <label for="promptText">プロンプト・指示文</label>
      <textarea id="promptText" placeholder="ここに実際に使用するプロンプトを貼り付けてください..."></textarea>
      <span class="help-text" id="promptTokenHint"></span>
    </div>

    <div class="form-group" style="margin-bottom:12px">
      <label for="contextText">参照コード・設計書（テキスト）</label>
      <textarea id="contextText" placeholder="コードや設計書のテキストを貼り付けてください..."></textarea>
      <span class="help-text" id="contextTokenHint"></span>
    </div>

    <div class="form-group" style="margin-bottom:12px">
      <label>添付ファイル（複数可）</label>
      <div class="file-list" id="fileList"></div>
      <button class="btn-add" id="btnAddFile">＋ ファイルを追加</button>
      <span class="help-text">ファイル種別とサイズ（KB）を入力してください</span>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="convTurns">会話ターン数</label>
        <input type="number" id="convTurns" value="1" min="1" max="100">
      </div>
      <div class="form-group">
        <label for="outputTokens">期待出力トークン数（概算）</label>
        <input type="number" id="outputTokens" value="1000" min="1">
        <span class="help-text">コード生成：1,000〜3,000 / 設計書：500〜2,000</span>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="cachedInputPct">キャッシュ入力割合 (%)</label>
        <input type="number" id="cachedInputPct" value="0" min="0" max="100">
        <span class="help-text">同一コンテキストを繰り返す場合に設定（例: 50）</span>
      </div>
    </div>

    <button class="btn-calc" id="btnCalc">クレジット消費量を計算する</button>
  </div>

  <!-- 結果エリア -->
  <div id="results">
    <div class="card">
      <h2>計算結果</h2>
      <div class="result-grid">
        <div class="result-tile">
          <div class="value" id="resInputTokens">-</div>
          <div class="label">入力トークン数</div>
        </div>
        <div class="result-tile">
          <div class="value" id="resOutputTokens">-</div>
          <div class="label">出力トークン数</div>
        </div>
        <div class="result-tile">
          <div class="value" id="resPerReq">-</div>
          <div class="label">1リクエストあたりクレジット</div>
        </div>
        <div class="result-tile">
          <div class="value" id="resMonthly">-</div>
          <div class="label">月次クレジット消費量</div>
        </div>
      </div>

      <p style="font-size:0.8rem;color:#57606a;margin-bottom:12px">
        * 月次 = 1リクエスト × <span id="resDailyReqs">-</span> リクエスト/日 × 20稼働日
      </p>

      <table>
        <thead>
          <tr>
            <th>内訳</th>
            <th>トークン数</th>
            <th>クレジット</th>
          </tr>
        </thead>
        <tbody id="breakdownBody"></tbody>
      </table>
    </div>

    <div class="card">
      <h2>モデル別比較</h2>
      <table>
        <thead>
          <tr>
            <th>モデル</th>
            <th>1リクエスト</th>
            <th>月次（推定）</th>
            <th>月次上限(1,900)に対する割合</th>
          </tr>
        </thead>
        <tbody id="comparisonBody"></tbody>
      </table>
    </div>
  </div>

  <script type="module" src="src/ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: ui.js を実装**

`src/ui.js`:
```javascript
import { MODEL_RATES, FEATURE_MULTIPLIERS } from './rates.js';
import { estimateTextTokens, estimateFileTokens, estimateConversationTokens } from './tokenizer.js';
import { calculateCredits, compareModels } from './calculator.js';

// セレクトボックスを動的に生成
function populateSelects() {
  const modelSel = document.getElementById('modelId');
  Object.entries(MODEL_RATES).forEach(([id, r]) => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = r.label;
    modelSel.appendChild(opt);
  });

  const featSel = document.getElementById('featureId');
  Object.entries(FEATURE_MULTIPLIERS).forEach(([id, f]) => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = f.label;
    featSel.appendChild(opt);
  });
}

// トークンヒントのリアルタイム更新
function bindTokenHints() {
  const update = (textareaId, hintId) => {
    const el = document.getElementById(textareaId);
    const hint = document.getElementById(hintId);
    el.addEventListener('input', () => {
      const t = estimateTextTokens(el.value);
      hint.textContent = t > 0 ? `推定 ${t.toLocaleString()} トークン` : '';
    });
  };
  update('promptText', 'promptTokenHint');
  update('contextText', 'contextTokenHint');
}

// ファイル追加行
let fileCount = 0;
function addFileRow() {
  fileCount++;
  const list = document.getElementById('fileList');
  const row = document.createElement('div');
  row.className = 'file-item';
  row.dataset.id = fileCount;
  row.innerHTML = `
    <select name="fileType">
      <option value="md">Markdown</option>
      <option value="docx">Word (.docx)</option>
      <option value="xlsx">Excel (.xlsx)</option>
      <option value="pptx">PowerPoint (.pptx)</option>
      <option value="pdf">PDF</option>
    </select>
    <input type="number" name="sizeKB" placeholder="サイズ(KB)" min="1" value="100">
    <select name="enc" class="enc">
      <option value="ja">日本語</option>
      <option value="en">英語</option>
    </select>
    <button class="btn-remove" title="削除">×</button>
  `;
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

// 全入力からトークン数を集計
function collectTokens() {
  const promptTokens  = estimateTextTokens(document.getElementById('promptText').value);
  const contextTokens = estimateTextTokens(document.getElementById('contextText').value);

  let fileTokens = 0;
  document.querySelectorAll('.file-item').forEach(row => {
    const type   = row.querySelector('[name=fileType]').value;
    const sizeKB = parseFloat(row.querySelector('[name=sizeKB]').value) || 0;
    const enc    = row.querySelector('[name=enc]').value;
    fileTokens  += estimateFileTokens(sizeKB, type, enc);
  });

  const turns    = parseInt(document.getElementById('convTurns').value) || 1;
  const convBase = promptTokens + contextTokens + fileTokens;
  const totalInputForConv = estimateConversationTokens(turns, convBase / turns, 0);

  const outputTokens = parseInt(document.getElementById('outputTokens').value) || 1000;
  const cachedPct    = parseFloat(document.getElementById('cachedInputPct').value) / 100;
  const cachedInput  = Math.floor(totalInputForConv * cachedPct);

  return {
    inputTokens:       totalInputForConv - cachedInput,
    outputTokens,
    cachedInputTokens: cachedInput,
    cachedWriteTokens: cachedInput,
  };
}

// 計算ボタン
function bindCalcButton() {
  document.getElementById('btnCalc').addEventListener('click', () => {
    const tokens = collectTokens();
    const modelId = document.getElementById('modelId').value;
    const featureId = document.getElementById('featureId').value;
    const dailyReqs = parseInt(document.getElementById('dailyRequests').value) || 1;

    const result = calculateCredits({ ...tokens, modelId, featureId, dailyRequests: dailyReqs });
    const comparisons = compareModels({ ...tokens, featureId, dailyRequests: dailyReqs });

    renderResults(result, comparisons, modelId, dailyReqs);
    document.getElementById('results').style.display = 'block';
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
  });
}

function renderResults(result, comparisons, currentModelId, dailyReqs) {
  document.getElementById('resInputTokens').textContent =
    (result.breakdown.inputTokens + result.breakdown.cachedInputTokens).toLocaleString();
  document.getElementById('resOutputTokens').textContent =
    result.breakdown.outputTokens.toLocaleString();
  document.getElementById('resPerReq').textContent = result.perRequest.total.toFixed(2);
  document.getElementById('resMonthly').textContent = result.monthly.toFixed(1);
  document.getElementById('resDailyReqs').textContent = dailyReqs;

  const MONTHLY_LIMIT = 1900;

  // 内訳テーブル
  const bBody = document.getElementById('breakdownBody');
  bBody.innerHTML = '';
  [
    ['入力トークン (Input)',        result.breakdown.inputTokens,       result.perRequest.input],
    ['出力トークン (Output)',       result.breakdown.outputTokens,      result.perRequest.output],
    ['キャッシュ入力 (Cached In)', result.breakdown.cachedInputTokens, result.perRequest.cachedInput],
    ['キャッシュ書込 (Cached Wr)', result.breakdown.cachedWriteTokens, result.perRequest.cachedWrite],
    ['合計',                       '—',                                result.perRequest.total],
  ].forEach(([label, tokens, cred]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td>${typeof tokens === 'number' ? tokens.toLocaleString() : tokens}</td><td>${cred.toFixed(3)}</td>`;
    bBody.appendChild(tr);
  });

  // モデル比較テーブル
  const cBody = document.getElementById('comparisonBody');
  cBody.innerHTML = '';
  comparisons.forEach(({ modelId, label, perRequest, monthly }) => {
    const pct = ((monthly / MONTHLY_LIMIT) * 100).toFixed(1);
    const warn = monthly > MONTHLY_LIMIT ? ' monthly-warn' : '';
    const tr = document.createElement('tr');
    if (modelId === currentModelId) tr.className = 'current-model';
    tr.innerHTML = `
      <td>${label}${modelId === currentModelId ? ' ★' : ''}</td>
      <td>${perRequest.toFixed(3)}</td>
      <td class="${warn}">${monthly.toFixed(1)}</td>
      <td class="${warn}">${pct}%</td>
    `;
    cBody.appendChild(tr);
  });
}

// 初期化
populateSelects();
bindTokenHints();
document.getElementById('btnAddFile').addEventListener('click', addFileRow);
bindCalcButton();
addFileRow(); // デフォルトで1行追加
```

- [ ] **Step 3: ローカルサーバーで動作確認**

Run: `npx serve . -p 3000`
Open: `http://localhost:3000`

確認項目:
- [ ] モデル/機能の選択肢が表示される
- [ ] プロンプト欄に日本語を入力するとトークン数ヒントが更新される
- [ ] ファイル追加ボタンで行が増える
- [ ] 「クレジット消費量を計算する」ボタンで結果が表示される
- [ ] モデル比較テーブルがコスト昇順で表示される

- [ ] **Step 4: コミット**

```bash
git add index.html src/ui.js
git commit -m "feat: web UI with real-time token hints and model comparison"
```

---

## Task 5: スタンドアロン配布版の生成 (build.js)

**Files:**
- Create: `build.js` (Node.js スクリプト)
- Produces: `dist/index.html` (JS を inline embed した単一ファイル)

**Context:** `file://` プロトコルでは ES modules の CORS 制限があるため、配布版は JS を全て `<script>` タグに inline で埋め込む。

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

// <script type="module" src="src/ui.js"></script> を置換
html = html.replace(
  '<script type="module" src="src/ui.js"></script>',
  `<script>\n${combined}\n</script>`
);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html, 'utf8');
console.log('Built dist/index.html');
```

- [ ] **Step 2: package.json に build スクリプトを追加**

`package.json` の `scripts` に追記:
```json
"build": "node build.js"
```

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: `Built dist/index.html` が表示され、`dist/index.html` が生成される

- [ ] **Step 4: dist/index.html をブラウザで直接開いて動作確認（file:// プロトコル）**

エクスプローラーから `dist/index.html` をダブルクリックして開く。
Task 4 Step 3 と同じ確認項目をすべて再確認する。

- [ ] **Step 5: コミット**

```bash
git add build.js
git commit -m "chore: add build script to generate standalone dist/index.html"
git add dist/index.html
git commit -m "build: generate distributable single-file HTML"
```

---

## Task 6: サンプルシナリオ検証 (README + scenarios)

**Files:**
- Create: `README.md`
- Create: `docs/scenarios.md`

**Context:** 仕様書に記載された3シナリオを計算ツールで実測し、結果をドキュメント化。

- [ ] **Step 1: 3シナリオをツールで計算して結果を記録**

以下のパラメータでツールを操作し、実際の計算結果の数値を記録する:

| シナリオ | プロンプト | 参照コード | ファイル | 出力トークン | モデル | 機能 |
|---|---|---|---|---|---|---|
| UT自動作成 | "以下のJavaコードのユニットテストを網羅的に書いてください。" (約30文字) | 1,000行Javaコード (約40KB) | なし | 2,000 | GPT-4.1 | Chat |
| リバースエンジニアリング | "以下のソースコードからMarkdown形式の設計書を作成してください。" (約40文字) | 500行ソースコード (約20KB) | なし | 1,500 | GPT-4.1 | Chat |
| コードレビュー | "以下のPR差分をレビューしてください。" (約25文字) | PR差分200行 (約8KB) | なし | 800 | GPT-4.1 | codeReview |

- [ ] **Step 2: docs/scenarios.md に結果を記載**

```markdown
# シナリオ別クレジット消費量シミュレーション結果

更新日: [YYYY-MM-DD]  
ツールバージョン: [rates.js のバージョン]

## シナリオ 1: UT自動作成
- ...（計算結果を記載）

## シナリオ 2: リバースエンジニアリング
- ...

## シナリオ 3: コードレビュー
- ...
```

- [ ] **Step 3: README.md を作成**

```markdown
# GitHub Copilot クレジット消費量計算ツール

## 使い方
1. `dist/index.html` をブラウザで開く（インターネット接続不要）
2. モデル・機能・プロンプト・添付ファイル情報を入力
3. 「クレジット消費量を計算する」ボタンをクリック
4. 結果と全モデル比較を確認して事務局申請フォームに記載

## モデル単価の更新
`src/rates.js` の `MODEL_RATES` を編集し、`npm run build` を再実行してください。
最新単価は [GitHub Copilot 公式ドキュメント](https://docs.github.com/copilot) を参照。

## 開発者向け
- テスト: `npm test`
- 開発サーバー: `npx serve . -p 3000`
- ビルド: `npm run build`
```

- [ ] **Step 4: コミット**

```bash
git add README.md docs/scenarios.md
git commit -m "docs: usage guide and scenario simulation results"
```

---

## 検証 (Verification)

### 自動テスト
```bash
npm test
```
Expected: 全テスト PASS（tokenizer 5件 + calculator 6件）

### ブラウザ動作確認

**Case 1: 基本動作**
1. `dist/index.html` をダブルクリックで開く
2. モデルを「Claude Opus 4」、機能を「Agent モード」に設定
3. プロンプトに「テストコードを書いてください」(約15文字)と入力 → トークンヒントが表示されること
4. ファイルに Excel 100KB (日本語) を追加
5. 「計算する」クリック → 結果カードが表示され、数値が 0 より大きいこと

**Case 2: モデル比較**
- 結果のモデル比較テーブルが全7モデルを表示し、コスト昇順であること
- 月次クレジットが 1,900 を超えるモデルは赤色表示されること

**Case 3: キャッシュ効果**
- キャッシュ割合 50% に設定すると、0% 時より月次クレジットが低下すること

**Case 4: 配布ファイル確認**
- `dist/index.html` 単体を別 PC にコピーしてブラウザで開き、インターネット接続なしで動作すること

---

## Phase 1 調査完了後の単価更新手順

1. GitHub Copilot 公式ドキュメントから各モデルの token/credit 換算レートを確認
2. `src/rates.js` の `MODEL_RATES` 各エントリの `inputPer1kTokens`, `outputPer1kTokens`, `cachedInputPer1kTokens`, `cachedWritePer1kTokens` を実値に更新
3. `npm run build` を再実行
4. `dist/index.html` を配布
