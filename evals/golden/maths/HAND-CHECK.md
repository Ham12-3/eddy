# Golden set hand check

`items.jsonl` holds 300 distinct items made by `python -m eddy_maths_core.golden write`, round-robin over every template from seed 1000. `pnpm evals` checks all of them on every run (see `eddy_maths_core/golden.py`).

This file records a manual check of a sample: every tenth item (30 of 300), worked out without maths-core. The answers and every distractor were checked against the misconception each claims to come from.

Checked by Claude (the AI assistant building Eddy) on 5 November 2026, not by a person. A teacher's check of a fresh sample is still to do before the pilot.

**A lesson from the first check.** The first version of this sample, before the M3 review, passed a wrong rule: "one third is 0.3" was coded as n/10, so two thirds became 0.2, and the hand check accepted "0.2 (n/10)" without asking whether n/10 was the misconception at all. The rule is fixed (two thirds now reads as 0.6), and every rule now has a hand-worked example in `services/maths-core/tests/test_rule_examples.py`, written from the misconception's description rather than from the rule's code.

| # | Template, seed | Question (short) | Answer | Distractors | Verdict |
|---|---|---|---|---|---|
| 0 | a10-gradient-from-graph, 1000 | Squares 2 across and 5 up; the line rises 3 squares over 3 (diagram) | 15/6 = 5/2 | 1 (counts squares) | Correct |
| 10 | a9-line-through-point, 1000 | Gradient -1 through (0, 8) | y = -x + 8 | none | Correct |
| 20 | g17-circumference-3sf, 1000 | Radius 21, 3 sf | 132 cm (131.946...) | none | Correct |
| 30 | g3-vertically-opposite, 1000 | Opposite 44° | 44° | 136 (supplementary) | Correct |
| 40 | n10-fraction-to-percentage, 1000 | 14/25 | 56% | 1425 (digits joined) | Correct |
| 50 | n2-fraction-add-unlike, 1000 | 1/7 + 1/6 | 13/42 | 2/13 (tops and bottoms added) | Correct |
| 60 | n9-standard-to-ordinary, 1000 | 7.4 × 10⁻⁴ | 0.00074 | 74 000 (wrong direction), 7.4⁻⁴ = 625/1874161 (power on 7.4) | Correct |
| 70 | r5-ratio-from-one-share, 1000 | 7 : 6, Asha gets 63 | 54 | 378/13 (63 treated as the total) | Correct |
| 80 | r9-percentage-increase, 1000 | Decrease £100 by 5% | £95 | 5 (the change only) | Correct |
| 90 | a17-brackets, 1001 | 3(x + 2) = 9 | 1 | 7/3 (3x + 2 = 9) | Correct |
| 100 | g16-area-units, 1002 | 8 m² in cm² | 80 000 | 800 (factor 100) | Correct |
| 110 | g20-hypotenuse-decimal, 1001 | Sides 5 and 4, 1 dp | 6.4 cm (√41) | 9.0 (sides added), 3.0 (√(25 - 16)) | Correct |
| 120 | g7-rotation, 1001 | (0, -4), 90° clockwise about (0, 2) | (-6, 2) | (-4, 0) (about the origin), (6, 2) (anticlockwise) | Correct |
| 130 | n11-part-as-fraction-of-part, 1001 | Cats to dogs 4 : 9 | 4/9 | none | Correct |
| 140 | n2-multiply-decimals, 1001 | 0.5 × 0.7 | 0.35 | 3.5 (one decimal place) | Correct |
| 150 | p7-two-dice-sum, 1001 | Total of 7 | 6/36 = 1/6 | 1/7 (3 of 21 unordered) | Correct |
| 160 | r6-fraction-relationship, 1001 | Apples to pears 7 : 9; pears as a fraction of apples | 9/7 | 7/9 (wrong way round) | Correct |
| 170 | s4-grouped-mean, 1001 | 0 to 40 in tens, frequencies 10, 6, 9, 11 | 750 / 36 = 20.8 | 10.0 (class width), 187.5 (divides by 4 classes) | Correct |
| 180 | a17-one-step-multiply, 1002 | 2x = 12 | 6 | 10 (2 subtracted) | Correct |
| 190 | g16-trapezium-area, 1002 | Sides 5 and 11, height 2 | 16 cm² | 32 (no half) | Correct |
| 200 | g3-angles-on-a-line, 1002 | 98° on a line | 82° | 262 (uses 360°) | Correct |
| 210 | n1-order-negatives, 1002 | -5 or -6 | -6 | -5 (by digits) | Correct |
| 220 | n12-percentage-of-money, 1002 | 8% of £72.40 | £5.79 (5.792) | 9.05 (divides by 8) | Correct |
| 230 | n3-order-of-operations, 1002 | 5 + 6 × 5 | 35 | 55 (left to right) | Correct |
| 240 | r4-ratio-with-units, 1002 | 80 cm : 2 m | 2 : 5 | none | Correct |
| 250 | r7-direct-proportion, 1002 | 8 notebooks cost £20; 10 notebooks | £25 | none | Correct |
| 260 | a10-gradient-from-graph, 1003 | Squares 1 across and 10 up; the line rises 7 over 4 (diagram) | 70/4 = 35/2 | 7/4 (counts squares) | Correct |
| 270 | a9-line-through-point, 1003 | Gradient -3 through (-2, 8) | y = -3x + 2 | none | Correct |
| 280 | g17-circumference-3sf, 1003 | Radius 52, 3 sf | 327 cm (326.73...) | none | Correct |
| 290 | g3-vertically-opposite, 1003 | Opposite 66° | 66° | 114 (supplementary) | Correct |

30 of 30 correct. Items 0 and 260 draw their line from diagram parameters, which the stem does not repeat.
