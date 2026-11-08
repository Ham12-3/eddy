"""The latency benchmark runs and reports against its target."""

import json
from pathlib import Path

import pytest

from eddy_maths_core.bench import main
from eddy_maths_core.golden import record


def test_bench_reports_p95(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "items.jsonl"
    entries = [record("a17-two-step", 1), record("n2-fraction-add-unlike", 2)]
    path.write_text("\n".join(json.dumps(e) for e in entries), encoding="utf-8")
    assert main([str(path)]) == 0
    assert "p95" in capsys.readouterr().out
