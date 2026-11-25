import sys

from sample.paths import native

SEP = "\\" if sys.platform == "win32" else "/"


def test_native_separators():
    assert native("a/b\\c") == f"a{SEP}b{SEP}c"


def test_home_is_kept():
    assert native("~/x") == "~/x"
