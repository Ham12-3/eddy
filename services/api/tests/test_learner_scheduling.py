"""Elo, FSRS reviews, node selection and interleaving (SPEC.md 4.2, 4.3 and 7.1)."""

import random
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fsrs import Card, Rating

from eddy_api.learner import elo, review
from eddy_api.learner.mastery import NodeMastery, probe_codes
from eddy_api.learner.misconceptions import apply
from eddy_api.learner.planner import (
    NodeInfo,
    choose_node,
    interleaving_on,
    plan_session,
    ready,
    review_order,
)
from eddy_api.seed.curriculum import Curriculum, load

NOW = datetime(2026, 9, 7, 16, 0, tzinfo=UTC)
CURRICULUM = Path(__file__).resolve().parents[3] / "curriculum"


def secure(code: str) -> NodeMastery:
    return NodeMastery(node=code, p_mastery=0.97, status="SECURE", evidence_count=4)


def learning(code: str, p: float) -> NodeMastery:
    return NodeMastery(node=code, p_mastery=p, status="LEARNING", evidence_count=2)


# Elo


def test_expected_score_is_symmetric_and_scaled() -> None:
    assert elo.expected(1500, 1500) == pytest.approx(0.5)
    assert elo.expected(1900, 1500) == pytest.approx(10 / 11)
    assert elo.expected(1500, 1700) + elo.expected(1700, 1500) == pytest.approx(1)


def test_item_k_shrinks_with_attempts() -> None:
    assert elo.item_k(0) == elo.K_ITEM_START
    assert elo.item_k(20) == pytest.approx(elo.K_ITEM_START / 2)
    assert elo.item_k(60) == pytest.approx(10)
    assert elo.item_k(10_000) == elo.K_ITEM_MIN


def test_a_surprising_result_moves_both_ratings() -> None:
    ability, difficulty = elo.update(1500, 1700, 0, correct=True)
    assert ability > 1500
    assert difficulty < 1700


def test_an_aided_attempt_moves_neither_rating() -> None:
    assert elo.update(1500, 1700, 0, correct=True, aided=True) == (1500, 1700)


def test_elo_recovers_item_difficulties() -> None:
    """Simulated students answer items of known difficulty; estimates end up in the right
    order (Spearman correlation above 0.9)."""
    rng = random.Random(4)
    true_difficulty = [1200 + 40 * i for i in range(15)]
    estimates = [elo.START] * 15
    counts = [0] * 15
    for _ in range(300):
        true_ability = rng.gauss(1500, 150)
        ability = elo.START
        for _ in range(15):
            i = rng.randrange(15)
            correct = rng.random() < elo.expected(true_ability, true_difficulty[i])
            ability, estimates[i] = elo.update(ability, estimates[i], counts[i], correct)
            counts[i] += 1
    rank_true = sorted(range(15), key=lambda i: true_difficulty[i])
    rank_est = sorted(range(15), key=lambda i: estimates[i])
    position = {item: place for place, item in enumerate(rank_est)}
    d2 = sum((place - position[item]) ** 2 for place, item in enumerate(rank_true))
    spearman = 1 - 6 * d2 / (15 * (15**2 - 1))
    assert spearman > 0.9


def test_item_choice_aims_for_the_target_band() -> None:
    items = [elo.Candidate(f"i{d}", f"f{d}", float(d)) for d in range(1100, 1900, 50)]
    pick = elo.choose_item(1500, items)
    assert pick is not None
    assert elo.in_target_band(1500, pick.difficulty)


def test_item_choice_avoids_recent_families_while_it_can() -> None:
    items = [elo.Candidate("a", "fam1", 1300.0), elo.Candidate("b", "fam2", 1100.0)]
    assert elo.choose_item(1500, items, recent_families=["fam1"]) == items[1]
    only = [items[0]]
    assert elo.choose_item(1500, only, recent_families=["fam1"]) == items[0]
    assert elo.choose_item(1500, []) is None


def test_item_choice_prefers_items_that_test_unprobed_misconceptions() -> None:
    plain = elo.Candidate("a", "fam1", 1300.0)
    probing = elo.Candidate("b", "fam2", 1200.0, reveals=("FRAC_ADD_NUM_DEN",))
    assert elo.choose_item(1500, [plain, probing]) == plain
    assert elo.choose_item(1500, [plain, probing], unprobed={"FRAC_ADD_NUM_DEN"}) == probing


# FSRS


@pytest.mark.parametrize(
    ("correct", "confidence", "hints", "aided", "time_ms", "extra_time", "expected"),
    [
        (False, 4, 0, False, 10_000, 1.0, Rating.Again),
        (True, 1, 0, False, 10_000, 1.0, Rating.Again),  # right, but guessed
        (True, 3, 1, False, 10_000, 1.0, Rating.Hard),  # a hint
        (True, 3, 0, True, 10_000, 1.0, Rating.Hard),  # a scene watched first
        (True, 2, 0, False, 10_000, 1.0, Rating.Hard),  # unsure
        (True, 3, 0, False, 160_000, 1.0, Rating.Hard),  # slow for one mark
        (True, 3, 0, False, 160_000, 1.25, Rating.Good),  # not slow with 25% extra time
        (True, 4, 0, False, 20_000, 1.0, Rating.Easy),  # quick and sure
        (True, 4, 0, False, 60_000, 1.0, Rating.Good),
        (True, None, 0, False, 30_000, 1.0, Rating.Good),
    ],
)
def test_rating_from_correctness_confidence_help_and_time(
    correct: bool,
    confidence: int | None,
    hints: int,
    aided: bool,
    time_ms: int,
    extra_time: float,
    expected: Rating,
) -> None:
    grade = review.rating(
        correct=correct,
        confidence=confidence,
        hints=hints,
        aided=aided,
        time_ms=time_ms,
        extra_time=extra_time,
    )
    assert grade == expected


def test_a_new_card_is_not_due_at_once() -> None:
    card = review.start_card(Rating.Good, NOW)
    assert not review.is_due(card, NOW + timedelta(hours=1))
    assert card.due > NOW + timedelta(days=1)  # days, not minutes


def test_review_scheduling_spaces_out_and_shortens_after_a_lapse() -> None:
    good = review.start_card(Rating.Good, NOW)
    later = review.review(good, Rating.Good, good.due)
    assert later.due - good.due > good.due - NOW  # intervals grow
    lapsed = review.review(later, Rating.Again, later.due)
    assert lapsed.due - later.due < later.due - good.due
    assert review.retrievability(good, NOW + timedelta(days=1)) > review.retrievability(
        good, NOW + timedelta(days=60)
    )


def test_intervals_never_exceed_the_maximum() -> None:
    card = review.start_card(Rating.Easy, NOW)
    for _ in range(12):
        previous = card.due
        card = review.review(card, Rating.Easy, card.due)
        assert card.due - previous <= timedelta(days=review.MAX_INTERVAL_DAYS)


def test_review_times_must_carry_a_timezone() -> None:
    london = NOW.astimezone(ZoneInfo("Europe/London"))
    card = review.start_card(Rating.Good, london)
    assert card.due.tzinfo is UTC
    assert review.is_due(card, london + timedelta(days=30))
    with pytest.raises(ValueError, match="timezone"):
        review.is_due(card, datetime(2026, 9, 7, 16, 0))


def test_review_scheduling_is_reproducible() -> None:
    assert review.start_card(Rating.Good, NOW).due == review.start_card(Rating.Good, NOW).due


# Planner


def test_the_next_node_has_secured_prerequisites_and_the_lowest_mastery() -> None:
    nodes = [
        NodeInfo("N1", "NUMBER"),
        NodeInfo("N2", "NUMBER", (("N1", 0.5),)),
        NodeInfo("N4", "NUMBER", (("N2", 0.6),)),
    ]
    assert choose_node(nodes, {}) == "N1"
    model = {"N1": secure("N1")}
    assert choose_node(nodes, model) == "N2"
    model["N2"] = secure("N2")
    assert choose_node(nodes, model) == "N4"
    model["N4"] = secure("N4")
    assert choose_node(nodes, model) is None


def test_a_prerequisite_due_for_review_does_not_lock_its_dependants() -> None:
    nodes = [NodeInfo("N1", "NUMBER"), NodeInfo("N2", "NUMBER", (("N1", 0.5),))]
    model = {"N1": replace(secure("N1"), status="NEEDS_REVIEW")}
    assert choose_node(nodes, model) == "N2"


def test_nodes_without_items_are_skipped_and_do_not_block() -> None:
    nodes = [
        NodeInfo("A1", "ALGEBRA", practisable=False),
        NodeInfo("A17", "ALGEBRA", (("A1", 0.8),)),
    ]
    assert choose_node(nodes, {}) == "A17"


def test_a_started_node_is_finished_before_a_new_one_opens() -> None:
    nodes = [NodeInfo("N1", "NUMBER"), NodeInfo("G1", "GEOMETRY"), NodeInfo("S2", "STATISTICS")]
    assert choose_node(nodes, {"G1": learning("G1", 0.6)}) == "G1"
    model = {"G1": learning("G1", 0.6), "S2": learning("S2", 0.9)}
    assert choose_node(nodes, model) == "S2"  # the nearest to SECURE


def test_mark_density_and_target_grade_weight_a_new_node() -> None:
    nodes = [NodeInfo("A1", "ALGEBRA", weight=1.0), NodeInfo("G1", "GEOMETRY", weight=3.0)]
    assert choose_node(nodes, {}) == "G1"
    assert choose_node(nodes, {"G1": secure("G1")}) == "A1"
    primed = {"G1": NodeMastery(node="G1", p_mastery=0.65)}  # unseen, raised by propagation
    assert choose_node(nodes, primed, target_grade=4) == "G1"
    assert choose_node(nodes, primed, target_grade=5) == "A1"


def test_ties_go_in_natural_order() -> None:
    nodes = [NodeInfo("N10", "NUMBER"), NodeInfo("N2", "NUMBER"), NodeInfo("N1", "NUMBER")]
    assert choose_node(nodes, {}) == "N1"
    assert choose_node(nodes, {"N1": secure("N1")}) == "N2"


def real_graph() -> tuple[Curriculum, set[str], list[NodeInfo]]:
    """The real prerequisite graph, with maths-core's real templates deciding which nodes have
    items (a test-only look across the service boundary)."""
    from eddy_maths_core.items import ALL

    curriculum = load(CURRICULUM)
    with_items = {t.node for t in ALL}
    closure = curriculum.mvp_nodes | curriculum.ancestors(curriculum.mvp_nodes)
    strands = {n.code: n.strand for n in curriculum.nodes}
    nodes = [
        NodeInfo(
            code,
            strands[code],
            tuple((p, 1.0) for p in curriculum.prerequisites_of(code)),
            practisable=code in with_items,
        )
        for code in sorted(closure)
    ]
    return curriculum, with_items, nodes


def test_a_perfect_student_can_reach_every_mvp_node_on_the_real_curriculum() -> None:
    """Nodes without items must not lock the MVP behind them, nor let a student skip the
    practisable nodes behind them."""
    curriculum, with_items, nodes = real_graph()
    model: dict[str, NodeMastery] = {}
    order: list[str] = []
    while (code := choose_node(nodes, model)) is not None:
        assert code in with_items
        assert curriculum.ancestors({code}) & with_items <= set(order), code
        order.append(code)
        model[code] = secure(code)
    assert curriculum.mvp_nodes <= set(order)


def test_the_gate_looks_through_nodes_without_items() -> None:
    curriculum, with_items, nodes = real_graph()
    by_code = {info.code: info for info in nodes}
    p7 = by_code["P7"]
    behind = curriculum.ancestors({"P7"}) & with_items
    assert all(code not in with_items for code, _ in p7.prerequisites)  # P3 and N5
    assert behind  # N1, N2 and N10, through them
    assert not ready(p7, {}, by_code)
    assert ready(p7, {code: secure(code) for code in behind}, by_code)


def test_coverage_on_the_real_curriculum_asks_only_for_what_items_can_reveal() -> None:
    from eddy_maths_core.items import ALL

    curriculum = load(CURRICULUM)
    for node in {t.node for t in ALL}:
        codes = probe_codes(
            [m.code for m in curriculum.misconceptions if m.node == node],
            [[*t.misconceptions, *t.structures] for t in ALL if t.node == node],
        )
        for code in codes:
            assert any(code in (*t.misconceptions, *t.structures) for t in ALL if t.node == node)
    g3 = [m.code for m in curriculum.misconceptions if m.node == "G3"]
    g3_items = [[*t.misconceptions, *t.structures] for t in ALL if t.node == "G3"]
    assert "ANGLES_ALTERNATE_CORRESPONDING_NAMES" in g3  # classifier only
    assert "ANGLES_ALTERNATE_CORRESPONDING_NAMES" not in probe_codes(g3, g3_items)


def test_interleaving_starts_at_three_secured_nodes() -> None:
    model = {code: secure(code) for code in ("N1", "N2")}
    assert not interleaving_on(model)
    model["G1"] = NodeMastery(node="G1", p_mastery=0.97, status="NEEDS_REVIEW", evidence_count=4)
    assert interleaving_on(model)


def test_interleaved_reviews_alternate_strands() -> None:
    due = [
        ("N1", "NUMBER", NOW),
        ("N2", "NUMBER", NOW + timedelta(minutes=1)),
        ("G3", "GEOMETRY", NOW + timedelta(minutes=2)),
        ("N9", "NUMBER", NOW + timedelta(minutes=3)),
    ]
    assert review_order(due, interleave=False) == ["N1", "N2", "G3", "N9"]
    assert review_order(due, interleave=True) == ["N1", "G3", "N2", "N9"]


def test_todays_plan() -> None:
    nodes = [
        NodeInfo("N1", "NUMBER"),
        NodeInfo("G1", "GEOMETRY"),
        NodeInfo("S2", "STATISTICS"),
        NodeInfo("R1", "RATIO"),
        NodeInfo("N2", "NUMBER", (("N1", 0.5),)),
    ]
    model = {code: secure(code) for code in ("N1", "G1", "S2")}
    model["R1"] = NodeMastery(node="R1", p_mastery=0.7, status="NEEDS_REVIEW", evidence_count=6)
    cards = {
        "N1": Card(due=NOW - timedelta(days=2)),
        "G1": Card(due=NOW - timedelta(days=1)),
        "S2": review.start_card(Rating.Good, NOW),  # not due yet
    }
    remediated = apply(
        apply(None, "rule_match", code="X", node="N2", at=NOW, session="s"),
        "remediated",
        code="X",
        node="N2",
        at=NOW,
        session="s",
    )
    waiting = apply(None, "rule_match", code="Y", node="N2", at=NOW, session="s", confident=True)
    plan = plan_session(nodes, model, cards, [remediated, waiting], NOW)
    assert plan.node == "N2"
    assert plan.reviews == ("N1", "G1", "R1")  # R1 is a repair: it slipped to NEEDS_REVIEW
    assert plan.interleaved
    assert plan.recheck == "X"
    assert plan.remediation == "Y"
