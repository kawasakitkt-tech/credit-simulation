// クレジット単価 (USD per 1,000,000 tokens)
// GitHub Copilot は 2026/6/1 に premium request 課金を廃止し、
// トークンベースの従量課金（GitHub AI Credits, 1 credit = $0.01）へ移行した。
// 計算式: credits = tokens × usd_per_1m / 10,000 （$0.01/credit 換算込み）
// 出典: 事務局提供の単価表（2026-07-01 時点）
export const USD_PER_CREDIT = 0.01;

// モード利用時、ユーザー入力とは別に system prompt / tool definitions /
// custom instructions 等の見えない文脈が消費するトークンの概算固定値。
// Plan/Agent はツール定義が多いため大きい。要確認（暫定値）。実測データ取得後に較正すること。
export const FEATURE_OVERHEAD_TOKENS = {
  ask: 1500,
  plan: 4000,
  agent: 6000,
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
