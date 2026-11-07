"""One-off harvester for inputs written inline in upstream test bodies.

Run from the upstream checkout:

    cd upstream && uv run python ../scripts/golden/harvest.py

It runs the upstream converter tests under pytest with the converter entry
points wrapped, records every argument a test (or a helper defined in a test
module) passes to them, and writes each distinct input into the golden corpus:

- Markdown inputs -> ``scripts/golden/corpus/test-<module>-<test>[-N].md``
- ProseMirror docs -> ``scripts/golden/corpus-docs/test-<module>-<test>[-N].json``

The output is committed; ``generate.py`` reads it like any hand-written corpus
file. Re-running overwrites only the ``test-*`` files. No network.
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
UPSTREAM = Path.cwd()
CORPUS = HERE / "corpus"
CORPUS_DOCS = HERE / "corpus-docs"
DRAFT_TESTS = UPSTREAM / "packages" / "gateway_drafts" / "tests"
CORE_TESTS = UPSTREAM / "packages" / "gateway_core" / "tests"
TEST_FILES = sorted(
    [
        *DRAFT_TESTS.glob("test_dialect_*.py"),
        *DRAFT_TESTS.glob("test_draft_markdown_*.py"),
        DRAFT_TESTS / "test_draft_round_trip.py",
        CORE_TESTS / "test_markdown.py",
    ]
)
TEST_DIRS = {str(DRAFT_TESTS), str(CORE_TESTS)}
MAX_INPUT_CHARS = 4000  # the linear-time stress inputs are not useful goldens
MAX_PER_TEST = 25  # the seeded random tests call the parser hundreds of times

_markdown: dict[str, str] = {}  # input -> test id (first seen)
_docs: dict[str, tuple[str, Any]] = {}  # canonical JSON -> (test id, doc)


def _caller_is_test() -> bool:
    frame = sys._getframe(2)
    return str(Path(frame.f_code.co_filename).parent) in TEST_DIRS


def _test_id() -> str:
    current = os.environ.get("PYTEST_CURRENT_TEST", "unknown::unknown")
    path, _, rest = current.partition("::")
    func = rest.split(" ")[0].split("[")[0].split("::")[-1]
    return f"{Path(path).stem}::{func}"


def _record_markdown(value: Any) -> None:
    if isinstance(value, str) and len(value) <= MAX_INPUT_CHARS:
        _markdown.setdefault(value, _test_id())


def _record_doc(doc: Any) -> None:
    try:
        key = json.dumps(doc, sort_keys=True, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return  # not plain JSON: the TS side could not read it either
    if len(key) <= MAX_INPUT_CHARS:
        _docs.setdefault(key, (_test_id(), copy.deepcopy(doc)))


def _paragraph_doc(content: Any) -> dict[str, Any]:
    paragraph = {"type": "paragraph", "attrs": {"textAlign": None}, "content": content}
    return {"type": "doc", "content": [paragraph]}


def _wrap(module: Any, name: str, record: Any) -> None:
    original = getattr(module, name)

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if args and _caller_is_test():
            record(args[0])
        return original(*args, **kwargs)

    setattr(module, name, wrapper)


def _install() -> None:
    from gateway_core.converters import markdown as core_md
    from gateway_drafts.converters import markdown as draft_md
    from gateway_drafts.converters.dialect import blocks, inline, serialize

    _wrap(blocks, "parse_blocks", _record_markdown)
    _wrap(inline, "parse_inline", _record_markdown)
    _wrap(draft_md, "markdown_to_draft_doc", _record_markdown)
    _wrap(draft_md, "markdown_to_draft_body", _record_markdown)
    _wrap(core_md, "markdown_to_doc", _record_markdown)
    _wrap(core_md, "markdown_to_note_payload", _record_markdown)
    _wrap(serialize, "serialize_doc", _record_doc)
    _wrap(inline, "serialize_inline", lambda c: _record_doc(_paragraph_doc(c)))
    _wrap(
        draft_md,
        "draft_body_to_markdown",
        lambda body: _record_doc(json.loads(body)) if isinstance(body, str) else None,
    )


def _slug(test_id: str) -> str:
    module, _, func = test_id.partition("::")
    module = re.sub(r"^test_(dialect_|draft_markdown_|draft_)?", "", module)
    func = re.sub(r"^test_", "", func)
    return re.sub(r"[^a-z0-9]+", "-", f"test-{module}-{func}".lower()).strip("-")


def _names(test_ids: list[str]) -> list[str]:
    """One file name per entry: the test slug, numbered when a test has several."""
    totals: dict[str, int] = defaultdict(int)
    for test_id in test_ids:
        totals[_slug(test_id)] += 1
    seen: dict[str, int] = defaultdict(int)
    names = []
    for test_id in test_ids:
        slug = _slug(test_id)
        seen[slug] += 1
        names.append(f"{slug}-{seen[slug]:02d}" if totals[slug] > 1 else slug)
    return names


def _capped(items: list[tuple[str, Any]]) -> list[tuple[str, Any]]:
    per_test: dict[str, int] = defaultdict(int)
    kept = []
    for test_id, value in items:
        per_test[test_id] += 1
        if per_test[test_id] <= MAX_PER_TEST:
            kept.append((test_id, value))
    return kept


def main() -> int:
    _install()
    code = pytest.main(
        ["-q", "-p", "no:cacheprovider", "--import-mode=importlib"]
        + [str(p) for p in TEST_FILES]
    )
    if code != 0:
        print(f"upstream tests failed (exit {code}); corpus not written", file=sys.stderr)
        return int(code)

    for directory in (CORPUS, CORPUS_DOCS):
        directory.mkdir(parents=True, exist_ok=True)
        for stale in directory.glob("test-*"):
            stale.unlink()

    md_items = _capped([(tid, md) for md, tid in _markdown.items()])
    for name, (_, md) in zip(_names([t for t, _ in md_items]), md_items, strict=True):
        with open(CORPUS / f"{name}.md", "w", encoding="utf-8", newline="") as fh:
            fh.write(md)

    doc_items = _capped(list(_docs.values()))
    for name, (_, doc) in zip(_names([t for t, _ in doc_items]), doc_items, strict=True):
        text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        (CORPUS_DOCS / f"{name}.json").write_text(text, encoding="utf-8")

    print(f"harvested {len(md_items)} markdown inputs and {len(doc_items)} docs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
