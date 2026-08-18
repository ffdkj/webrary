/**
 * test_txt_pagination_parity.js — 验证客户端 TXT 分页与服务端算法一致
 *
 * 运行方式：
 *   1) python3 tests/gen_txt_parity_data.py tests/data/txt_parity
 *   2) node tests/test_txt_pagination_parity.js tests/data/txt_parity
 *
 * 校验点：
 *   - 总页数一致
 *   - 每一页渲染内容与服务端 txt_page 返回的 content 逐字一致
 *   - 章节标题（第X章 / 序言 / 前言 / 楔子 / 尾声 / 后记 / 附录）行能识别
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { buildPages, getPageText, isChapterTitle } = require(
  path.join(__dirname, '..', 'static', 'js', 'txt-pagination.js')
);

const dataRoot = process.argv[2] || path.join(__dirname, 'data', 'txt_parity');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name === 'expected.json') out.push(p);
  }
  return out;
}

const cases = walk(dataRoot, []);
assert.ok(cases.length > 0, `no fixtures found under ${dataRoot}`);

let failed = 0;
for (const expectedPath of cases) {
  const caseName = path.relative(dataRoot, path.dirname(expectedPath));
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  const text = expected.utf8_text;

  const built = buildPages(text);

  try {
    assert.strictEqual(
      built.totalPages,
      expected.total_pages,
      `${caseName}: totalPages ${built.totalPages} != server ${expected.total_pages}`
    );

    for (let i = 1; i <= built.totalPages; i++) {
      const pageText = getPageText(built.lines, built.pages, i);
      assert.strictEqual(
        pageText,
        expected.pages[i - 1],
        `${caseName}: page ${i} content mismatch`
      );
    }

    // 章节/目录保持一致：标题与起始页码逐条对比
    const serverToc = expected.toc || [];
    assert.strictEqual(
      built.toc.length,
      serverToc.length,
      `${caseName}: toc entries ${built.toc.length} != server ${serverToc.length}`
    );
    for (let i = 0; i < serverToc.length; i++) {
      assert.strictEqual(
        built.toc[i].title,
        serverToc[i].title,
        `${caseName}: toc[${i}] title mismatch`
      );
      assert.strictEqual(
        built.toc[i].startPage,
        serverToc[i].startPage,
        `${caseName}: toc[${i}] startPage mismatch`
      );
      assert.ok(
        isChapterTitle(built.toc[i].title),
        `${caseName}: toc[${i}] title should be a chapter line`
      );
    }

    console.log(`PASS ${caseName}: ${built.totalPages} pages, ${built.toc.length} toc entries`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${caseName}: ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log('\nAll TXT pagination parity checks passed.');