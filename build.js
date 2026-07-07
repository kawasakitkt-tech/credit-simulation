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
  // Handle both single-line and multi-line brace-style imports
  .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*$/gm, '')
  // Fallback for any remaining single-line imports (defensive)
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
  'estimateAgenticTokens',
  'buildAskTokens',
  'buildAgenticTokens',
  'EXPERIMENTAL_AGENTIC_PRESETS',
  'populateModelSelect',
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    throw new Error(`Build failed: missing ${snippet}`);
  }
}

// キャッシュ率の自由入力欄・開発者向け警告が誤って復活していないことを検証する
if (html.includes('cachedInputPct')) {
  throw new Error('Build failed: cachedInputPct should not remain in the final UI');
}

if (html.includes('src/rates.js の値を確認してください')) {
  throw new Error('Build failed: developer-facing code review warning should not appear in UI');
}

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

// Validate that no leftover import/export statements remain in the inlined script
const leftoverImportExportRegex = /^\s*(import|export)\s/m;
const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (scriptMatch && leftoverImportExportRegex.test(scriptMatch[1])) {
  throw new Error('Build failed: leftover import/export statements found in inlined script');
}

console.log('Built dist/index.html');
