"""Generate TXT parity fixtures: server-side pagination output for JS parity tests.

Usage:
    python3 tests/gen_txt_parity_data.py <out_dir>
"""

import json
import sys
import tempfile
from pathlib import Path

from app.services.ebook import txt_text_utf8, txt_page, txt_info, parse_file


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/data/txt_parity")
    out_dir.mkdir(parents=True, exist_ok=True)

    samples = [
        (
            "gbk_chapters",
            "第一章 测试\n" + ("正文内容。\n" * 300) + "第二章 结束\n" + ("结尾。\n" * 200),
            "gb18030",
        ),
        (
            "utf8_bom",
            "序言\n" + ("前言内容。\n" * 400) + "第三章 结尾\n" + "结束内容。\n",
            "utf-8-sig",
        ),
        (
            "utf16",
            "第1章 标题\n" + ("正文内容。\n" * 500) + "第2章 结束\n" + "结尾。\n",
            "utf-16",
        ),
        (
            "long_lines",
            "楔子\n" + ("A" * 4000 + "\n") * 30 + ("中文段落" * 300 + "\n") * 40,
            "utf-8",
        ),
        (
            "no_trailing_newline",
            "前言\n" + ("一级标题。\n" * 120) + "后记" + ("。\n" * 60) + "结尾",
            "utf-8",
        ),
        (
            "no_chapters",
            "".join("第" if i % 7 == 0 else "行" for i in range(1, 4000)) + "\n" * 50,
            "utf-8",
        ),
    ]

    for fixture_name, text, encoding in samples:
        case_dir = out_dir / fixture_name
        case_dir.mkdir(parents=True, exist_ok=True)
        # 保留原始编码字节，便于复现
        (case_dir / "source.bin").write_bytes(text.encode(encoding))
        # 服务端 /stream 端点等价内容：txt_text_utf8 解码出的 UTF-8 文本
        # 注意：txt_text_utf8 需要真实文件，这里通过临时文件实现
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "book.txt"
            p.write_bytes(text.encode(encoding))
            utf8_text = txt_text_utf8(p).decode("utf-8")
            info = txt_info(p)
            total = info["totalPages"]
            page_contents = [txt_page(p, n)["content"] for n in range(1, total + 1)]
            toc = parse_file(p, "txt")["toc"]
            expected = {
                "total_pages": total,
                "pages": page_contents,
                "toc": toc,
                "utf8_text": utf8_text,
            }
        (case_dir / "expected.json").write_text(
            json.dumps(expected, ensure_ascii=False), encoding="utf-8"
        )
        print(f"generated {fixture_name}: {len(utf8_text)} chars, {total} pages")


if __name__ == "__main__":
    main()