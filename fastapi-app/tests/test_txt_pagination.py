"""Focused tests for TXT encoding detection and server-side pagination."""

import tempfile
import unittest
from pathlib import Path

from app.services.ebook import txt_info, txt_page


def _write_txt(td: str, name: str, text: str, encoding: str) -> Path:
    path = Path(td) / name
    path.write_bytes(text.encode(encoding))
    return path


class TxtPaginationTest(unittest.TestCase):
    def _assert_common(self, path: Path, expected_encoding: str, sample: str):
        info = txt_info(path)
        self.assertEqual(info["encoding"], expected_encoding)
        self.assertGreater(info["totalPages"], 1)
        first = txt_page(path, 1)["content"]
        self.assertIn(sample, first)
        last = txt_page(path, info["totalPages"])["content"]
        self.assertGreater(len(last), 0)
        with self.assertRaises(ValueError):
            txt_page(path, info["totalPages"] + 1)

    def test_gbk_txt(self):
        text = "第一章 测试\n" + ("正文内容。\n" * 300) + "第二章 结束\n" + ("结尾。\n" * 200)
        with tempfile.TemporaryDirectory() as td:
            path = _write_txt(td, "gbk.txt", text, "gb18030")
            self._assert_common(path, "gb18030", "第一章 测试")

    def test_utf8_with_bom(self):
        text = "序言\n" + ("前言内容。\n" * 400) + "第三章 结尾\n" + "结束内容。\n"
        with tempfile.TemporaryDirectory() as td:
            path = _write_txt(td, "utf8-bom.txt", text, "utf-8-sig")
            self._assert_common(path, "utf-8", "序言")

    def test_utf16_with_bom(self):
        text = "第1章 标题\n" + ("正文内容。\n" * 500) + "第2章 结束\n" + "结尾。\n"
        with tempfile.TemporaryDirectory() as td:
            path = _write_txt(td, "utf16.txt", text, "utf-16")
            info = txt_info(path)
            self.assertIn(info["encoding"], ("utf-16-le", "utf-16-be"))
            self._assert_common(path, info["encoding"], "第1章 标题")


if __name__ == "__main__":
    unittest.main()
