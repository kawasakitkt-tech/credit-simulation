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
