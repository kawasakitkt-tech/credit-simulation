# Ask / Plan / Agent 3モード再設計 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 計算ツールの対象機能を Ask / Plan / Agent の3モードに変更し、Plan/Agent は反復シミュレーションモデルで近似計算、UI は Apple 風ライト基調のレスポンシブデザインに刷新する。

**Architecture:** 純粋関数層（tokenizer / calculator）に共通エンジン `estimateAgenticTokens` と モード別ビルダー `buildAskTokens` / `buildAgenticTokens` を追加し、旧 Chat/CLI/code review 関連を削除。UI 層（index.html / ui.js）は全面書き換え。プリセット等の係数は rates.js に集約。

**Tech Stack:** Vanilla JS (ES modules) / Jest / build.js による inline embed ビルド。外部依存なし。

**Spec:** `docs/superpowers/specs/2026-07-07-ask-plan-agent-redesign-design.md`（承認済み）

## Global Constraints

- `src/tokenizer.js` と `src/calculator.js` は純粋関数のみ（DOM 非依存）。`src/ui.js` のみ DOM に触る。`src/rates.js` は定数テーブルのみ
- 登録モデル数を固定数と仮定するコード・文言を書かない（`Object.keys(MODEL_RATES)` が単一の真実源）
- 暫定係数には `EXPERIMENTAL_` プレフィックスまたは `// 要確認（暫定値）` コメントを付ける
- テスト失敗状態でコミットしない。各タスク末尾で `npm test` が全緑であること
- UI 文言は日本語。外部 CDN・サーバー・インストール不要（dist/index.html 単体で動作）
- `dist/` は手動編集不可（`npm run build` で生成）
- calculator.js から tokenizer.js の import は可（両方純粋関数層。build.js の連結順 rates→tokenizer→calculator→ui でインライン化も成立する）
- コマンド実行はリポジトリの worktree ルート（このファイルがある PLAN/ の親）で行う

---

### Task 1: tokenizer にファイル種別 `code`（ソースコード/フォルダ）を追加

**Files:**
- Modify: `src/tokenizer.js:30-36`（`FILE_TOKENS_PER_KB`）
- Test: `tests/tokenizer.test.js`

**Interfaces:**
- Consumes: 既存 `estimateFileTokens(fileSizeKB, fileType, encoding)`
- Produces: `estimateFileTokens(kb, 'code', enc)` が 300 tokens/KB で計算できる（Task 9 の UI が使用）

- [ ] **Step 1: 失敗するテストを書く**

`tests/tokenizer.test.js` の `describe('estimateFileTokens（参考値）', ...)` 内に追加:

```js
  it('ソースコード/フォルダは約300 tokens/KB（コードは言語によらずASCII主体のため ja/en 共通）', () => {
    expect(estimateFileTokens(10, 'code', 'ja')).toBe(3000);
    expect(estimateFileTokens(10, 'code', 'en')).toBe(3000);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/tokenizer.test.js`
Expected: FAIL（`code` 未定義のため md 係数 650 が使われ 6500 になる）

- [ ] **Step 3: 最小実装**

`src/tokenizer.js` の `FILE_TOKENS_PER_KB` に1行追加:

```js
const FILE_TOKENS_PER_KB = {
  md:   { ja: 650, en: 250 },
  code: { ja: 300, en: 300 }, // ソースコード/フォルダ。ASCII主体のため言語共通。要確認（暫定値）
  pdf:  { ja: 400, en: 180 },
  docx: { ja: 300, en: 130 },
  pptx: { ja: 250, en: 110 },
  xlsx: { ja: 200, en: 100 },
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/tokenizer.js tests/tokenizer.test.js
git commit -m "feat: add code/folder file type at 300 tokens/KB"
```

---

### Task 2: calculateCredits に cacheWrite 単価なしモデルの input 単価フォールバックを追加

**Files:**
- Modify: `src/calculator.js:35-38`
- Test: `tests/calculator.test.js:48-51`（既存テストの期待値を変更）

**Interfaces:**
- Consumes: 既存 `calculateCredits(tokens, modelKey)`
- Produces: `cacheWrite: null` のモデルに `cacheWriteTokens` を渡すと **input 単価**で課金される（Task 6 のエージェントループ計算が依存）

- [ ] **Step 1: 既存テストを新仕様に書き換える（失敗するテスト）**

`tests/calculator.test.js` の `'cacheWrite: null のモデルに cacheWriteTokens を渡しても0クレジット'` テストを削除し、以下に置き換え:

```js
  it('cacheWrite 単価なしモデルは cacheWriteTokens を input 単価で課金する', () => {
    // gpt-5-mini: input 0.25 → 5000 * 0.25 / 10000 = 0.125
    const result = calculateCredits({ ...baseTokens, cacheWriteTokens: 5000 }, 'gpt-5-mini');
    expect(result.breakdown.cacheWriteCredits).toBeCloseTo(0.125, 4);
  });

  it('cacheWrite 単価ありモデルは cacheWrite 単価で課金する', () => {
    // claude-sonnet-5: cacheWrite 2.50 → 10000 * 2.50 / 10000 = 2.5
    const result = calculateCredits({ ...baseTokens, cacheWriteTokens: 10000 }, 'claude-sonnet-5');
    expect(result.breakdown.cacheWriteCredits).toBeCloseTo(2.5, 4);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/calculator.test.js`
Expected: FAIL（現行実装は null 単価 → 0 クレジット）

- [ ] **Step 3: 実装**

`src/calculator.js` の `calculateCredits` 内、cacheWriteCredits の行を変更:

```js
  // cacheWrite 単価が無いモデル（OpenAI/Google等）はキャッシュ書き込みを通常 input 単価で課金する
  const cacheWriteCredits  = toCredits(cacheWriteTokens, rate.cacheWrite ?? rate.input);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "fix: charge cache writes at input rate for models without cacheWrite pricing"
```

---

### Task 3: 共通エンジン estimateAgenticTokens を追加

**Files:**
- Modify: `src/calculator.js`（関数追加）
- Test: `tests/calculator.test.js`

**Interfaces:**
- Consumes: なし（純粋な算術関数）
- Produces: `estimateAgenticTokens({ baseContextTokens, iterations, growthPerIterationTokens, outputPerIterationTokens, finalOutputTokens })` → `{ inputTokens: 0, cachedInputTokens, cacheWriteTokens, outputTokens }`（Task 6 が使用）

モデル（スペック準拠の閉形式）:
- `cacheWriteTokens = C0 + (N-1)·G`
- `cachedInputTokens = (N-1)·C0 + G·(N-1)(N-2)/2`
- `outputTokens = N·O + F`
- N は最小1にクランプ、各値は負値・非数を0に丸める

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` に追加（import に `estimateAgenticTokens` を足す）:

```js
describe('estimateAgenticTokens', () => {
  it('N=1 はキャッシュ読み0・書き込みC0のみ、出力は O+F', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 10000, iterations: 1,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 2000,
    });
    expect(t).toEqual({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 10000, outputTokens: 2500 });
  });

  it('N=4 の閉形式: cacheWrite=C0+3G, cachedInput=3C0+3G, output=4O+F', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 10000, iterations: 4,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 2000,
    });
    expect(t.cacheWriteTokens).toBe(10000 + 3 * 3000);          // 19000
    expect(t.cachedInputTokens).toBe(3 * 10000 + 3000 * 3 * 2 / 2); // 39000
    expect(t.outputTokens).toBe(4 * 500 + 2000);                 // 4000
  });

  it('iterations は最小1にクランプされる', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: 5000, iterations: 0,
      growthPerIterationTokens: 3000, outputPerIterationTokens: 500, finalOutputTokens: 0,
    });
    expect(t.cacheWriteTokens).toBe(5000);
    expect(t.cachedInputTokens).toBe(0);
    expect(t.outputTokens).toBe(500);
  });

  it('負値は0に丸める', () => {
    const t = estimateAgenticTokens({
      baseContextTokens: -100, iterations: 2,
      growthPerIterationTokens: -5, outputPerIterationTokens: 100, finalOutputTokens: 0,
    });
    expect(t.cacheWriteTokens).toBe(0);
    expect(t.cachedInputTokens).toBe(0);
    expect(t.outputTokens).toBe(200);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/calculator.test.js`
Expected: FAIL with "estimateAgenticTokens is not a function"（または import エラー）

- [ ] **Step 3: 実装**

`src/calculator.js` に追加:

```js
// エージェントループ（Plan/Agent）のトークンを反復シミュレーションの閉形式で見積もる。
// 1回目: ベースコンテキスト C0 をキャッシュ書き込み。
// i回目(i>=2): 蓄積済み C0+(i-2)·G をキャッシュ読み込み、新規増分 G をキャッシュ書き込み。
// 出力は毎反復 O、最終回に F を追加。
export function estimateAgenticTokens({
  baseContextTokens = 0,
  iterations = 1,
  growthPerIterationTokens = 0,
  outputPerIterationTokens = 0,
  finalOutputTokens = 0,
} = {}) {
  const clamp0 = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const N = Math.max(1, Math.floor(Number.isFinite(iterations) ? iterations : 1));
  const c0 = clamp0(baseContextTokens);
  const g = clamp0(growthPerIterationTokens);
  const o = clamp0(outputPerIterationTokens);
  const f = clamp0(finalOutputTokens);

  return {
    inputTokens: 0,
    cachedInputTokens: Math.ceil((N - 1) * c0 + (g * (N - 1) * (N - 2)) / 2),
    cacheWriteTokens: Math.ceil(c0 + (N - 1) * g),
    outputTokens: Math.ceil(N * o + f),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: add estimateAgenticTokens iteration-simulation engine"
```

---

### Task 4: rates.js に新定数を追加（旧定数はまだ残す）

**Files:**
- Modify: `src/rates.js`
- Test: `tests/calculator.test.js`（rates.js describe 内）

**Interfaces:**
- Consumes: なし
- Produces: `FEATURE_OVERHEAD_TOKENS.ask/plan/agent`、`EXPERIMENTAL_AGENTIC_PRESETS[mode][scale]`、`EXPERIMENTAL_SUBAGENT_DEFAULTS`、`ASK_TURN_CACHE_RATIOS`（Task 5, 6, 9 が使用）

※ この時点では `chat`/`cli` キーと `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` は**削除しない**（旧関数が参照中。Task 7 で一括削除）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` の import に `EXPERIMENTAL_AGENTIC_PRESETS, EXPERIMENTAL_SUBAGENT_DEFAULTS, ASK_TURN_CACHE_RATIOS` を追加し、`describe('rates.js', ...)` 内に追加:

```js
  it('FEATURE_OVERHEAD_TOKENS に ask/plan/agent が定義されている', () => {
    expect(FEATURE_OVERHEAD_TOKENS.ask).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.plan).toBeGreaterThan(0);
    expect(FEATURE_OVERHEAD_TOKENS.agent).toBeGreaterThan(0);
  });

  it('EXPERIMENTAL_AGENTIC_PRESETS に plan/agent × small/medium/large が定義されている', () => {
    for (const mode of ['plan', 'agent']) {
      for (const scale of ['small', 'medium', 'large']) {
        const p = EXPERIMENTAL_AGENTIC_PRESETS[mode][scale];
        expect(p.iterations).toBeGreaterThan(0);
        expect(p.growthPerIterationTokens).toBeGreaterThan(0);
        expect(p.outputPerIterationTokens).toBeGreaterThan(0);
        expect(p.finalOutputTokens).toBeGreaterThanOrEqual(0);
        expect(p.subagents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('EXPERIMENTAL_SUBAGENT_DEFAULTS が定義されている', () => {
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.iterations).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.baseContextTokens).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.referenceShareRatio).toBeGreaterThan(0);
    expect(EXPERIMENTAL_SUBAGENT_DEFAULTS.referenceShareRatio).toBeLessThanOrEqual(1);
  });

  it('ASK_TURN_CACHE_RATIOS は minTurn 降順で ratio 0〜1', () => {
    for (let i = 1; i < ASK_TURN_CACHE_RATIOS.length; i++) {
      expect(ASK_TURN_CACHE_RATIOS[i].minTurn).toBeLessThan(ASK_TURN_CACHE_RATIOS[i - 1].minTurn);
    }
    for (const e of ASK_TURN_CACHE_RATIOS) {
      expect(e.ratio).toBeGreaterThanOrEqual(0);
      expect(e.ratio).toBeLessThanOrEqual(1);
    }
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/calculator.test.js`
Expected: FAIL（import エラーまたは undefined）

- [ ] **Step 3: 実装**

`src/rates.js` の `FEATURE_OVERHEAD_TOKENS` を置き換え、直後に新定数を追加:

```js
// モード利用時、ユーザー入力とは別に system prompt / tool definitions /
// custom instructions 等の見えない文脈が消費するトークンの概算固定値。
// Plan/Agent はツール定義が多いため大きい。要確認（暫定値）。実測データ取得後に較正すること。
export const FEATURE_OVERHEAD_TOKENS = {
  ask: 1500,
  plan: 4000,
  agent: 6000,
  chat: 1500, // 旧機能（Task 7 で削除予定）
  cli: 2500,  // 旧機能（Task 7 で削除予定）
};

// Plan/Agent モードの反復シミュレーション用プリセット。
// iterations: モデル呼び出し回数 / growthPerIterationTokens: 1反復あたりの
// コンテキスト増分（ツール実行結果＋前回出力）/ outputPerIterationTokens: 1反復
// あたりの出力 / finalOutputTokens: 最終成果物（Plan=計画書, Agent=コード＋説明）/
// subagents: サブエージェント数。
// 変数名に EXPERIMENTAL を含め、モデル単価と同列の確からしさに見せない。
// 要確認（暫定値）: 実測データが無い。実測後に較正すること。
export const EXPERIMENTAL_AGENTIC_PRESETS = {
  plan: {
    small:  { iterations: 4,  growthPerIterationTokens: 3000, outputPerIterationTokens: 300,  finalOutputTokens: 2000, subagents: 0 },
    medium: { iterations: 8,  growthPerIterationTokens: 4000, outputPerIterationTokens: 400,  finalOutputTokens: 4000, subagents: 0 },
    large:  { iterations: 14, growthPerIterationTokens: 5000, outputPerIterationTokens: 500,  finalOutputTokens: 8000, subagents: 2 },
  },
  agent: {
    small:  { iterations: 6,  growthPerIterationTokens: 3000, outputPerIterationTokens: 800,  finalOutputTokens: 1000, subagents: 0 },
    medium: { iterations: 15, growthPerIterationTokens: 4000, outputPerIterationTokens: 1000, finalOutputTokens: 1500, subagents: 1 },
    large:  { iterations: 30, growthPerIterationTokens: 5000, outputPerIterationTokens: 1200, finalOutputTokens: 2000, subagents: 3 },
  },
};

// サブエージェント1体分の固定小型ループ。baseContextTokens はタスク説明ぶんで、
// これにメイン参照トークン × referenceShareRatio を加えたものが C0 になる。
// 要確認（暫定値）。
export const EXPERIMENTAL_SUBAGENT_DEFAULTS = {
  iterations: 6,
  baseContextTokens: 3000,
  referenceShareRatio: 0.5,
  growthPerIterationTokens: 3000,
  outputPerIterationTokens: 800,
};

// Ask モードの「何回目のやり取りか(T)」→ キャッシュヒット率。
// minTurn 降順に評価し、最初に T >= minTurn を満たした ratio を使う（該当なし＝T=1 は 0）。
// 要確認（暫定値）。
export const ASK_TURN_CACHE_RATIOS = [
  { minTurn: 5, ratio: 0.50 },
  { minTurn: 3, ratio: 0.35 },
  { minTurn: 2, ratio: 0.25 },
];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS（既存の chat/cli テストも green のまま）

- [ ] **Step 5: コミット**

```bash
git add src/rates.js tests/calculator.test.js
git commit -m "feat: add ask/plan/agent overheads, agentic presets, and turn-based cache ratios"
```

---

### Task 5: buildAskTokens と askCacheRatioForTurn を追加

**Files:**
- Modify: `src/calculator.js`
- Test: `tests/calculator.test.js`

**Interfaces:**
- Consumes: `FEATURE_OVERHEAD_TOKENS.ask`, `ASK_TURN_CACHE_RATIOS`（Task 4）、`estimateHistoryTokens`（tokenizer.js 既存）
- Produces:
  - `askCacheRatioForTurn(turnNumber: number): number`
  - `buildAskTokens({ promptTokens, referenceTokens, turnNumber, outputTokens })` → `{ tokens: { inputTokens, cachedInputTokens, cacheWriteTokens: 0, outputTokens }, assumptions: { turnNumber, cacheRatio, historyTokens } }`（Task 9 の UI が使用）

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` の import に `buildAskTokens, askCacheRatioForTurn` を追加し、末尾に追加:

```js
describe('askCacheRatioForTurn', () => {
  it('T=1→0%, T=2→25%, T=3〜4→35%, T>=5→50%', () => {
    expect(askCacheRatioForTurn(1)).toBe(0);
    expect(askCacheRatioForTurn(2)).toBe(0.25);
    expect(askCacheRatioForTurn(3)).toBe(0.35);
    expect(askCacheRatioForTurn(4)).toBe(0.35);
    expect(askCacheRatioForTurn(5)).toBe(0.50);
    expect(askCacheRatioForTurn(10)).toBe(0.50);
  });
});

describe('buildAskTokens', () => {
  it('T=1: 履歴0・キャッシュ0%、overhead(ask)=1500 が入力に加算される', () => {
    const { tokens, assumptions } = buildAskTokens({
      promptTokens: 100, referenceTokens: 1000, turnNumber: 1, outputTokens: 500,
    });
    expect(tokens.inputTokens).toBe(100 + 1000 + 1500);
    expect(tokens.cachedInputTokens).toBe(0);
    expect(tokens.cacheWriteTokens).toBe(0);
    expect(tokens.outputTokens).toBe(500);
    expect(assumptions.historyTokens).toBe(0);
    expect(assumptions.cacheRatio).toBe(0);
  });

  it('T=2: 履歴1ターン分が加算され、キャッシュ率25%が参照+履歴に適用される', () => {
    const { tokens, assumptions } = buildAskTokens({
      promptTokens: 0, referenceTokens: 1000, turnNumber: 2, outputTokens: 0,
    });
    // estimateHistoryTokens(1, 500, 1000) = ceil(500*0.25) + ceil(1000*0.25) = 125 + 250 = 375
    expect(assumptions.historyTokens).toBe(375);
    // cacheable = 1000 + 375 = 1375 → cached = ceil(1375 * 0.25) = 344
    expect(tokens.cachedInputTokens).toBe(344);
    expect(tokens.inputTokens).toBe(1375 - 344 + 1500);
  });

  it('turnNumber は最小1にクランプされる', () => {
    const { assumptions } = buildAskTokens({
      promptTokens: 0, referenceTokens: 0, turnNumber: 0, outputTokens: 0,
    });
    expect(assumptions.turnNumber).toBe(1);
    expect(assumptions.cacheRatio).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/calculator.test.js`
Expected: FAIL（関数未定義）

- [ ] **Step 3: 実装**

`src/calculator.js` の import に追加:

```js
import { estimateHistoryTokens } from './tokenizer.js';
```

rates.js からの import に `ASK_TURN_CACHE_RATIOS` を追加。関数を追加:

```js
// 「何回目のやり取りか」からキャッシュヒット率を推定する。
export function askCacheRatioForTurn(turnNumber) {
  const entry = ASK_TURN_CACHE_RATIOS.find((e) => turnNumber >= e.minTurn);
  return entry ? entry.ratio : 0;
}

// Ask モード（1回のモデル呼び出し）の tokens を組み立てる。
// turnNumber(T) が履歴トークンとキャッシュ率の両方を駆動する:
//  - 履歴: (T-1)ターン × 平均ターンサイズ（ユーザー500文字＋アシスタント1,000文字）
//  - キャッシュ率: askCacheRatioForTurn(T) を参照情報＋履歴に適用
const ASK_AVG_USER_CHARS = 500;
const ASK_AVG_ASSISTANT_CHARS = 1000;

export function buildAskTokens({
  promptTokens = 0,
  referenceTokens = 0,
  turnNumber = 1,
  outputTokens = 0,
} = {}) {
  const T = Math.max(1, Math.floor(Number.isFinite(turnNumber) ? turnNumber : 1));
  const overheadTokens = FEATURE_OVERHEAD_TOKENS.ask;
  const historyTokens = estimateHistoryTokens(T - 1, ASK_AVG_USER_CHARS, ASK_AVG_ASSISTANT_CHARS);
  const cacheRatio = askCacheRatioForTurn(T);

  const cacheableTokens = referenceTokens + historyTokens;
  const cachedInputTokens = Math.ceil(cacheableTokens * cacheRatio);
  const freshTokens = cacheableTokens - cachedInputTokens;

  return {
    tokens: {
      inputTokens: Math.ceil(overheadTokens + promptTokens + freshTokens),
      cachedInputTokens,
      cacheWriteTokens: 0,
      outputTokens: Math.ceil(outputTokens),
    },
    assumptions: { turnNumber: T, cacheRatio, historyTokens },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: add buildAskTokens with turn-driven history and cache ratio"
```

---

### Task 6: buildAgenticTokens（プリセット＋上書き＋サブエージェント合算）を追加

**Files:**
- Modify: `src/calculator.js`
- Test: `tests/calculator.test.js`

**Interfaces:**
- Consumes: `estimateAgenticTokens`（Task 3）、`FEATURE_OVERHEAD_TOKENS`, `EXPERIMENTAL_AGENTIC_PRESETS`, `EXPERIMENTAL_SUBAGENT_DEFAULTS`（Task 4）
- Produces: `buildAgenticTokens({ mode, taskScale, promptTokens, referenceTokens, iterations?, growthPerIterationTokens?, outputPerIterationTokens?, finalOutputTokens?, subagents? })` → `{ tokens, assumptions: { mode, taskScale, iterations, growthPerIterationTokens, outputPerIterationTokens, finalOutputTokens, subagents } }`（Task 9 の UI が使用）

- [ ] **Step 1: 失敗するテストを書く**

`tests/calculator.test.js` の import に `buildAgenticTokens` を追加し、末尾に追加:

```js
describe('buildAgenticTokens', () => {
  it('plan/small プリセット: C0 = overhead(4000)+prompt+reference で閉形式どおり', () => {
    const { tokens, assumptions } = buildAgenticTokens({
      mode: 'plan', taskScale: 'small', promptTokens: 500, referenceTokens: 5500,
    });
    // C0 = 4000+500+5500 = 10000, プリセット: N=4, G=3000, O=300, F=2000, sub=0
    expect(tokens.cacheWriteTokens).toBe(10000 + 3 * 3000);
    expect(tokens.cachedInputTokens).toBe(3 * 10000 + 3000 * 3 * 2 / 2);
    expect(tokens.outputTokens).toBe(4 * 300 + 2000);
    expect(assumptions.iterations).toBe(4);
    expect(assumptions.subagents).toBe(0);
  });

  it('上書き値がプリセットに優先する', () => {
    const { tokens, assumptions } = buildAgenticTokens({
      mode: 'plan', taskScale: 'small', promptTokens: 0, referenceTokens: 0,
      iterations: 1, finalOutputTokens: 0,
    });
    // C0 = 4000, N=1 → cacheWrite=4000, cached=0, output = 1*300 + 0
    expect(assumptions.iterations).toBe(1);
    expect(tokens.cacheWriteTokens).toBe(4000);
    expect(tokens.cachedInputTokens).toBe(0);
    expect(tokens.outputTokens).toBe(300);
  });

  it('サブエージェント1体分が既定小型ループとして合算される', () => {
    const base = buildAgenticTokens({
      mode: 'agent', taskScale: 'medium', promptTokens: 0, referenceTokens: 1000, subagents: 0,
    }).tokens;
    const withSub = buildAgenticTokens({
      mode: 'agent', taskScale: 'medium', promptTokens: 0, referenceTokens: 1000, subagents: 1,
    }).tokens;
    // サブ既定: N=6, C0 = 3000 + 1000*0.5 = 3500, G=3000, O=800, F=0
    expect(withSub.cacheWriteTokens - base.cacheWriteTokens).toBe(3500 + 5 * 3000);              // 18500
    expect(withSub.cachedInputTokens - base.cachedInputTokens).toBe(5 * 3500 + 3000 * 5 * 4 / 2); // 47500
    expect(withSub.outputTokens - base.outputTokens).toBe(6 * 800);                               // 4800
  });

  it('未知の mode/taskScale はエラーをスロー', () => {
    expect(() => buildAgenticTokens({ mode: 'ask', taskScale: 'small' })).toThrow();
    expect(() => buildAgenticTokens({ mode: 'plan', taskScale: 'huge' })).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- tests/calculator.test.js`
Expected: FAIL（関数未定義）

- [ ] **Step 3: 実装**

`src/calculator.js` の rates import に `EXPERIMENTAL_AGENTIC_PRESETS, EXPERIMENTAL_SUBAGENT_DEFAULTS` を追加し、関数を追加:

```js
function addTokens(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

// Plan/Agent モードの tokens を組み立てる。プリセット（taskScale）を既定値とし、
// 個別パラメータの引数指定があればそちらを優先する。サブエージェントは
// EXPERIMENTAL_SUBAGENT_DEFAULTS の固定小型ループ × subagents 体を合算する。
export function buildAgenticTokens({
  mode,
  taskScale = 'medium',
  promptTokens = 0,
  referenceTokens = 0,
  iterations,
  growthPerIterationTokens,
  outputPerIterationTokens,
  finalOutputTokens,
  subagents,
} = {}) {
  const preset = EXPERIMENTAL_AGENTIC_PRESETS[mode]?.[taskScale];
  if (!preset) throw new Error(`Unknown mode/taskScale: ${mode}/${taskScale}`);

  const params = {
    iterations: iterations ?? preset.iterations,
    growthPerIterationTokens: growthPerIterationTokens ?? preset.growthPerIterationTokens,
    outputPerIterationTokens: outputPerIterationTokens ?? preset.outputPerIterationTokens,
    finalOutputTokens: finalOutputTokens ?? preset.finalOutputTokens,
    subagents: Math.max(0, Math.floor(subagents ?? preset.subagents)),
  };

  const overheadTokens = FEATURE_OVERHEAD_TOKENS[mode] ?? 0;
  let tokens = estimateAgenticTokens({
    baseContextTokens: overheadTokens + promptTokens + referenceTokens,
    iterations: params.iterations,
    growthPerIterationTokens: params.growthPerIterationTokens,
    outputPerIterationTokens: params.outputPerIterationTokens,
    finalOutputTokens: params.finalOutputTokens,
  });

  const sub = EXPERIMENTAL_SUBAGENT_DEFAULTS;
  const subTokens = estimateAgenticTokens({
    baseContextTokens: sub.baseContextTokens + referenceTokens * sub.referenceShareRatio,
    iterations: sub.iterations,
    growthPerIterationTokens: sub.growthPerIterationTokens,
    outputPerIterationTokens: sub.outputPerIterationTokens,
    finalOutputTokens: 0,
  });
  for (let i = 0; i < params.subagents; i++) {
    tokens = addTokens(tokens, subTokens);
  }

  return { tokens, assumptions: { mode, taskScale, ...params } };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/calculator.js tests/calculator.test.js
git commit -m "feat: add buildAgenticTokens with presets, overrides, and subagent aggregation"
```

---

### Task 7: 旧機能（Chat/CLI/code review）の定数・関数・テストを一括削除

**Files:**
- Modify: `src/rates.js`（`chat`/`cli` キー、`EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` を削除）
- Modify: `src/calculator.js`（`buildChatCliTokens`, `estimateCacheHitRatio`, `calculateCodeReviewCredits`, `CACHE_SCENARIO_BASE_RATIOS`, `CLI_SAME_SESSION_BONUS`, `MAX_CACHE_HIT_RATIO` を削除）
- Modify: `tests/calculator.test.js`（旧機能のテストを削除）

**Interfaces:**
- Consumes: なし
- Produces: 旧 API が存在しないこと（Task 9 の ui.js 書き換え、Task 10 の build.js ガードが前提とする）

※ この時点で `src/ui.js` は削除済み関数を import しているため**ブラウザでは壊れる**が、Jest は `src/ui.js` を読まないためテストは green を保てる。UI は Task 8–9 で復旧する。

- [ ] **Step 1: テストから旧機能を削除する**

`tests/calculator.test.js` から以下を削除:
- import 中の `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE`, `calculateCodeReviewCredits`, `buildChatCliTokens`, `estimateCacheHitRatio`
- `it('EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE は正の数（暫定値）', ...)`
- `it('FEATURE_OVERHEAD_TOKENS に chat/cli が定義されている', ...)`
- `describe('calculateCodeReviewCredits', ...)` ブロック全体
- `describe('buildChatCliTokens', ...)` ブロック全体
- `describe('estimateCacheHitRatio', ...)` ブロック全体

- [ ] **Step 2: 実装から旧機能を削除する**

`src/rates.js`:
- `FEATURE_OVERHEAD_TOKENS` から `chat` / `cli` の2行（と「Task 7 で削除予定」コメント）を削除
- `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` の定義とその説明コメントブロックを削除

`src/calculator.js`:
- import から `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` を削除
- `calculateCodeReviewCredits` 関数を削除
- `buildChatCliTokens` 関数とその説明コメントを削除
- `CACHE_SCENARIO_BASE_RATIOS`, `CLI_SAME_SESSION_BONUS`, `MAX_CACHE_HIT_RATIO`, `estimateCacheHitRatio` を削除

- [ ] **Step 3: テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS（残テスト: rates 新定数 / calculateCredits / compareModels / creditsToUSD / estimateAgenticTokens / buildAskTokens / askCacheRatioForTurn / buildAgenticTokens / tokenizer）

- [ ] **Step 4: 旧 API が残っていないことを確認**

Run: `grep -rn "buildChatCliTokens\|estimateCacheHitRatio\|calculateCodeReviewCredits\|CODE_REVIEW_CREDITS" src/ tests/ --include="*.js" | grep -v ui.js`
Expected: 出力なし（ui.js は Task 9 で書き換えるため除外）

- [ ] **Step 5: コミット**

```bash
git add src/rates.js src/calculator.js tests/calculator.test.js
git commit -m "refactor: remove chat/cli/code-review features from rates and calculator"
```

---

### Task 8: index.html を Apple 風レスポンシブデザインで全面刷新

**Files:**
- Modify: `index.html`（全置換）

**Interfaces:**
- Consumes: なし（静的マークアップ）
- Produces: Task 9 の ui.js が参照する DOM 要素 id 一式:
  `modeSegment`（radio name="mode", 値 ask/plan/agent）, `modeDescription`, `modelId`, `promptText`, `promptTokenHint`, `contextText`, `contextTokenHint`, `fileList`, `btnAddFile`, `askTurnField`, `turnNumber`, `askOutputField`, `outputChars`, `scaleField`（radio name="taskScale", 値 small/medium/large）, `adjustField`, `adjIterations`, `adjGrowth`, `adjOutputPerIter`, `adjFinalOutput`, `adjSubagents`, `btnCalc`, `results`, `resCredits`, `resUSD`, `assumptionText`, `breakdownBody`, `comparisonCard`, `comparisonBody`

- [ ] **Step 1: index.html を以下の内容で全置換する**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Copilot クレジット計算</title>
<style>
  :root {
    --bg: #f5f5f7;
    --card: #ffffff;
    --text: #1d1d1f;
    --muted: #6e6e73;
    --accent: #0071e3;
    --accent-hover: #0077ed;
    --divider: #d2d2d7;
    --radius-card: 18px;
    --radius-input: 12px;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro JP", "Hiragino Sans", "Yu Gothic UI", "Segoe UI", sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .container {
    max-width: 980px;
    margin-inline: auto;
    padding-inline: clamp(16px, 4vw, 40px);
    padding-bottom: 80px;
  }

  .hero {
    text-align: center;
    padding: clamp(40px, 8vw, 80px) 0 clamp(16px, 3vw, 32px);
  }

  .hero h1 {
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
  }

  .hero .subtitle {
    color: var(--muted);
    font-size: clamp(15px, 2vw, 19px);
    max-width: 640px;
    margin: 0 auto;
  }

  .segment-wrap {
    display: flex;
    justify-content: center;
    margin: 16px 0 8px;
  }

  .segmented {
    display: inline-flex;
    background: #e8e8ed;
    border-radius: 980px;
    padding: 3px;
  }

  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .segmented label {
    padding: 8px clamp(16px, 3vw, 28px);
    border-radius: 980px;
    font-size: 15px;
    cursor: pointer;
    color: var(--text);
    transition: background .2s ease, box-shadow .2s ease;
    user-select: none;
    white-space: nowrap;
  }

  .segmented input:checked + label {
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .12);
    font-weight: 600;
  }

  .mode-description {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    max-width: 620px;
    margin: 8px auto 32px;
  }

  .card {
    background: var(--card);
    border-radius: var(--radius-card);
    box-shadow: 0 4px 24px rgba(0, 0, 0, .06);
    padding: clamp(20px, 4vw, 36px);
    margin-bottom: 24px;
  }

  .card h2 {
    font-size: clamp(19px, 2.5vw, 24px);
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 20px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px 24px;
  }

  .field.span-full { grid-column: 1 / -1; }
  .field[hidden] { display: none; }

  .field-label {
    display: block;
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 6px;
  }

  select,
  textarea,
  input[type="number"] {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--divider);
    border-radius: var(--radius-input);
    font-size: 15px;
    font-family: inherit;
    background: #fff;
    color: var(--text);
  }

  select:focus,
  textarea:focus,
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15);
  }

  textarea {
    min-height: 100px;
    resize: vertical;
  }

  .help-text {
    display: block;
    color: var(--muted);
    font-size: 12px;
    margin-top: 4px;
  }

  #fileList { margin-bottom: 8px; }

  .file-item {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .file-item select { flex: 1 1 180px; width: auto; }
  .file-item .file-kb-input { flex: 0 0 110px; width: 110px; }

  .file-item .file-remove {
    flex: 0 0 auto;
    background: none;
    border: 1px solid var(--divider);
    border-radius: 980px;
    color: var(--muted);
    padding: 6px 12px;
    cursor: pointer;
    font-family: inherit;
  }

  .file-item .file-remove:hover { color: #d70015; border-color: #d70015; }

  #btnAddFile {
    background: none;
    border: 1px solid var(--accent);
    border-radius: 980px;
    padding: 6px 16px;
    color: var(--accent);
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
  }

  #btnAddFile:hover { background: rgba(0, 113, 227, 0.08); }

  details.adjust {
    border: 1px solid var(--divider);
    border-radius: var(--radius-input);
    padding: 12px 16px;
  }

  details.adjust summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
    color: var(--accent);
  }

  details.adjust .form-grid { margin-top: 16px; }

  .btn-primary {
    display: block;
    width: 100%;
    margin-top: 28px;
    padding: 14px 24px;
    background: var(--accent);
    border: none;
    border-radius: 980px;
    color: #fff;
    font-size: 17px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background .2s ease;
  }

  .btn-primary:hover { background: var(--accent-hover); }

  .result-hero {
    text-align: center;
    padding: 8px 0 20px;
  }

  .result-credits {
    font-size: clamp(2.5rem, 6vw, 4rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .result-credits .unit {
    font-size: clamp(1rem, 2vw, 1.4rem);
    font-weight: 500;
    color: var(--muted);
    margin-left: 8px;
  }

  .result-usd {
    color: var(--muted);
    font-size: clamp(15px, 2vw, 19px);
  }

  .assumption {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    margin: 0 0 20px;
  }

  .table-scroll { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  th, td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid #e8e8ed;
    white-space: nowrap;
  }

  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr.selected-model td { font-weight: 700; }

  .footnote {
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    margin-top: 8px;
  }
</style>
</head>
<body>
<div class="container">
  <header class="hero">
    <h1>Copilot クレジット計算</h1>
    <p class="subtitle">
      GitHub Copilot の1リクエストあたりのクレジット消費量を、モードとタスク規模から事前見積もり。
      1クレジット = $0.01。
    </p>
  </header>

  <div class="segment-wrap">
    <div class="segmented" id="modeSegment">
      <input type="radio" name="mode" id="modeAsk" value="ask" checked>
      <label for="modeAsk">Ask</label>
      <input type="radio" name="mode" id="modePlan" value="plan">
      <label for="modePlan">Plan</label>
      <input type="radio" name="mode" id="modeAgent" value="agent">
      <label for="modeAgent">Agent</label>
    </div>
  </div>
  <p class="mode-description" id="modeDescription"></p>

  <section class="card">
    <h2>入力</h2>
    <div class="form-grid">
      <div class="field span-full">
        <label class="field-label" for="modelId">使用モデル</label>
        <select id="modelId"></select>
      </div>

      <div class="field span-full">
        <label class="field-label" for="promptText">プロンプト・指示文</label>
        <textarea id="promptText" placeholder="実際に送るプロンプトを貼り付けると精度が上がります"></textarea>
        <span class="help-text" id="promptTokenHint"></span>
      </div>

      <div class="field span-full">
        <label class="field-label" for="contextText">参照コード・設計書（テキスト貼り付け）</label>
        <textarea id="contextText"></textarea>
        <span class="help-text" id="contextTokenHint"></span>
      </div>

      <div class="field span-full">
        <label class="field-label">参照ファイル・フォルダ</label>
        <div id="fileList"></div>
        <button type="button" id="btnAddFile">＋ 追加</button>
        <span class="help-text">
          ファイルサイズ(KB)からの推定は簡易概算です。Word/Excel/PowerPoint/PDF は実際のトークン量と差が出ることがあります。
          精度を上げたい場合は本文をテキスト欄へ貼り付けてください。
        </span>
      </div>

      <div class="field" id="askTurnField">
        <label class="field-label" for="turnNumber">何回目のやり取りか</label>
        <input type="number" id="turnNumber" value="1" min="1" max="100">
        <span class="help-text">2回目以降は履歴分の入力加算とキャッシュ割引を自動適用します。</span>
      </div>

      <div class="field" id="askOutputField">
        <label class="field-label" for="outputChars">想定回答文字数</label>
        <input type="number" id="outputChars" value="1500" min="1">
      </div>

      <div class="field span-full" id="scaleField" hidden>
        <label class="field-label">タスク規模</label>
        <div class="segmented" id="scaleSegment">
          <input type="radio" name="taskScale" id="scaleSmall" value="small">
          <label for="scaleSmall">軽微</label>
          <input type="radio" name="taskScale" id="scaleMedium" value="medium" checked>
          <label for="scaleMedium">中規模</label>
          <input type="radio" name="taskScale" id="scaleLarge" value="large">
          <label for="scaleLarge">大規模</label>
        </div>
        <span class="help-text">軽微＝数ファイルの小修正 / 中規模＝一機能の実装 / 大規模＝横断的な変更・大きな新機能</span>
      </div>

      <div class="field span-full" id="adjustField" hidden>
        <details class="adjust">
          <summary>詳細調整（反復回数・サブエージェント数など）</summary>
          <div class="form-grid">
            <div class="field">
              <label class="field-label" for="adjIterations">反復回数（モデル呼び出し数）</label>
              <input type="number" id="adjIterations" min="1">
            </div>
            <div class="field">
              <label class="field-label" for="adjGrowth">1反復あたりの増分トークン</label>
              <input type="number" id="adjGrowth" min="0">
            </div>
            <div class="field">
              <label class="field-label" for="adjOutputPerIter">1反復あたりの出力トークン</label>
              <input type="number" id="adjOutputPerIter" min="0">
            </div>
            <div class="field">
              <label class="field-label" for="adjFinalOutput">最終成果物の出力トークン</label>
              <input type="number" id="adjFinalOutput" min="0">
            </div>
            <div class="field">
              <label class="field-label" for="adjSubagents">サブエージェント数</label>
              <input type="number" id="adjSubagents" min="0">
            </div>
          </div>
          <p class="help-text">タスク規模を切り替えると値はプリセットに戻ります。係数は実測前の暫定値です。</p>
        </details>
      </div>
    </div>

    <button type="button" class="btn-primary" id="btnCalc">クレジット消費量を計算</button>
  </section>

  <div id="results" hidden>
    <section class="card">
      <h2>計算結果</h2>
      <div class="result-hero">
        <div class="result-credits"><span id="resCredits">-</span><span class="unit">credits</span></div>
        <div class="result-usd" id="resUSD">-</div>
      </div>
      <p class="assumption" id="assumptionText"></p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>内訳</th><th>クレジット</th></tr></thead>
          <tbody id="breakdownBody"></tbody>
        </table>
      </div>
    </section>

    <section class="card" id="comparisonCard">
      <h2>モデル別比較</h2>
      <p class="help-text">同じ条件で登録済みモデルすべてを比較しています（コスト昇順）。</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>モデル</th><th>提供元</th><th>クレジット</th><th>USD</th></tr></thead>
          <tbody id="comparisonBody"></tbody>
        </table>
      </div>
    </section>
  </div>

  <p class="footnote">
    表示される値は暫定係数に基づく概算です。実際の消費量と差が出ることがあります。
  </p>
</div>
<script type="module" src="src/ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: コミット**

（ui.js が旧 DOM を参照しているためこの時点でブラウザ動作は不可。Task 9 完了で復旧する。Jest には影響しない）

```bash
git add index.html
git commit -m "feat: redesign index.html with Apple-style responsive light theme"
```

---

### Task 9: ui.js を3モード対応に全面書き換え

**Files:**
- Modify: `src/ui.js`（全置換）

**Interfaces:**
- Consumes: `MODEL_RATES`, `EXPERIMENTAL_AGENTIC_PRESETS`（rates.js）、`estimateTextTokens`, `estimateFileTokens`（tokenizer.js）、`calculateCredits`, `compareModels`, `buildAskTokens`, `buildAgenticTokens`（calculator.js）、Task 8 の DOM id 一式
- Produces: ブラウザで動作する3モード UI

- [ ] **Step 1: src/ui.js を以下の内容で全置換する**

```js
import { MODEL_RATES, EXPERIMENTAL_AGENTIC_PRESETS } from './rates.js';
import { estimateTextTokens, estimateFileTokens } from './tokenizer.js';
import {
  calculateCredits,
  compareModels,
  buildAskTokens,
  buildAgenticTokens,
} from './calculator.js';

const FILE_TYPE_OPTIONS = [
  { value: 'md', label: 'Markdown / テキスト' },
  { value: 'code', label: 'ソースコード / フォルダ' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
];

const BREAKDOWN_LABELS = {
  inputCredits: '入力',
  cachedInputCredits: 'キャッシュ読み込み',
  cacheWriteCredits: 'キャッシュ書き込み',
  outputCredits: '出力',
};

const MODE_DESCRIPTIONS = {
  ask: 'Ask は1回のモデル呼び出しで回答を得るモードです。会話が進むほど履歴分の入力が増え、同じ参照情報にはキャッシュ割引が効きます。',
  plan: 'Plan はコードベースを探索して実装計画書を作るモードです。内部でモデル呼び出しが複数回起こる前提で概算します。',
  agent: 'Agent は自律的にコードを編集・実行するモードです。反復回数とサブエージェント数に応じて消費が大きく変わります。',
};

const SCALE_LABELS = { small: '軽微', medium: '中規模', large: '大規模' };

function formatCredits(credits) {
  return credits.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
}

function formatUSD(usd) {
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function intValue(id, fallback) {
  const n = parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function currentScale() {
  return document.querySelector('input[name="taskScale"]:checked').value;
}

// モデルセレクトを provider ごとに <optgroup> でグルーピングして生成
// （Object.entries(MODEL_RATES) 由来。モデル数・provider 数は固定しない）
function populateModelSelect() {
  const select = document.getElementById('modelId');
  select.innerHTML = '';

  const groups = new Map(); // provider -> optgroup element (insertion order preserved)

  Object.entries(MODEL_RATES).forEach(([modelKey, rate]) => {
    const provider = rate.provider ?? 'Other';
    let group = groups.get(provider);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = provider;
      groups.set(provider, group);
      select.appendChild(group);
    }
    const option = document.createElement('option');
    option.value = modelKey;
    option.textContent = rate.label ?? modelKey;
    group.appendChild(option);
  });
}

// 参照ファイル行を1件 #fileList に追加する
function addFileRow() {
  const fileList = document.getElementById('fileList');

  const row = document.createElement('div');
  row.className = 'file-item';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'file-type';
  FILE_TYPE_OPTIONS.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });

  const kbInput = document.createElement('input');
  kbInput.type = 'number';
  kbInput.className = 'file-kb-input';
  kbInput.min = '0';
  kbInput.value = '100';
  kbInput.placeholder = 'KB';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-remove';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(typeSelect);
  row.appendChild(kbInput);
  row.appendChild(removeBtn);
  fileList.appendChild(row);
}

// Plan/Agent の詳細調整欄へ現在のタスク規模のプリセット値を反映する。
// タスク規模を切り替えるとユーザーの編集値はプリセットに戻る仕様。
function applyPresetToAdjustments() {
  const mode = currentMode();
  if (mode === 'ask') return;
  const preset = EXPERIMENTAL_AGENTIC_PRESETS[mode][currentScale()];
  document.getElementById('adjIterations').value = preset.iterations;
  document.getElementById('adjGrowth').value = preset.growthPerIterationTokens;
  document.getElementById('adjOutputPerIter').value = preset.outputPerIterationTokens;
  document.getElementById('adjFinalOutput').value = preset.finalOutputTokens;
  document.getElementById('adjSubagents').value = preset.subagents;
}

// モード切替: Ask 専用欄 / Plan・Agent 専用欄の表示を切り替え、結果を隠す
function applyMode() {
  const mode = currentMode();
  const isAsk = mode === 'ask';
  document.getElementById('askTurnField').hidden = !isAsk;
  document.getElementById('askOutputField').hidden = !isAsk;
  document.getElementById('scaleField').hidden = isAsk;
  document.getElementById('adjustField').hidden = isAsk;
  document.getElementById('modeDescription').textContent = MODE_DESCRIPTIONS[mode];
  document.getElementById('results').hidden = true;
  applyPresetToAdjustments();
}

// 参照テキスト＋参照ファイル行のトークンを合算する
function collectReferenceTokens() {
  let tokens = estimateTextTokens(document.getElementById('contextText').value);
  document.querySelectorAll('.file-item').forEach((row) => {
    const fileType = row.querySelector('.file-type').value;
    const fileSizeKB = parseFloat(row.querySelector('.file-kb-input').value) || 0;
    tokens += estimateFileTokens(fileSizeKB, fileType, 'ja');
  });
  return tokens;
}

function askAssumptionText(assumptions) {
  return (
    `${assumptions.turnNumber}回目のやり取り / ` +
    `キャッシュ率 ${Math.round(assumptions.cacheRatio * 100)}% / ` +
    `履歴 ${assumptions.historyTokens.toLocaleString('ja-JP')} tokens`
  );
}

function agenticAssumptionText(assumptions) {
  return (
    `規模: ${SCALE_LABELS[assumptions.taskScale] ?? assumptions.taskScale} / ` +
    `反復 ${assumptions.iterations}回 / ` +
    `サブエージェント ${assumptions.subagents}体 / ` +
    `増分 ${assumptions.growthPerIterationTokens.toLocaleString('ja-JP')} tokens/反復`
  );
}

function bindCalcButton() {
  document.getElementById('btnCalc').addEventListener('click', () => {
    const mode = currentMode();
    const promptTokens = estimateTextTokens(document.getElementById('promptText').value);
    const referenceTokens = collectReferenceTokens();

    let built;
    let assumptionText;
    if (mode === 'ask') {
      const outputChars = Math.max(0, intValue('outputChars', 0));
      built = buildAskTokens({
        promptTokens,
        referenceTokens,
        turnNumber: intValue('turnNumber', 1),
        outputTokens: estimateTextTokens('a'.repeat(outputChars)),
      });
      assumptionText = askAssumptionText(built.assumptions);
    } else {
      built = buildAgenticTokens({
        mode,
        taskScale: currentScale(),
        promptTokens,
        referenceTokens,
        iterations: intValue('adjIterations', undefined),
        growthPerIterationTokens: intValue('adjGrowth', undefined),
        outputPerIterationTokens: intValue('adjOutputPerIter', undefined),
        finalOutputTokens: intValue('adjFinalOutput', undefined),
        subagents: intValue('adjSubagents', undefined),
      });
      assumptionText = agenticAssumptionText(built.assumptions);
    }

    const modelId = document.getElementById('modelId').value;
    const result = calculateCredits(built.tokens, modelId);
    const comparisons = compareModels(built.tokens);
    renderResult(result, comparisons, assumptionText);
  });
}

// #resCredits / #resUSD / #assumptionText / #breakdownBody / #comparisonBody を更新して表示する
function renderResult(result, comparisons, assumptionText) {
  document.getElementById('resCredits').textContent = formatCredits(result.totalCredits);
  document.getElementById('resUSD').textContent = `約 ${formatUSD(result.totalUSD)}`;
  document.getElementById('assumptionText').textContent = assumptionText;

  const breakdownBody = document.getElementById('breakdownBody');
  breakdownBody.innerHTML = '';
  Object.entries(result.breakdown)
    .filter(([, credits]) => credits > 0)
    .forEach(([key, credits]) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.textContent = BREAKDOWN_LABELS[key] ?? key;
      const creditsTd = document.createElement('td');
      creditsTd.textContent = formatCredits(credits);
      tr.appendChild(labelTd);
      tr.appendChild(creditsTd);
      breakdownBody.appendChild(tr);
    });

  const comparisonBody = document.getElementById('comparisonBody');
  comparisonBody.innerHTML = '';
  comparisons.forEach((comparison) => {
    const modelRate = MODEL_RATES[comparison.modelKey] ?? {};
    const tr = document.createElement('tr');
    if (comparison.modelKey === result.modelKey) {
      tr.className = 'selected-model';
    }
    const modelTd = document.createElement('td');
    modelTd.textContent = comparison.label;
    const providerTd = document.createElement('td');
    providerTd.textContent = modelRate.provider ?? '-';
    const creditsTd = document.createElement('td');
    creditsTd.textContent = formatCredits(comparison.totalCredits);
    const usdTd = document.createElement('td');
    usdTd.textContent = formatUSD(comparison.totalUSD);
    tr.appendChild(modelTd);
    tr.appendChild(providerTd);
    tr.appendChild(creditsTd);
    tr.appendChild(usdTd);
    comparisonBody.appendChild(tr);
  });

  document.getElementById('results').hidden = false;
}

// トークン数ヒントをライブ更新する（input イベント）
function bindTokenHints() {
  const promptText = document.getElementById('promptText');
  const promptTokenHint = document.getElementById('promptTokenHint');
  const contextText = document.getElementById('contextText');
  const contextTokenHint = document.getElementById('contextTokenHint');

  const updatePromptHint = () => {
    promptTokenHint.textContent = `推定 ${estimateTextTokens(promptText.value).toLocaleString('ja-JP')} トークン`;
  };
  const updateContextHint = () => {
    contextTokenHint.textContent = `推定 ${estimateTextTokens(contextText.value).toLocaleString('ja-JP')} トークン`;
  };

  promptText.addEventListener('input', updatePromptHint);
  contextText.addEventListener('input', updateContextHint);

  updatePromptHint();
  updateContextHint();
}

function bindModeAndScale() {
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', applyMode);
  });
  document.querySelectorAll('input[name="taskScale"]').forEach((radio) => {
    radio.addEventListener('change', applyPresetToAdjustments);
  });
}

populateModelSelect();
bindModeAndScale();
bindCalcButton();
bindTokenHints();
document.getElementById('btnAddFile').addEventListener('click', addFileRow);
applyMode();
```

- [ ] **Step 2: テストが通ることを確認（リグレッションチェック）**

Run: `npm test`
Expected: 全 PASS

- [ ] **Step 3: 開発サーバーで手動確認**

Run: `npx serve . -p 3000` → ブラウザで `http://localhost:3000`

確認項目:
- Ask/Plan/Agent セグメントの切り替えで説明文とフィールドが切り替わる
- Ask: 何回目=1 で計算 → 内訳に「キャッシュ読み込み」が出ない。何回目=3 で計算 → キャッシュ読み込みが出る
- Plan/Agent: タスク規模切替で詳細調整の値が変わる。詳細調整を編集して計算すると結果が変わる
- Agent/大規模 が Ask より大きなクレジットになる
- モデル別比較表がコスト昇順で全モデル表示される
- ウィンドウ幅を 400px 相当まで縮めてもレイアウトが崩れない（1カラム化・表横スクロール）

- [ ] **Step 4: コミット**

```bash
git add src/ui.js
git commit -m "feat: rewrite UI for ask/plan/agent modes with preset adjustments"
```

---

### Task 10: build.js のガード更新と dist 再生成

**Files:**
- Modify: `build.js:34-57`
- Output: `dist/index.html`

**Interfaces:**
- Consumes: Task 1–9 の全成果物
- Produces: 配布物 `dist/index.html`

- [ ] **Step 1: build.js の検証リストを更新**

`requiredSnippets` を新 API に置き換え:

```js
const requiredSnippets = [
  'MODEL_RATES',
  'estimateTextTokens',
  'estimateHistoryTokens',
  'calculateCredits',
  'estimateAgenticTokens',
  'buildAskTokens',
  'buildAgenticTokens',
  'EXPERIMENTAL_AGENTIC_PRESETS',
  'populateModelSelect',
];
```

`cachedInputPct` ガードの直後に、旧機能が dist に復活していないことのガードを追加（既存の `cachedInputPct` / 開発者向け警告ガードは残す）:

```js
// 旧機能（Chat/CLI/code review）が誤って復活していないことを検証する
const forbiddenLegacySnippets = [
  'buildChatCliTokens',
  'estimateCacheHitRatio',
  'calculateCodeReviewCredits',
  'cacheScenario',
  'cliSameSession',
  'diffLines',
];

for (const snippet of forbiddenLegacySnippets) {
  if (html.includes(snippet)) {
    throw new Error(`Build failed: legacy feature "${snippet}" should not remain in the final UI`);
  }
}
```

- [ ] **Step 2: ビルド実行**

Run: `npm run build`
Expected: `Built dist/index.html`（エラーなし）

- [ ] **Step 3: dist をダブルクリック相当で手動確認**

`dist/index.html` を直接ブラウザで開き（file://）、Task 9 Step 3 と同じ確認項目が動作すること。

- [ ] **Step 4: テスト最終確認とコミット**

Run: `npm test`
Expected: 全 PASS

```bash
git add build.js dist/index.html
git commit -m "build: update dist guards for ask/plan/agent and regenerate dist"
```

---

### Task 11: ドキュメント更新（CLAUDE.md / README.md / 説明資料）

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/説明資料/計算ロジック説明.md`

**Interfaces:**
- Consumes: Task 1–10 の実装
- Produces: 新設計と矛盾しないドキュメント一式

- [ ] **Step 1: CLAUDE.md を更新**

以下の記述を新設計に合わせて書き換える:
- プロジェクト概要: 「対象機能は **Copilot Chat / Copilot CLI / Copilot code review** の3つに限定する（個人が1リクエスト/1PRあたりに消費する量の事前確認が目的）」→「対象機能は **Ask モード / Plan モード / Agent モード** の3つに限定する（個人が1リクエストあたりに消費する量の事前確認が目的）。Plan/Agent は内部で複数回のモデル呼び出しが起こる前提の反復シミュレーションで概算する」
- 「クレジット単価の更新」節の rates.js 内容一覧:
  - `FEATURE_OVERHEAD_TOKENS`: 「Chat/CLI の〜」→「Ask/Plan/Agent の system prompt・tool definitions 等の見えない文脈分の概算オーバーヘッド係数」
  - `EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` の行を削除し、代わりに:
    - `EXPERIMENTAL_AGENTIC_PRESETS`: Plan/Agent のタスク規模別プリセット（反復回数・増分・出力・サブエージェント数）。実測データが無いため暫定値（変数名に `EXPERIMENTAL` を含める）
    - `EXPERIMENTAL_SUBAGENT_DEFAULTS`: サブエージェント1体分の固定小型ループ係数
    - `ASK_TURN_CACHE_RATIOS`: Ask の「何回目のやり取りか」→キャッシュ率の対応表
- 対応ファイル形式の表に `ソースコード / フォルダ | 300 | ASCII主体のため言語共通` の行を追加
- 注意事項: 「`EXPERIMENTAL_CODE_REVIEW_CREDITS_PER_DIFF_LINE` は〜」→「`EXPERIMENTAL_AGENTIC_PRESETS` / `EXPERIMENTAL_SUBAGENT_DEFAULTS` は実測前の暫定係数。実測データ取得後に較正すること」

- [ ] **Step 2: README.md を更新**

機能説明・代表例を Ask/Plan/Agent の3モードに書き換える（Chat/CLI/code review への言及を削除）。計算ロジックの説明として本計画書冒頭の閉形式（cacheWrite / cachedInput / output の式）を記載する。

- [ ] **Step 3: docs/説明資料/計算ロジック説明.md を更新**

旧 Chat/CLI/code review の説明を Ask/Plan/Agent に全面改訂する。必須要素:
- 用語定義表は既存を流用（Cache Write の行を追加: 「エージェントループで新規コンテキストをキャッシュに書き込む分。Anthropic 系は専用単価、他は input 単価」）
- ① Ask モードの式: `消費クレジット = [(Input × Input単価) + (Cached Input × Cached単価) + (Output × Output単価)] ÷ 10,000`、「何回目のやり取りか」が履歴とキャッシュ率を決める旨
- ② Plan/Agent モードの式: 反復シミュレーションの閉形式と、タスク規模プリセット表（本計画書 Task 4 の表を転記）
- 係数はすべて実測前の暫定値であり較正予定である旨の注記

- [ ] **Step 4: 整合性チェック**

Run: `grep -rn "code review\|Copilot CLI\|codeReview\|cacheScenario" CLAUDE.md README.md docs/説明資料/ --include="*.md"`
Expected: 出力なし（歴史的経緯の説明として意図的に残す箇所があれば除く）

- [ ] **Step 5: コミット**

```bash
git add CLAUDE.md README.md docs/説明資料/計算ロジック説明.md
git commit -m "docs: update all documentation for ask/plan/agent redesign"
```

---

### Task 12: main への統合（fast-forward）

**Files:** なし（git 操作のみ）

**Interfaces:**
- Consumes: Task 1–11 のコミット済み成果物（`npm test` 全緑であること）
- Produces: main が本ブランチと同一コミットを指す

- [ ] **Step 1: 最終検証**

Run: `npm test && npm run build`
Expected: テスト全 PASS、`Built dist/index.html`

- [ ] **Step 2: 作業ツリーがクリーンであることを確認**

Run: `git status --short`
Expected: 出力なし

- [ ] **Step 3: main を fast-forward**

```bash
git -C 'C:/デスクトップ/CLAUDE_Staion/010_Github_Token_Simulation_plt1' merge --ff-only feature/copilot-credit-calculator-v4-1
```

Expected: `Fast-forward` 表示。エラー（divergence）が出た場合は main に新規コミットが入っているので、main をこのブランチへマージしてから再実行する。

- [ ] **Step 4: 統合確認**

Run: `git -C 'C:/デスクトップ/CLAUDE_Staion/010_Github_Token_Simulation_plt1' log --oneline -3`
Expected: 本ブランチの最新コミットが main の先頭にある
