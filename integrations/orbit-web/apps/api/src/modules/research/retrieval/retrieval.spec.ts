import assert from "node:assert/strict";
import { test } from "node:test";
import { foldForSearch, searchableOf } from "./fold.js";
import { MAX_TERMS, queryTerms, tsqueryOf } from "./retriever.js";

test("folding for search: Vietnamese marks and đ go, case goes, and the words stay the words", () => {
  assert.equal(foldForSearch("Rò rỉ dữ liệu khách hàng"), "ro ri du lieu khach hang");
  assert.equal(foldForSearch("ĐẢM BẢO AN TOÀN THÔNG TIN"), "dam bao an toan thong tin");
  assert.equal(foldForSearch("Quản trị rủi ro AI — Điều 5"), "quan tri rui ro ai — dieu 5");
  // Composed and decomposed spellings of one word fold to the same text.
  assert.equal(foldForSearch("Việt".normalize("NFC")), foldForSearch("Việt".normalize("NFD")));
  assert.equal(foldForSearch("Việt"), "viet");
});

test("folding for search: English is lower-cased, accents of borrowed words and ligatures are plain letters", () => {
  assert.equal(foldForSearch("Data Leakage via Prompt-Injection"), "data leakage via prompt-injection");
  assert.equal(foldForSearch("naïve café résumé"), "naive cafe resume");
  assert.equal(foldForSearch("ﬁnancial ﬂows"), "financial flows");
  assert.equal(foldForSearch("ＡＩ　ｒｉｓｋ"), "ai risk");
});

test("a chunk is searched by its section's title and its text, folded", () => {
  assert.equal(searchableOf("Phạm vi", "Dữ liệu cá nhân"), "pham vi\ndu lieu ca nhan");
  assert.equal(searchableOf(null, "Only text"), "only text");
  assert.equal(searchableOf("", "Only text"), "only text");
});

test("a question's words become search terms: folded, stopwords out (with or without their marks), each once", () => {
  assert.deepEqual(queryTerms("What does the NIST AI RMF say about prompt-injection?"), ["nist", "ai", "rmf", "say", "prompt", "injection"]);
  assert.deepEqual(queryTerms("Rò rỉ dữ liệu là gì?"), ["ro", "ri", "du", "lieu"]);
  assert.deepEqual(queryTerms("ro ri du lieu la gi"), ["ro", "ri", "du", "lieu"], "typed without marks: the same terms");
  assert.deepEqual(queryTerms("the of and"), []);
  assert.deepEqual(queryTerms("Không có gì về điều đó"), ["dieu"]);
  assert.deepEqual(queryTerms("Article 5 of GDPR, article 5!"), ["article", "5", "gdpr"]);
  assert.equal(queryTerms(Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")).length, MAX_TERMS);
});

test("search terms become one tsquery text, any term matching: each a quoted lexeme, nothing an operator", () => {
  assert.equal(tsqueryOf(["ro", "ri"]), "'ro' | 'ri'");
  assert.equal(tsqueryOf(["it's"]), "'it''s'", "a quote is doubled, though queryTerms never makes one");
  assert.equal(tsqueryOf([]), "");
  for (const term of queryTerms("a & b | !c <-> (d) : 'e' * f")) assert.match(term, /^[\p{L}\p{N}]+$/u);
});
