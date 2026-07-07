import { describe, it, expect } from '@jest/globals';
import {
  estimateTextTokens,
  estimateFileTokens,
  estimateHistoryTokens,
  estimateTokensFromCharCount,
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
  it('Markdown 10KB → 約 6500 トークン前後（CLAUDE.md記載の650 tokens/KB, ja）', () => {
    const tokens = estimateFileTokens(10, 'md', 'ja');
    expect(tokens).toBeGreaterThan(6000);
    expect(tokens).toBeLessThan(7000);
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

  it('ソースコード/フォルダは約300 tokens/KB（コードは言語によらずASCII主体のため ja/en 共通）', () => {
    expect(estimateFileTokens(10, 'code', 'ja')).toBe(3000);
    expect(estimateFileTokens(10, 'code', 'en')).toBe(3000);
  });
});

describe('estimateHistoryTokens', () => {
  it('過去会話ターン数が0なら履歴トークンも0', () => {
    expect(estimateHistoryTokens(0, 500, 1000)).toBe(0);
  });

  it('1ターン分（ユーザー500字＋アシスタント1000字）は日本語係数0.65で325+650=975トークン', () => {
    expect(estimateHistoryTokens(1, 500, 1000)).toBe(975);
  });

  it('過去会話ターン数に比例して履歴トークンが増える（累積ではなく線形）', () => {
    const oneTurn = estimateHistoryTokens(1, 500, 1000);
    const twoTurns = estimateHistoryTokens(2, 500, 1000);
    expect(twoTurns).toBeCloseTo(oneTurn * 2, 0);
  });
});

describe('estimateTokensFromCharCount', () => {
  it('日本語係数(既定): 1500字 → 975トークン', () => {
    expect(estimateTokensFromCharCount(1500)).toBe(975);
    expect(estimateTokensFromCharCount(1500, 'ja')).toBe(975);
  });

  it('英語係数: 1000字 → 250トークン', () => {
    expect(estimateTokensFromCharCount(1000, 'en')).toBe(250);
  });

  it('0字は0トークン', () => {
    expect(estimateTokensFromCharCount(0)).toBe(0);
  });

  it('負の値は0トークンに丸める', () => {
    expect(estimateTokensFromCharCount(-5)).toBe(0);
  });
});
