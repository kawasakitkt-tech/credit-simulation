# GitHub Copilot クレジット消費量計算ツール 実装計画 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本文書は単独で完結する実装計画**です。旧計画書 `docs/superpowers/plans/2026-07-01-github-copilot-credit-calculator.md` を参照する必要はありません（旧文書は履歴として残されているのみで、更新されません）。

**Goal:** GitHub Copilot のクレジット消費量を事前見積もりできるスタンドアロン Web ツールをブラウザで動く単一 HTML ファイルとして構築する。加えて、**チーム人数 × モデル利用量から月間クレジット需要を試算し、契約プランの月間付与クレジットに収まるか超過するかを判定する機能**を持たせる。

## 背景（前提の更新）

GitHub Copilot は **2026/6/1 に premium request 方式の課金を廃止**し、**トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）**へ移行した（ユーザー提供スペックに基づく）。これにより：

- モデル別の消費量は「1,000トークンあたり何クレジット」という単価で計算する（旧来の premium request 換算は用いない）。
- 各契約プランには「1シートあたり月間付与クレジット数」が設定され、それを超えた分は 1 credit = $0.01 で追加課金される（ハード上限で止まるわけではない）。
- 本ツールの利用者（社内 218 名の GitHub Copilot ライセンス保有者）は複数チームに分かれており、チーム単位で「このモデルをこれくらい使うと月何クレジット消費し、どのプランなら収まるか」を事前試算し、事務局の承認プロセスに使いたい。

**Architecture:** Vanilla JS の ES モジュール群（rates/planTiers → tokenizer → calculator → ui）をパイプライン化し、Node.js + Jest でコアロジックを TDD、完成後に index.html に統合してブラウザ単体で動作させる。外部サーバー・ビルドツール不要。

**Tech Stack:** HTML5, Vanilla JavaScript (ES2022 modules), CSS3, Node.js 20+ (テスト専用), Jest 29

## Global Constraints

- 外部 CDN・ライブラリへの依存ゼロ（HTML をダブルクリックで起動、オフライン動作）
- 日本語 UI（ラベル・エラーメッセージ・ヘルプすべて日本語）
- モデル別クレジット単価は `src/rates.js`、プラン別付与クレジットは `src/planTiers.js` の定数テーブルで一元管理し、公式ドキュメント改訂時にそれぞれ1ファイル変更で更新可能にする
- 対応ブラウザ: Chrome 100+, Edge 100+, Firefox 100+（IE 不要）
- スマホ対応不要（PC ブラウザのみ）
- 既存の戦略コンサル向けワークスペース（`consulting-workspace` React アプリ）とは意図的に分離した自己完結ツールとする（配布・共有しやすさ優先。本リポジトリ自体が既にその分離を満たしている）

---

## ファイル構成

```
/
├── index.html                     # UI シェル（開発用、ES modules で src/*.js を読む）
├── src/
│   ├── rates.js                   # モデル別クレジット単価テーブル（★更新対象1）
│   ├── planTiers.js               # プラン別付与クレジットテーブル（★更新対象2, 新規）
│   ├── tokenizer.js               # テキスト/ファイル種別 → トークン数 推定
│   ├── calculator.js              # トークン数 + モデル + チーム人数 → クレジット計算
│   └── ui.js                      # DOM イベント・結果描画
├── tests/
│   ├── tokenizer.test.js
│   ├── planTiers.test.js          # 新規
│   └── calculator.test.js
├── build.js                       # dist/index.html 生成スクリプト
├── docs/
│   └── scenarios/
│       └── team-plan-fit-example.md  # 新規
├── package.json
└── README.md
```

**インターフェース境界:**
- `tokenizer.js` は純粋関数のみ（DOM 依存なし、Node.js でテスト可）
- `planTiers.js` は定数テーブルのみ（ロジックなし）
- `calculator.js` は純粋関数のみ（`rates.js`・`planTiers.js` をインポート）
- `ui.js` のみ DOM に触る
- `index.html` は最終統合ステップで `src/*.js` を `<script>` inline に埋め込む（`build.js`）

---

## Task 1: プロジェクトセットアップ + クレジット単価テーブル + プランティア表

**Files:**
- Modify/Create: `package.json`（既存があれば内容確認のみ、`build` スクリプトが無ければ追加）
- Create: `src/rates.js`
- Create: `src/planTiers.js`
- Create: `tests/calculator.test.js`（空 stub）
- Create: `tests/planTiers.test.js`

**Interfaces:**
- Produces: `MODEL_RATES`, `FEATURE_MULTIPLIERS`, `MONTHLY_WORKING_DAYS`（`src/rates.js`）
- Produces: `PLAN_TIERS`, `USD_PER_CREDIT`（`src/planTiers.js`、Task 3 が使用）

- [ ] **Step 1: package.json を確認・整備**

既に `package.json` がある場合は以下を満たしているか確認し、無ければ追記する。

```json
{
  "name": "copilot-credit-calculator",
  "version": "1.0.0",
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
// クレジット単価 (1,000 トークンあたり)
// GitHub Copilot は 2026/6/1 に premium request 課金を廃止し、
// トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）へ移行した。
// 出典: https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements
// ★ Phase 1 調査完了後に実値で更新すること（現時点は暫定値）
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

- [ ] **Step 4: プランティア表を作成**

`src/planTiers.js`:
```javascript
// GitHub AI Credits プランティア表（暫定値）
// ⚠️ 実際の GitHub 公式プラン名・付与クレジット数ではない。
// 2026/6/1 のプレミアムリクエスト廃止 → 従量課金 (GitHub AI Credits) 移行に伴い、
// 旧・月次クレジット上限値 (3,000 / 1,900) を仮のシート付与量として流用したプレースホルダー。
// ★ Phase 1 公式ドキュメント調査完了後、label / includedCreditsPerSeatPerMonth を実値に更新すること。
export const USD_PER_CREDIT = 0.01; // 1 credit = $0.01（公式発表値・確定）

export const PLAN_TIERS = [
  {
    id: 'provisional-tier-a',
    label: '暫定ティアA（旧上限3,000相当）', // 要確認: 仮称
    includedCreditsPerSeatPerMonth: 3000,    // 要確認
    note: '旧「月次クレジット上限 3,000」を仮のシート付与量として流用した暫定値',
  },
  {
    id: 'provisional-tier-b',
    label: '暫定ティアB（旧上限1,900相当）', // 要確認: 仮称
    includedCreditsPerSeatPerMonth: 1900,    // 要確認
    note: '旧「2026年9月以降の月次クレジット上限 1,900」を仮のシート付与量として流用した暫定値',
  },
];
```

- [ ] **Step 5: 空の stub テストを作成**

`tests/calculator.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';

describe('calculator stub', () => {
  it('placeholder', () => {
    expect(true).toBe(true);
  });
});
```

`tests/planTiers.test.js`:
```javascript
import { describe, it, expect } from '@jest/globals';
import { PLAN_TIERS, USD_PER_CREDIT } from '../src/planTiers.js';

describe('PLAN_TIERS', () => {
  it('少なくとも2ティア定義されている', () => {
    expect(PLAN_TIERS.length).toBeGreaterThanOrEqual(2);
  });

  it('各ティアが id/label/includedCreditsPerSeatPerMonth を持つ', () => {
    PLAN_TIERS.forEach((tier) => {
      expect(typeof tier.id).toBe('string');
      expect(typeof tier.label).toBe('string');
      expect(tier.includedCreditsPerSeatPerMonth).toBeGreaterThan(0);
    });
  });
});

describe('USD_PER_CREDIT', () => {
  it('1 credit = $0.01', () => {
    expect(USD_PER_CREDIT).toBe(0.01);
  });
});
```

- [ ] **Step 6: テストを実行して通ることを確認**

Run: `npm test`
Expected: 全て PASS

- [ ] **Step 7: コミット**

```bash
git add package.json src/rates.js src/planTiers.js tests/calculator.test.js tests/planTiers.test.js
git commit -m "chore: credit rates table and provisional plan-tier table"
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

## Task 3: クレジット計算エンジン (calculator.js) + チーム/プランティア判定

**Files:**
- Create: `src/calculator.js`
- Modify: `tests/calculator.test.js`

**Interfaces:**
- Consumes: `MODEL_RATES`, `FEATURE_MULTIPLIERS`, `MONTHLY_WORKING_DAYS` from `src/rates.js`
- Consumes: `PLAN_TIERS`, `USD_PER_CREDIT` from `src/planTiers.js`
- Produces:
  - `calculateCredits(params): CreditResult`
  - `compareModels(params): ModelComparison[]`
  - `evaluateTeamPlan(params): TeamPlanResult[]`（新規）

  ```
  params (calculateCredits) = {
    inputTokens, outputTokens, cachedInputTokens, cachedWriteTokens,
    modelId, featureId, dailyRequests,
  }

  CreditResult = {
    perRequest: { input, output, cachedInput, cachedWrite, total },
    monthly: number,
    breakdown: { inputTokens, outputTokens, cachedInputTokens, cachedWriteTokens },
  }

  ModelComparison[] = Array of { modelId, label, perRequest, monthly }

  evaluateTeamPlan({ perUserMonthlyCredits, teamSize, tiers = PLAN_TIERS }): TeamPlanResult[]

  TeamPlanResult = {
    tierId, label,
    includedCreditsPerSeatPerMonth,   // 1人あたり付与（ティア表そのまま）
    includedTotal,                     // includedCreditsPerSeatPerMonth * teamSize
    totalDemand,                       // perUserMonthlyCredits * teamSize
    balance,                           // includedTotal - totalDemand（マイナス=超過）
    overageCredits,                    // max(0, -balance)
    overageCostUSD,                    // overageCredits * USD_PER_CREDIT
    fits,                              // balance >= 0（境界値=収まる扱い）
  }
  ```
  `evaluateTeamPlan` は `includedCreditsPerSeatPerMonth` の昇順でソートして返す。`teamSize <= 0` は例外を投げる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` を以下で置き換える:
```javascript
import { describe, it, expect } from '@jest/globals';
import { calculateCredits, compareModels, evaluateTeamPlan } from '../src/calculator.js';

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

describe('evaluateTeamPlan', () => {
  it('チーム需要がティア内に収まる場合 fits=true, overage=0', () => {
    const results = evaluateTeamPlan({ perUserMonthlyCredits: 100, teamSize: 10 });
    const tierB = results.find(r => r.includedCreditsPerSeatPerMonth === 1900);
    expect(tierB.fits).toBe(true);
    expect(tierB.overageCredits).toBe(0);
    expect(tierB.overageCostUSD).toBe(0);
  });

  it('チーム需要がティアを超える場合、超過クレジット・コストを算出', () => {
    const results = evaluateTeamPlan({ perUserMonthlyCredits: 5000, teamSize: 1 });
    const tierB = results.find(r => r.includedCreditsPerSeatPerMonth === 1900);
    expect(tierB.fits).toBe(false);
    expect(tierB.overageCredits).toBeCloseTo(3100, 1);
    expect(tierB.overageCostUSD).toBeCloseTo(31, 1);
  });

  it('境界値（totalDemand === includedTotal）は fits=true', () => {
    const results = evaluateTeamPlan({ perUserMonthlyCredits: 1900, teamSize: 1 });
    const tierB = results.find(r => r.includedCreditsPerSeatPerMonth === 1900);
    expect(tierB.balance).toBe(0);
    expect(tierB.fits).toBe(true);
  });

  it('結果は includedCreditsPerSeatPerMonth 昇順', () => {
    const results = evaluateTeamPlan({ perUserMonthlyCredits: 100, teamSize: 10 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].includedCreditsPerSeatPerMonth)
        .toBeGreaterThanOrEqual(results[i - 1].includedCreditsPerSeatPerMonth);
    }
  });

  it('teamSize=1 は個人換算として機能する', () => {
    const results = evaluateTeamPlan({ perUserMonthlyCredits: 1500, teamSize: 1 });
    const tierB = results.find(r => r.includedCreditsPerSeatPerMonth === 1900);
    expect(tierB.includedTotal).toBe(1900);
    expect(tierB.totalDemand).toBe(1500);
  });

  it('teamSize が0以下ならエラー', () => {
    expect(() => evaluateTeamPlan({ perUserMonthlyCredits: 100, teamSize: 0 })).toThrow();
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
import { PLAN_TIERS, USD_PER_CREDIT } from './planTiers.js';

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

export function evaluateTeamPlan({ perUserMonthlyCredits, teamSize, tiers = PLAN_TIERS }) {
  if (!teamSize || teamSize <= 0) throw new Error('teamSize must be a positive number');
  const totalDemand = round2(perUserMonthlyCredits * teamSize);
  return [...tiers]
    .sort((a, b) => a.includedCreditsPerSeatPerMonth - b.includedCreditsPerSeatPerMonth)
    .map((tier) => {
      const includedTotal = tier.includedCreditsPerSeatPerMonth * teamSize;
      const balance = round2(includedTotal - totalDemand);
      const overageCredits = balance < 0 ? round2(-balance) : 0;
      return {
        tierId: tier.id,
        label: tier.label,
        includedCreditsPerSeatPerMonth: tier.includedCreditsPerSeatPerMonth,
        includedTotal,
        totalDemand,
        balance,
        overageCredits,
        overageCostUSD: round2(overageCredits * USD_PER_CREDIT),
        fits: balance >= 0,
      };
    });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test`
Expected: 全テスト PASS（tokenizer + calculator + planTiers）

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: credit calculator with model comparison and team/plan-tier fit evaluation"
```

---

## Task 4: UI 実装 (index.html + ui.js)

**Files:**
- Create: `index.html`
- Create: `src/ui.js`

**Interfaces:**
- Consumes: `estimateTextTokens`, `estimateFileTokens`, `estimateConversationTokens` (tokenizer.js)
- Consumes: `calculateCredits`, `compareModels`, `evaluateTeamPlan` (calculator.js)
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

    /* テーブル */
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { background: #f6f8fa; border-bottom: 2px solid #d0d7de; padding: 8px 12px; text-align: left; }
    td { border-bottom: 1px solid #eaeef2; padding: 8px 12px; }
    .current-model td { background: #ddf4ff; font-weight: 600; }
    .monthly-warn { color: #cf222e; }

    .help-text { font-size: 0.75rem; color: #57606a; margin-top: 4px; }
    .provisional-note {
      background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px;
      padding: 12px 16px; font-size: 0.875rem; color: #633c01; margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <h1>GitHub Copilot クレジット消費量計算ツール</h1>
  <p class="subtitle">
    2026/6/1 に premium request 課金は廃止され、GitHub AI Credits（1クレジット = $0.01）の従量課金制に移行しました。
    各AI施策のクレジット消費量を事前見積もりし、事務局承認プロセスに活用してください。
  </p>

  <div class="provisional-note">
    ⚠️ モデル単価・プラン別付与クレジット数は暫定値です。公式ドキュメント確認後に <code>src/rates.js</code> / <code>src/planTiers.js</code> を更新してください。
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
      <div class="form-group">
        <label for="teamSize">対象人数</label>
        <input type="number" id="teamSize" value="1" min="1" max="9999">
        <span class="help-text">評価対象チームの人数（社内合計218名のライセンス保有者のうち、対象チームの人数を入力。例: 30）</span>
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
      <h2>計算結果（1人あたり）</h2>
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
          <div class="label">月次クレジット消費量（1人）</div>
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
      <h2>モデル別比較（1人あたり月次）</h2>
      <table>
        <thead>
          <tr>
            <th>モデル</th>
            <th>1リクエスト</th>
            <th>月次（1人・推定）</th>
          </tr>
        </thead>
        <tbody id="comparisonBody"></tbody>
      </table>
    </div>

    <div class="card">
      <h2>チーム / プランティア適合判定（暫定値）</h2>
      <p class="help-text">※ プランティア名・付与クレジット数は暫定プレースホルダーです（要確認）。</p>
      <table>
        <thead>
          <tr>
            <th>プラン（暫定）</th>
            <th>1人あたり付与</th>
            <th>チーム合計付与</th>
            <th>チーム合計需要</th>
            <th>過不足</th>
            <th>超過クレジット</th>
            <th>超過コスト($)</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody id="teamPlanBody"></tbody>
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
import { calculateCredits, compareModels, evaluateTeamPlan } from './calculator.js';

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
    const teamSize = parseInt(document.getElementById('teamSize').value) || 1;

    const result = calculateCredits({ ...tokens, modelId, featureId, dailyRequests: dailyReqs });
    const comparisons = compareModels({ ...tokens, featureId, dailyRequests: dailyReqs });
    const teamPlanResults = evaluateTeamPlan({ perUserMonthlyCredits: result.monthly, teamSize });

    renderResults(result, comparisons, modelId, dailyReqs);
    renderTeamPlan(teamPlanResults);
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
    const tr = document.createElement('tr');
    if (modelId === currentModelId) tr.className = 'current-model';
    tr.innerHTML = `
      <td>${label}${modelId === currentModelId ? ' ★' : ''}</td>
      <td>${perRequest.toFixed(3)}</td>
      <td>${monthly.toFixed(1)}</td>
    `;
    cBody.appendChild(tr);
  });
}

function renderTeamPlan(results) {
  const body = document.getElementById('teamPlanBody');
  body.innerHTML = '';
  results.forEach((r) => {
    const warn = r.fits ? '' : ' monthly-warn';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.label}</td>
      <td>${r.includedCreditsPerSeatPerMonth.toLocaleString()}</td>
      <td>${r.includedTotal.toLocaleString()}</td>
      <td>${r.totalDemand.toLocaleString()}</td>
      <td class="${warn}">${r.balance.toLocaleString()}</td>
      <td class="${warn}">${r.overageCredits.toLocaleString()}</td>
      <td class="${warn}">$${r.overageCostUSD.toLocaleString()}</td>
      <td class="${warn}">${r.fits ? '適合' : '超過'}</td>
    `;
    body.appendChild(tr);
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
- [ ] 「対象人数」を変更すると、チーム/プランティア適合判定テーブルが再計算される
- [ ] チーム需要がティアの付与クレジットを超えると、該当行が赤字表示（`monthly-warn`）になる

- [ ] **Step 4: コミット**

```bash
git add index.html src/ui.js
git commit -m "feat: web UI with token hints, model comparison, and team/plan-tier fit table"
```

---

## Task 5: スタンドアロン配布版の生成 (build.js)

**Files:**
- Create: `build.js` (Node.js スクリプト)
- Produces: `dist/index.html` (JS を inline embed した単一ファイル)

**Context:** `file://` プロトコルでは ES modules の CORS 制限があるため、配布版は JS を全て `<script>` タグに inline で埋め込む。`src/planTiers.js` を `calculator.js` より前に結合する（`calculator.js` のデフォルト引数 `tiers = PLAN_TIERS` が `planTiers.js` に依存するため）。

- [ ] **Step 1: build.js を作成**

```javascript
// build.js — ブラウザで ES modules を使うと file:// で CORS エラーになるため
// 全 JS を 1 ファイルに inline embed して dist/index.html を出力する
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const rates      = readFileSync('src/rates.js',      'utf8');
const planTiers  = readFileSync('src/planTiers.js',  'utf8');
const tokenizer  = readFileSync('src/tokenizer.js',  'utf8');
const calculator = readFileSync('src/calculator.js', 'utf8');
const ui         = readFileSync('src/ui.js',         'utf8');

let html = readFileSync('index.html', 'utf8');

// ES module の import/export を除去（inline では不要）
const strip = (s) => s
  .replace(/^export\s+(function|const|class)/gm, '$1')
  .replace(/^export\s+\{[^}]+\};\s*$/gm, '')
  .replace(/^import\s+.*?from\s+['"][^'"]+['"];\s*$/gm, '');

const combined = [rates, planTiers, tokenizer, calculator, ui].map(strip).join('\n\n');

// <script type="module" src="src/ui.js"></script> を置換
html = html.replace(
  '<script type="module" src="src/ui.js"></script>',
  `<script>\n${combined}\n</script>`
);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html, 'utf8');
console.log('Built dist/index.html');
```

- [ ] **Step 2: package.json に build スクリプトが登録されていることを確認**（Task 1 Step 1 で追加済みのはず）

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

## Task 6: サンプルシナリオ検証 + README (README + docs/scenarios)

**Files:**
- Create: `README.md`
- Create: `docs/scenarios/team-plan-fit-example.md`

**Context:** 仕様書に記載されたシナリオを計算ツールで実測し、結果をドキュメント化する。加えて、新機能（チーム/プランティア適合判定）の参考例も1件記録する。

- [ ] **Step 1: 3シナリオ（個人単位）をツールで計算して結果を記録**

以下のパラメータでツールを操作し、実際の計算結果の数値を記録する:

| シナリオ | プロンプト | 参照コード | ファイル | 出力トークン | モデル | 機能 |
|---|---|---|---|---|---|---|
| UT自動作成 | "以下のJavaコードのユニットテストを網羅的に書いてください。" (約30文字) | 1,000行Javaコード (約40KB) | なし | 2,000 | GPT-4.1 | Chat |
| リバースエンジニアリング | "以下のソースコードからMarkdown形式の設計書を作成してください。" (約40文字) | 500行ソースコード (約20KB) | なし | 1,500 | GPT-4.1 | Chat |
| コードレビュー | "以下のPR差分をレビューしてください。" (約25文字) | PR差分200行 (約8KB) | なし | 800 | GPT-4.1 | codeReview |

- [ ] **Step 2: docs/scenarios/scenarios.md に個人単位の結果を記載**（既存フォーマット踏襲）

```markdown
# シナリオ別クレジット消費量シミュレーション結果

更新日: [YYYY-MM-DD]
ツールバージョン: [rates.js / planTiers.js のバージョン]

## シナリオ 1: UT自動作成
- ...（計算結果を記載）

## シナリオ 2: リバースエンジニアリング
- ...

## シナリオ 3: コードレビュー
- ...
```

- [ ] **Step 3: チーム/プランティア適合判定の参考例を記載**

`docs/scenarios/team-plan-fit-example.md`:
```markdown
# チーム / プランティア適合判定 参考例（暫定値ベース）

⚠️ 本例はモデル単価・プランティア付与クレジット数がいずれも暫定値の状態での参考計算です。
Phase 1 調査完了後、実値で再計算すること。

## 前提
- シナリオ: UT自動作成（GPT-4.1, Chat, 1日10リクエスト）
- 1人あたり月次クレジット消費量: [scenarios.md のシナリオ1結果を転記]
- 対象チーム人数: 30名（社内合計218名のライセンス保有者のうち、1チームを想定）

## evaluateTeamPlan 実行結果

| プラン（暫定） | 1人あたり付与 | チーム合計付与 | チーム合計需要 | 過不足 | 超過クレジット | 超過コスト($) | 判定 |
|---|---|---|---|---|---|---|---|
| 暫定ティアB（1,900） | ... | ... | ... | ... | ... | ... | ... |
| 暫定ティアA（3,000） | ... | ... | ... | ... | ... | ... | ... |
```

- [ ] **Step 4: README.md を作成**

```markdown
# GitHub Copilot クレジット消費量計算ツール

GitHub Copilot は 2026/6/1 に premium request 課金を廃止し、トークンベースの従量課金
（GitHub AI Credits, 1 credit = $0.01）へ移行しました。本ツールは、プロンプト・添付ファイル・
使用モデル・機能・対象人数を入力するだけで、1人あたりのクレジット消費量とチーム単位の
プランティア適合判定（収まるか・超過するか）を事前に見積もれるスタンドアロン Web ツールです。

---

## エンドユーザー向け: 使い方

### 1. ツールを開く

`dist/index.html` をダブルクリックしてブラウザで開く。
インターネット接続・インストール不要。

### 2. 入力する

| 項目 | 説明 |
|---|---|
| 使用モデル | Claude Opus 4, GPT-4.1 など使用予定のモデルを選択 |
| 使用機能 | Chat / Code Review / Agent / CLI から選択 |
| 1日あたりのリクエスト数 | 1日に何回この操作を行うか |
| 対象人数 | 試算対象チームの人数（社内合計218名のうち、対象チームの人数） |
| プロンプト・指示文 | 実際に送信するプロンプトをそのまま貼り付ける |
| 参照コード・設計書 | コピー&ペーストするコードや設計書テキスト |
| 添付ファイル | ファイル種別とサイズ(KB)を入力（複数可） |
| 会話ターン数 | 1セッションで何往復するか |
| 期待出力トークン数 | 生成されるコード・文章の概算量 |
| キャッシュ入力割合 | 同一コンテキストを繰り返す場合は % を設定 |

### 3. 結果を確認する

- **1リクエストあたりクレジット**: 1回の操作でかかるクレジット（1人あたり）
- **月次クレジット消費量**: 月20稼働日として計算した月間合計（1人あたり）
- **モデル別比較表**: 全モデルのコストを昇順で比較
- **チーム / プランティア適合判定**: 対象人数分のチーム合計需要が各プラン（暫定ティア）の
  合計付与クレジットに収まるか、超過する場合は超過クレジット数と超過コスト($)を表示。
  超過するプランは行全体が赤字表示される。

### 4. 事務局申請に活用する

計算結果を「事前見積もり提出フォーマット」に記載し、事務局に申請してください。

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

## クレジット単価・プランティアの更新方法

GitHub Copilot の料金体系が改訂された場合は以下の手順で更新する（更新対象は2ファイル）。

1. [GitHub Copilot 公式ドキュメント](https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements) で最新単価・プラン情報を確認
2. モデル別単価: `src/rates.js` の `MODEL_RATES` を編集（4フィールド: input / output / cachedInput / cachedWrite）
3. プラン別付与クレジット: `src/planTiers.js` の `PLAN_TIERS` を編集（実際のプラン名・付与クレジット数に置き換え）
4. `npm run build` を実行
5. `dist/index.html` を再配布

---

## 対応モデル

| モデル | 用途目安 |
|---|---|
| GPT-4.1 | 標準的なコード補完・レビュー |
| GPT-4.1 mini | 軽量タスク・コスト重視 |
| Claude Opus 4 | 複雑な設計・高品質生成 |
| Claude Sonnet 4.6 | バランス型 |
| Gemini 2.5 Pro | 長文コンテキスト |
| o3 | 推論・難易度の高いバグ解析 |
| o4-mini | 推論軽量版 |

> 単価・プランティア付与クレジット数は暫定値です。公式ドキュメントで最新値を確認のうえ
> `src/rates.js` / `src/planTiers.js` を更新してください。

---

## ディレクトリ構成

```
/
├── dist/index.html      ← 配布ファイル（これだけ配る）
├── src/
│   ├── rates.js         ← モデル単価テーブル（更新対象1）
│   ├── planTiers.js     ← プラン別付与クレジットテーブル（更新対象2）
│   ├── tokenizer.js     ← トークン推定ロジック
│   ├── calculator.js    ← クレジット計算・チーム/プランティア判定ロジック
│   └── ui.js            ← UI
├── tests/               ← Jest ユニットテスト
├── build.js             ← ビルドスクリプト
└── docs/scenarios/      ← シナリオ別シミュレーション結果
```

---

## ライセンス・連絡先

社内利用限定ツール。問い合わせは事務局まで。
```

- [ ] **Step 5: コミット**

```bash
git add README.md docs/scenarios/scenarios.md docs/scenarios/team-plan-fit-example.md
git commit -m "docs: usage guide and scenario simulation results incl. team/plan-tier example"
```

---

## Task 7: CLAUDE.md 更新

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 背景セクションに課金モデル変更を追記**

「背景」箇条書きに以下を追加:
```
- 2026/6/1 に GitHub Copilot は premium request 課金を廃止し、トークンベースの従量課金
  （GitHub AI Credits, 1 credit = $0.01）へ移行
- チーム単位でモデル利用量から月間クレジット需要を試算し、契約プラン（暫定ティア）の
  付与クレジットに収まるか超過するかを判定する機能を提供
```

- [ ] **Step 2: ディレクトリ構成に `src/planTiers.js` を追加**（`★モデル別クレジット単価テーブル` の行の下に `★プラン別付与クレジットテーブル` を追加）

- [ ] **Step 3: 「クレジット単価の更新」セクションを「クレジット単価・プランティアの更新」に改題**し、`src/rates.js` に加えて `src/planTiers.js` も唯一の更新対象であることを明記

- [ ] **Step 4: 「テスト方針」に `planTiers.js` の定数検証テスト、`calculator.js` の `evaluateTeamPlan` テストを追記**

- [ ] **Step 5: 「注意事項」に、モデル単価とプランティア付与クレジットの両方が暫定値であり、Phase 1 調査後に実値へ更新することを明記**

- [ ] **Step 6: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for GitHub AI Credits billing model and plan-tier feature"
```

---

## 検証 (Verification)

### 自動テスト
```bash
npm test
```
Expected: 全テスト PASS（tokenizer + planTiers + calculator[calculateCredits/compareModels/evaluateTeamPlan]）

### ブラウザ動作確認

**Case 1: 基本動作（個人単位）**
1. `dist/index.html` をダブルクリックで開く
2. モデルを「Claude Opus 4」、機能を「Agent モード」に設定
3. プロンプトに「テストコードを書いてください」(約15文字)と入力 → トークンヒントが表示されること
4. ファイルに Excel 100KB (日本語) を追加
5. 「計算する」クリック → 結果カードが表示され、数値が 0 より大きいこと

**Case 2: モデル比較**
- 結果のモデル比較テーブルが全7モデルを表示し、コスト昇順であること

**Case 3: キャッシュ効果**
- キャッシュ割合 50% に設定すると、0% 時より月次クレジットが低下すること

**Case 4: チーム / プランティア適合判定**
- 「対象人数」を 1 → 30 → 300 と変えると、チーム合計需要が変化しテーブルが再計算されること
- 対象人数を大きくして需要がティアの付与クレジットを超えると、該当行が赤字（`monthly-warn`）表示され、判定が「超過」になること
- 超過コスト($) が `overageCredits × 0.01` と一致すること

**Case 5: 配布ファイル確認**
- `dist/index.html` 単体を別 PC にコピーしてブラウザで開き、インターネット接続なしで動作すること

---

## Phase 1 調査完了後の単価・プランティア更新手順

1. GitHub Copilot 公式ドキュメントから各モデルの token/credit 換算レートと、各契約プランの
   シートあたり月間付与クレジット数を確認
2. `src/rates.js` の `MODEL_RATES` 各エントリを実値に更新
3. `src/planTiers.js` の `PLAN_TIERS` を実際のプラン名・付与クレジット数に更新（プレースホルダーの
   「暫定ティアA/B」を実プラン名に置き換える）
4. `npm run build` を再実行
5. `dist/index.html` を配布
