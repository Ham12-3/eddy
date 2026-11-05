"""BKT, node mastery and the misconception state machine (SPEC.md 7.1, ADR-0026)."""

from datetime import UTC, datetime, timedelta

import pytest

from eddy_api.learner import bkt, mastery, misconceptions
from eddy_api.learner.mastery import Attempt, NodeMastery

DAY_ONE = datetime(2026, 9, 7, 16, 0, tzinfo=UTC)


def attempt(
    correct: bool,
    day: int = 0,
    *,
    aided: bool = False,
    reveals: tuple[str, ...] = (),
    confidence: int | None = None,
    explained: bool = False,
    options: int | None = None,
    at: datetime | None = None,
    session: str | None = None,
) -> Attempt:
    return Attempt(
        node="N2",
        correct=correct,
        at=at or DAY_ONE + timedelta(days=day),
        session=session or f"s{day}",
        aided=aided,
        confidence=confidence,
        explained=explained,
        options=options,
        could_reveal=reveals,
    )


def play(
    state: NodeMastery,
    *attempts: Attempt,
    open_misconception: bool = False,
    to_probe: tuple[str, ...] = (),
) -> NodeMastery:
    for a in attempts:
        state = mastery.record(state, a, to_probe=to_probe, open_misconception=open_misconception)
    return state


def secured() -> NodeMastery:
    state = play(NodeMastery(node="N2"), attempt(True), attempt(True), attempt(True, 1))
    assert state.status == "SECURE"
    return state


# BKT


def test_bkt_moves_up_when_right_and_down_when_wrong() -> None:
    p = bkt.DEFAULT.p_init
    assert bkt.update(p, True) > p
    assert bkt.update(0.9, False) < 0.9


def test_bkt_posterior_matches_hand_working() -> None:
    # 0.2 x 0.9 / (0.2 x 0.9 + 0.8 x 0.2) = 0.18 / 0.34
    assert bkt.posterior(0.2, True, 0.2, 0.1) == pytest.approx(0.18 / 0.34)
    # then learning: 0.5294 + 0.4706 x 0.15
    assert bkt.update(0.2, True) == pytest.approx(0.18 / 0.34 + (1 - 0.18 / 0.34) * 0.15)


def test_aided_attempts_move_half_as_far() -> None:
    full = bkt.update(0.4, True) - 0.4
    half = bkt.update(0.4, True, weight=mastery.AIDED_WEIGHT) - 0.4
    assert half == pytest.approx(full / 2)


def test_guessing_follows_the_number_of_options() -> None:
    assert bkt.guess_rate(bkt.DEFAULT, None) == pytest.approx(0.2)
    assert bkt.guess_rate(bkt.DEFAULT, 4) == pytest.approx(0.25)
    assert bkt.guess_rate(bkt.DEFAULT, 2) == pytest.approx(0.5)
    assert bkt.update(0.3, True, options=2) < bkt.update(0.3, True, options=4)
    assert bkt.update(0.3, True, options=4) < bkt.update(0.3, True)
    with pytest.raises(ValueError, match="two options"):
        bkt.update(0.3, True, options=1)


def test_bkt_never_reaches_certainty() -> None:
    p = 0.5
    for _ in range(200):
        p = bkt.update(p, True)
    assert p == pytest.approx(bkt.P_MAX)
    with pytest.raises(ValueError, match="weight"):
        bkt.update(0.5, True, weight=0)


def test_two_wrong_answers_pull_a_practised_estimate_below_the_review_bar() -> None:
    p = bkt.update(bkt.update(bkt.P_MAX, False), False)
    assert p < mastery.REVIEW_P


# Node mastery


def test_secure_needs_three_unaided_correct_over_two_days() -> None:
    state = play(NodeMastery(node="N2"), attempt(True), attempt(True), attempt(True))
    assert state.p_mastery >= mastery.SECURE_P
    assert state.status == "LEARNING"  # one day only
    state = play(state, attempt(True, day=1))
    assert state.status == "SECURE"


def test_spacing_uses_uk_dates_and_needs_hours_between() -> None:
    late = datetime(2026, 9, 7, 22, 50, tzinfo=UTC)  # 23:50 in London
    state = play(
        NodeMastery(node="N2"),
        attempt(True, at=late, session="a"),
        attempt(True, at=late + timedelta(minutes=5), session="a"),
        attempt(True, at=late + timedelta(minutes=20), session="b"),  # 00:10, the next UK day
    )
    assert state.unaided_spread == (3, 2, 2)
    assert state.status == "LEARNING"  # 20 minutes is not spacing
    state = play(state, attempt(True, at=late + timedelta(hours=17), session="c"))
    assert state.status == "SECURE"
    after_midnight_utc = datetime(2026, 9, 7, 23, 30, tzinfo=UTC)  # 00:30 on 8 September in UK
    same_uk_day = play(
        NodeMastery(node="N2"),
        attempt(True, at=after_midnight_utc, session="x"),
        attempt(True, at=after_midnight_utc + timedelta(hours=1), session="y"),
    )
    assert same_uk_day.unaided_spread[2] == 1


def test_old_lucky_answers_cannot_supply_the_spacing() -> None:
    state = play(NodeMastery(node="N2"), attempt(True, 0), attempt(False, 1), attempt(False, 2))
    state = play(state, attempt(True, 5), attempt(True, 5), attempt(True, 5))
    assert state.p_mastery >= mastery.SECURE_P
    assert state.unaided_spread == (3, 1, 1)  # the last three, all on day 5
    assert state.status == "LEARNING"


def test_aided_attempts_never_count_towards_secure() -> None:
    state = NodeMastery(node="N2")
    for day in range(4):
        state = play(state, attempt(True, day, aided=True), attempt(True, day, aided=True))
    assert state.unaided_spread == (0, 0, 0)
    assert state.status == "LEARNING"


def test_a_correct_guess_does_not_count_towards_secure() -> None:
    state = NodeMastery(node="N2")
    for day in range(3):
        state = play(state, attempt(True, day, confidence=1), attempt(True, day, confidence=1))
    assert state.p_mastery >= mastery.SECURE_P
    assert state.unaided_spread == (0, 0, 0)
    assert state.status == "LEARNING"


def test_an_open_misconception_blocks_secure() -> None:
    attempts = [attempt(True), attempt(True), attempt(True, 1)]
    blocked = play(NodeMastery(node="N2"), *attempts, open_misconception=True)
    assert blocked.status == "LEARNING"
    assert mastery.refresh(blocked, to_probe=(), open_misconception=False).status == "SECURE"


def test_secure_needs_each_misconception_probed_twice() -> None:
    codes = ("FRAC_ADD_NUM_DEN",)
    state = play(NodeMastery(node="N2"), attempt(True), attempt(True), attempt(True, 1))
    assert state.status == "SECURE"  # nothing to probe
    state = play(
        NodeMastery(node="N2"), attempt(True), attempt(True), attempt(True, 1), to_probe=codes
    )
    assert state.status == "LEARNING"  # never tested on an item that could reveal it
    state = play(state, attempt(True, 1, reveals=codes), to_probe=codes)
    assert state.status == "LEARNING"
    state = play(state, attempt(True, 2, reveals=codes), to_probe=codes)
    assert state.status == "SECURE"


def test_only_misconceptions_an_item_can_reveal_are_probed() -> None:
    node_codes = ["A", "B", "C"]
    assert mastery.probe_codes(node_codes, [["A", "X"], ["B"]]) == ("A", "B")


def test_a_misconception_showing_restarts_the_run() -> None:
    state = play(
        NodeMastery(node="N2"),
        attempt(True, reveals=("X",)),
        attempt(True, reveals=("X",)),
        to_probe=("X",),
    )
    state = mastery.misconception_seen(state, "X")
    assert state.unaided_correct == ()
    assert state.probe_count("X") == 0


def test_secure_survives_one_slip_but_not_two_in_a_row() -> None:
    state = play(secured(), attempt(False, 2))
    assert state.status == "SECURE"  # still above REVIEW_P
    state = play(state, attempt(False, 2))
    assert state.status == "NEEDS_REVIEW"
    state = play(state, attempt(True, 3))
    assert state.status == "NEEDS_REVIEW"  # mastery is not back above 0.95 yet
    state = play(state, attempt(True, 3))
    assert state.status == "SECURE"


def test_a_well_practised_node_lapses_after_two_wrong_answers() -> None:
    state = NodeMastery(node="N2")
    for day in range(5):
        state = play(state, attempt(True, day), attempt(True, day))
    assert state.status == "SECURE"
    assert state.p_mastery == pytest.approx(bkt.P_MAX)
    state = play(state, attempt(False, 6), attempt(False, 6))
    assert state.status == "NEEDS_REVIEW"
    assert state.p_mastery < mastery.REVIEW_P


def practised_on_two_option_items() -> NodeMastery:
    state = NodeMastery(node="N2")
    for day in range(5):
        state = play(state, attempt(True, day, options=2), attempt(True, day, options=2))
    assert state.status == "SECURE"
    return state


def test_on_two_option_items_the_lapse_rule_does_what_bkt_cannot() -> None:
    state = play(
        practised_on_two_option_items(), attempt(False, 6, options=2), attempt(False, 6, options=2)
    )
    assert state.p_mastery >= mastery.REVIEW_P  # BKT alone would keep it SECURE
    assert state.status == "NEEDS_REVIEW"


def test_a_lapse_needs_two_unexplained_wrong_answers_in_one_session() -> None:
    practised = practised_on_two_option_items()
    across = play(practised, attempt(False, 6, options=2), attempt(False, 7, options=2))
    assert across.status == "SECURE"
    explained = play(
        practised,
        attempt(False, 6, options=2, explained=True),
        attempt(False, 6, options=2),
    )
    assert explained.status == "SECURE"


def test_a_guess_never_secures_a_node() -> None:
    state = play(
        NodeMastery(node="N2"),
        attempt(True, 0),
        attempt(True, 1),
        attempt(False, 1),
        attempt(True, 2),
    )
    assert state.unaided_spread == (3, 3, 3)
    assert state.status == "LEARNING"
    guessed = play(state, attempt(True, 2, confidence=1))
    assert mastery.meets_secure_bar(guessed, False, ())  # the bar is met, but on a guess
    assert guessed.status == "LEARNING"
    assert play(guessed, attempt(True, 3)).status == "SECURE"


def test_a_due_review_stays_owed_until_a_counted_correct_answer() -> None:
    state = mastery.review_due(secured())
    assert state.status == "NEEDS_REVIEW"
    assert mastery.refresh(state, to_probe=(), open_misconception=False).status == ("NEEDS_REVIEW")
    for unhelpful in (
        attempt(False, 3),
        attempt(True, 3, aided=True),
        attempt(True, 3, confidence=1),
    ):
        state = play(state, unhelpful)
        assert state.status == "NEEDS_REVIEW"
    state = play(state, attempt(True, 4), attempt(True, 4))
    assert state.status == "SECURE"
    learning = NodeMastery(node="N2")
    assert mastery.review_due(learning) is learning


def test_bad_attempts_are_refused() -> None:
    with pytest.raises(ValueError, match="recorded against"):
        play(NodeMastery(node="A17"), attempt(True))
    with pytest.raises(ValueError, match="timezone"):
        play(NodeMastery(node="N2"), attempt(True, at=datetime(2026, 9, 7, 16, 0)))
    with pytest.raises(ValueError, match="confidence"):
        play(NodeMastery(node="N2"), attempt(True, confidence=5))


# The two-failure prerequisite diagnostic


def test_two_failures_in_a_row_trigger_the_diagnostic() -> None:
    state = play(NodeMastery(node="N2"), attempt(False))
    assert not mastery.needs_prerequisite_diagnostic(state)
    state = play(state, attempt(False))
    assert mastery.needs_prerequisite_diagnostic(state)
    assert not mastery.needs_prerequisite_diagnostic(mastery.start_diagnostic(state))


def test_a_correct_answer_between_failures_resets_the_count() -> None:
    state = play(NodeMastery(node="N2"), attempt(False), attempt(True), attempt(False))
    assert not mastery.needs_prerequisite_diagnostic(state)


def test_the_count_starts_again_each_session() -> None:
    state = play(NodeMastery(node="N2"), attempt(False, 0), attempt(False, 1))
    assert not mastery.needs_prerequisite_diagnostic(state)


def test_failures_a_misconception_explains_do_not_count() -> None:
    state = play(NodeMastery(node="N2"), attempt(False, explained=True), attempt(False))
    assert not mastery.needs_prerequisite_diagnostic(state)
    state = play(state, attempt(False, explained=True), attempt(False))
    assert mastery.needs_prerequisite_diagnostic(state)


def test_the_diagnostic_runs_at_most_once_per_node_per_session() -> None:
    state = mastery.start_diagnostic(play(NodeMastery(node="N2"), attempt(False), attempt(False)))
    state = play(state, attempt(False), attempt(False))
    assert not mastery.needs_prerequisite_diagnostic(state)
    state = play(state, attempt(False, 1), attempt(False, 1))
    assert mastery.needs_prerequisite_diagnostic(state)


def test_the_diagnostic_probes_weakest_prerequisites_first() -> None:
    model = {
        "N3": NodeMastery(node="N3", p_mastery=0.6, status="LEARNING", evidence_count=2),
        "N4": NodeMastery(node="N4", p_mastery=0.97, status="SECURE", evidence_count=4),
        "N5": NodeMastery(node="N5", p_mastery=0.9, status="NEEDS_REVIEW", evidence_count=4),
        "N6": NodeMastery(node="N6", p_mastery=0.3, status="LEARNING", evidence_count=2),
    }
    order = mastery.prerequisite_diagnostic(
        model,
        [("N3", 0.5), ("N4", 0.9), ("N5", 0.5), ("N6", 0.8), ("N1", 0.4), ("A1", 0.9)],
        retrievability={"N4": 0.7, "N5": 0.95},
        practisable={"N1", "N3", "N4", "N5", "N6"},
    )
    # Not yet secured, lowest mastery first (N1 is unseen at the 0.2 prior); then the secured
    # ones, least likely to be remembered first. A1 has no items, so it cannot be probed.
    assert order == ["N1", "N6", "N3", "N4", "N5"]


def test_propagation_raises_prerequisites_but_never_to_secure() -> None:
    model = {"N1": NodeMastery(node="N1", p_mastery=0.5, status="LEARNING", evidence_count=1)}
    boosted = mastery.boost_prerequisites(model, [("N1", 0.5), ("N2", 0.9)])
    assert boosted["N1"].p_mastery == pytest.approx(0.5 + 0.25 * 0.5)
    assert boosted["N2"].p_mastery > bkt.DEFAULT.p_init
    for _ in range(20):
        boosted = mastery.boost_prerequisites(boosted, [("N1", 1.0)])
    assert boosted["N1"].p_mastery <= mastery.PROPAGATION_CEILING
    assert boosted["N1"].status == "LEARNING"
    assert boosted["N2"].status == "UNSEEN"


def test_propagation_leaves_secured_prerequisites_alone() -> None:
    secure = NodeMastery(node="N1", p_mastery=0.97, status="SECURE", evidence_count=4)
    review = NodeMastery(node="N3", p_mastery=0.7, status="NEEDS_REVIEW", evidence_count=4)
    boosted = mastery.boost_prerequisites({"N1": secure, "N3": review}, [("N1", 1), ("N3", 1)])
    assert boosted["N1"] is secure
    assert boosted["N3"] is review


# Misconceptions


def step(
    track: misconceptions.Track | None,
    event: misconceptions.Event,
    session: str = "s1",
    **kwargs: object,
) -> misconceptions.Track:
    return misconceptions.apply(
        track,
        event,
        code="FRAC_ADD_NUM_DEN",
        node="N2",
        at=DAY_ONE,
        session=session,
        **kwargs,  # type: ignore[arg-type]
    )


def close(track: misconceptions.Track) -> misconceptions.Track:
    """Pass every re-check needed, the last in a later session than the scene."""
    for _ in range(misconceptions.rechecks_needed(track) - 1):
        track = step(track, "recheck_passed")
        assert track.status == "REMEDIATED"
    return step(track, "recheck_passed", session="s2")


def test_the_spec_path_through_the_states() -> None:
    track = step(None, "rule_match", attempt="a1")
    assert track.status == "SUSPECTED"
    track = step(track, "rule_match", attempt="a2")
    assert track.status == "CONFIRMED"
    track = step(track, "remediated")
    assert track.status == "REMEDIATED"
    assert track.evidence == ("a1", "a2")
    track = close(track)
    assert track.status == "RECHECKED_OK"
    track = step(track, "rule_match")
    assert track.status == "RECURRED"
    track = step(track, "remediated")
    assert misconceptions.scene_variant(track) == 2  # a different scene each time


def test_closing_needs_a_recheck_in_a_later_session() -> None:
    track = step(step(None, "rule_match"), "remediated")
    for _ in range(misconceptions.MAX_RECHECKS):
        track = step(track, "recheck_passed")  # all in the scene's own session
    assert track.status == "REMEDIATED"
    assert step(track, "recheck_passed", session="s2").status == "RECHECKED_OK"


def test_rechecks_needed_grow_with_each_match() -> None:
    track = step(None, "rule_match")
    assert misconceptions.rechecks_needed(track) == 3
    track = step(track, "rule_match")
    assert misconceptions.rechecks_needed(track) == 5
    for _ in range(5):
        track = step(track, "rule_match")
    assert misconceptions.rechecks_needed(track) == misconceptions.MAX_RECHECKS


def test_a_match_after_remediation_is_a_recurrence() -> None:
    track = step(step(None, "rule_match"), "remediated")
    assert step(track, "rule_match").status == "RECURRED"


def test_a_diagnostic_match_suspects_first_and_confirms_second() -> None:
    track = step(None, "diagnostic_match")
    assert track.status == "SUSPECTED"
    assert step(track, "diagnostic_match").status == "CONFIRMED"


def test_one_unsure_choice_is_only_a_weak_suspicion() -> None:
    weak = step(None, "choice_match")
    assert weak.status == "SUSPECTED"
    assert weak.weak
    assert not misconceptions.is_open(weak)
    assert misconceptions.remediation_queue([weak]) == []
    assert not misconceptions.restarts_run("choice_match", weak)
    again = step(weak, "choice_match")
    assert again.status == "CONFIRMED"
    assert misconceptions.is_open(again)
    assert misconceptions.restarts_run("choice_match", again)
    assert misconceptions.rechecks_needed(again) == 3


def test_after_the_first_sighting_a_choice_counts_like_a_rule_match() -> None:
    track = step(step(None, "rule_match"), "remediated")
    assert step(track, "choice_match").status == "RECURRED"


def test_the_event_for_a_matched_answer() -> None:
    assert misconceptions.match_event(options=None, confidence=None) == "rule_match"
    assert misconceptions.match_event(options=2, confidence=None) == "choice_match"
    assert misconceptions.match_event(options=2, confidence=2) == "choice_match"
    assert misconceptions.match_event(options=2, confidence=3) == "rule_match"
    assert misconceptions.match_event(options=4, confidence=4, diagnostic=True) == (
        "diagnostic_match"
    )
    assert misconceptions.match_event(options=4, confidence=1, diagnostic=True) == "choice_match"


def test_the_classifier_can_only_suspect() -> None:
    assert step(None, "classifier").status == "SUSPECTED"
    suspected = step(None, "classifier")
    assert step(suspected, "classifier").status == "SUSPECTED"
    remediated = step(step(None, "rule_match"), "remediated")
    assert step(remediated, "classifier").status == "REMEDIATED"
    ok = close(remediated)
    assert ok.status == "RECHECKED_OK"
    assert step(ok, "classifier").status == "RECHECKED_OK"


def test_confident_mistakes_leave_the_front_of_the_queue_once_closed() -> None:
    track = step(step(None, "rule_match", confident=True), "remediated")
    assert track.confident_wrong
    assert not close(track).confident_wrong


def test_impossible_events_are_refused() -> None:
    with pytest.raises(misconceptions.InvalidTransitionError):
        step(None, "remediated")
    with pytest.raises(misconceptions.InvalidTransitionError):
        step(step(None, "rule_match"), "recheck_passed")
    other = misconceptions.apply(None, "rule_match", code="X", node="N9", at=DAY_ONE, session="s")
    with pytest.raises(ValueError, match="applied to"):
        step(other, "rule_match")


def test_open_states_and_the_remediation_queue() -> None:
    later = DAY_ONE + timedelta(hours=1)

    def match(
        code: str, node: str, at: datetime, *, confident: bool = False
    ) -> misconceptions.Track:
        return misconceptions.apply(
            None, "rule_match", code=code, node=node, at=at, session="s", confident=confident
        )

    sure = match("B", "N2", DAY_ONE, confident=True)
    remediated = misconceptions.apply(
        match("C", "N2", DAY_ONE), "remediated", code="C", node="N2", at=DAY_ONE, session="s"
    )
    recurred = misconceptions.apply(
        remediated, "rule_match", code="C", node="N2", at=later, session="s"
    )
    fresh = match("A", "N9", later)
    queue = misconceptions.remediation_queue([fresh, recurred, sure])
    assert [t.code for t in queue] == ["B", "C", "A"]  # confident first, then RECURRED
    assert misconceptions.node_has_open([fresh, recurred], "N2")
    assert not misconceptions.node_has_open([fresh], "N2")
    assert misconceptions.awaiting_recheck([recurred, sure]) == []
    here = match("D", "N4", DAY_ONE)
    assert [t.code for t in misconceptions.remediation_queue([fresh, here], "N4")] == ["D", "A"]
