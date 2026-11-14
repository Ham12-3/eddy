# Eddy: GCSE Maths Higher tier, development plan

Status: **draft for the product owner**, 13 November 2026. Not approved. Nothing in this file changes SPEC.md, PLAN.md or DECISIONS.md until the product owner approves it; each decision below becomes an ADR when its milestone starts.

Read with: [SPEC.md](../SPEC.md) (what the MVP is), [PLAN.md](../PLAN.md) (how milestones run and what "done" means), [DECISIONS.md](../DECISIONS.md) (ADR-0021 curriculum, ADR-0022 rule language, ADR-0025 item templates, ADR-0026 learner model, ADR-0027 to ADR-0030 scenes, ADR-0031 tutor, ADR-0032 student app) and [docs/brief.md](brief.md) section 1 (tiers and grades) and section 2 (the topic map).

House rules apply throughout: UK English, no en or em dashes, no emoji, and no AQA, Pearson or OCR material of any kind (questions, papers, mark schemes, examiner reports, wording or logos), including in prompts, evals and this plan. Every content description below is our own paraphrase of the DfE GCSE mathematics subject content (Open Government Licence v3.0), as in `curriculum/maths/nodes.yaml`.

---

## 0. Summary

Eddy today is a Foundation tutor for the grade 3/4 boundary. Higher tier awards grades 4 to 9 (with an allowed grade 3 for narrow misses, brief section 1) and roughly triples the content Eddy must teach, verify and animate: 11 Higher-only DfE statements, 25 Foundation statements with a Higher extension, and about 27 Foundation statements that Higher students need but Eddy has no item templates for yet.

Recommendations:

1. **Model each Higher extension as its own node** (for example `N8H1` Surds, extending `N8`), so mastery stays one idea per node and Foundation students never see Higher items. This amends ADR-0021's "one node per DfE statement".
2. **Make the course explicit.** Today the course is whatever nodes maths-core has templates for (`_practisable` in `routes/learning.py`, `diagnostic.py`). Adding any Higher template would put it in front of Foundation students at once. A new `curriculum/maths/courses.yaml` names each tier's nodes, and the API filters by the student's tier.
3. **Ship in two waves behind a flag.** Wave 1 is the grade 4 to 7 content (overlap plus the core Higher techniques); wave 2 is the grade 7 to 9 content (graph transformations, proof, algebraic fractions, calculus-like graph work, vector proof). Higher stays "coming later" in production until wave 1 is evaluated.
4. **Do not start before the Foundation launch is signed off** (PLAN.md M10 launch checklist), and plan to refit the learner model with Foundation pilot data before Higher students arrive.

Rough effort: 10 milestones (H0 to H9), about 19 weeks in sequence or **about 12 weeks** with three parallel tracks, measured on PLAN.md's yardstick (the MVP finished well inside its own estimates, so treat these as planning ceilings and re-estimate after H1).

---

## 1. Where Eddy stands today (read from the code at `1374bee`)

| Area | Today | What it means for Higher |
|---|---|---|
| Curriculum | 97 nodes, one per DfE statement (`curriculum/maths/nodes.yaml`); `tier` is `FOUNDATION` or `HIGHER_ONLY`; Foundation statements with a Higher part carry a `higher:` sentence (25 nodes). 85 misconceptions on 24 nodes; 71 prerequisite edges; 13 topics. | Higher extensions have no node of their own, so their mastery has nowhere to live. |
| Schemas | `nodeCode` is `^[NARGPS][1-9][0-9]?$`; re-check families are `^[NARGPS][1-9][0-9]?\.[a-z0-9-]+$` (`curriculum/schemas/common.schema.json`, `misconceptions.schema.json`). | New node codes need the patterns widened. |
| maths-core | 87 templates on 24 nodes (`eddy_maths_core/items/`); answer kinds `number`, `expression`, `equation`, `coordinate`, `ratio`; forms include `exact`, `standard_form`, `mixed_number`. The MathJSON allow-list has no trig functions, no `Or`/`And`, no vectors; letters may not be exponents; at most 3 letters, 4 radicals, degree 12; equations solved up to degree 4. Verification p95 is about 2 to 4 ms against a 150 ms budget. | Trig, inequalities, multiple solutions, vectors and surd form all need converter, equivalence and format work. |
| Learner model | ADR-0026: BKT per node, SECURE rules, FSRS, planner weighting by `exam_weight_hint` ("Foundation mark density"), with exponent 1.0 for target grade 4 and 0.5 for grade 5 (`learner/planner.py`). Family coverage and a test-out route were left to M7 and are not in `learner/mastery.py`. | Needs tier scope, Higher mark density, target grades 4 to 9, and a way for able students to skip ground they already hold. |
| Diagnostic | Typed answers, up to 20 questions, one per practisable node, deepest nodes first; questions needing a diagram are skipped (`diagnostic.py`, ADR-0032). | Geometry and statistics at Higher are diagram-heavy, so the skip would hide most of it. |
| Profile | `student_profile.tier` is checked against the curriculum's `TIERS` (`FOUNDATION`, `HIGHER_ONLY`); `target_grade` is checked 1 to 9 in the database, but `SetupIn` accepts only `tier: "FOUNDATION"` and `target_grade: 4 or 5` (`routes/me.py`). The set-up form shows Higher disabled with "Coming later" (`SetUpForm.tsx`), and `welcome/actions.ts` sends `tier: "FOUNDATION"`. | A migration and an API change; the web form already has the option. |
| Scenes | 11 primitives; 14 registered scenes (the 13 Tier D defaults plus `bar_model.compare_fractions`, in progress on this branch). Elements: line (with arrow), rect, polygon (open or closed, with rigid turns), circle, arc, text, pen mark. No curve element and no maths for column vectors. | Graph sketching needs curves; trig, circle theorems, vectors, Venn diagrams and histograms need primitives. |
| Tutor | `prompts/tutor.md` 1.6.0; the `maths[]` schema allows a fixed list of MathJSON heads, nested at most four arrays deep (ADR-0031); every number must be traced; about £0.33 a session; p95 11.0 s per student input; 72 pedagogy conversations. | The quadratic formula alone is five arrays deep; rounded trig values cannot be traced as exact claims. |
| Specs | `curriculum/specs.yaml` already records Higher papers and calculator rules per board (OCR Higher papers 4 to 6, paper 5 non-calculator). | No new board data needed. |

---

## 2. Scope: Higher content beyond the MVP

Bands are our own judgement of where each idea typically sits for a student working towards that grade: **4 to 5** (overlap content, on both tiers), **6 to 7** and **8 to 9**. They are internal planning data (used by the planner and to order the work), never shown to a student as a grade or a prediction (SPEC.md section 2.3). Strand weights for Higher, from the brief's section 1: number 15%, algebra 30%, ratio 20%, geometry 20%, probability and statistics 15%; reasoning (AO2) and problem solving (AO3) carry 60% of Higher marks against 50% at Foundation, so multi-step items matter more.

"Node" is the node that will hold it: an existing code, or a new extension code (section 3.1). "Today" says whether maths-core has templates for it.

### 2.1 Number

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Prime factorisation in index form; HCF and LCM from prime factors, including Venn methods | N4 | 4 to 5 | N4 | No templates |
| Index laws with integer powers; powers of 10 | N6, N7 | 4 to 5 | N6, N7 | No templates |
| Fractional and negative indices, including fractional bases | N7 | 6 to 7 (combined cases 8 to 9) | N7H1 | Not modelled |
| Simplifying surds; adding, multiplying and expanding brackets with surds; exact answers | N8 | 6 to 7 | N8H1 | Not modelled |
| Rationalising denominators: a single surd (7), a sum or difference with a surd (8 to 9) | N8 | 7 to 9 | N8H2 | Not modelled |
| Recurring decimals to fractions and back | N10 | 6 to 7 | N10H1 | Not modelled (the converter already reads `0.(3)`) |
| Error intervals from rounding and truncation | N15 | 4 to 5 | N15 | No templates |
| Upper and lower bounds in calculations, and a suitable degree of accuracy for a result | N16 | 7 to 8 | N16H1 | Not modelled |
| Standard form calculation | N9 | 4 to 5 | N9 | Templated |

### 2.2 Algebra

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Expanding and factorising: single and double brackets, x² + bx + c, difference of two squares | A4 | 4 to 5 | A4 | No templates |
| Factorising ax² + bx + c with a not 1 | A4 | 6 to 7 | A4H1 | Not modelled |
| Algebraic fractions: simplify, add, subtract, multiply, divide, and solve equations containing them | A4 | 7 to 9 | A4H2 | Not modelled |
| Index laws in algebra; expanding products of three binomials (to check against the DfE text, as M2 did for N16 and G8) | A4 | 6 to 7 | A4H3 | Not modelled |
| Changing the subject; when the subject appears twice | A5 | 4 to 5; 7 to 8 | A5, A5H1 | No templates |
| Algebraic proof (consecutive integers, odd and even, multiples) | A6 | 7 to 9 | A6H1 | Not modelled |
| Function notation; composite and inverse functions | A7 | 7 to 8 | A7, A7H1 | No templates |
| Perpendicular gradients and equations of perpendicular lines | A9 | 6 to 7 | A9H1 | A9 templated |
| Roots and turning points from graphs; completing the square to find a turning point | A11 | 4 to 5; 7 to 8 | A11, A11H1 | No templates |
| Recognising exponential and trigonometric graphs | A12 | 6 to 8 | A12, A12H1 | No templates |
| Translations and reflections of y = f(x) | A13 | 7 to 9 | A13 | Not modelled |
| Gradient at a point by a tangent; area under a curve by strips; meaning in context | A15 | 8 to 9 | A15 | Not modelled |
| Circle x² + y² = r² and the tangent at a point | A16 | 7 to 9 | A16 | Not modelled |
| Quadratic equations by factorising (a = 1) | A18 | 4 to 5 | A18 | No templates |
| Quadratic formula | A18 | 6 to 7 | A18H1 | Not modelled |
| Solving by completing the square | A18 | 7 to 8 | A18H2 | Not modelled |
| Linear simultaneous equations | A19 | 4 to 5 | A19 | No templates |
| One linear and one quadratic equation | A19 | 7 to 8 | A19H1 | Not modelled |
| Iteration: rearranging, iterating, showing a root lies in an interval by a sign change | A20 | 7 to 8 | A20 | Not modelled |
| Linear inequalities on a number line | A22 | 4 to 5 | A22 | No templates |
| Regions on graphs | A22 | 7 to 8 | A22H2 | Not modelled |
| Quadratic inequalities, with set notation | A22 | 8 to 9 | A22H1 | Not modelled |
| Geometric sequences with a surd ratio | A24 | 8 to 9 | A24H1 | Not modelled |
| nth term of a linear sequence; of a quadratic sequence | A25 | 4 to 5; 7 to 8 | A25, A25H1 | No templates |

### 2.3 Ratio, proportion and rates of change

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Direct and inverse proportion, including graphs | R10 | 4 to 5 | R10 | No templates |
| Proportion equations: y = kx, y = kx², y = k/x, y = k/√x, finding k first | R13 | 6 to 8 | R13, R13H1 | No templates |
| Compound growth and decay with multipliers; reverse compound problems and general iterative processes | R16 | 4 to 5; 6 to 8 | R16, R16H1 | No templates |
| Instantaneous rate of change from a tangent; average rate from a chord | R15 | 8 to 9 | R15 | Not modelled |

### 2.4 Geometry and measures

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Arc length and sector area | G18 | 4 to 5 | G18 | No templates |
| Similar shapes: lengths (4 to 5); areas and volumes (7 to 8) | G19 | 4 to 8 | G19, G19H1 | No templates |
| Trigonometry in right-angled triangles | G20 | 4 to 5 | G20 (new families) | Pythagoras only |
| Pythagoras and trigonometry in 3D | G20 | 7 to 8 | G20H1 | Not modelled |
| Exact trigonometric values | G21 | 4 to 6 | G21 | No templates |
| Sine rule and cosine rule | G22 | 6 to 8 | G22 | Not modelled |
| Area of any triangle from two sides and the included angle | G23 | 6 to 7 | G23 | Not modelled |
| Enlargement by a negative scale factor | G7 | 6 to 7 | G7H1 | G7 templated |
| Combined transformations and invariant points | G8 | 6 to 7 | G8 | Not modelled |
| Circle theorems, using them with reasons, and proving them | G10 | 7 to 9 | G10 | Not modelled |
| Formal geometric proof, including congruence | G6 | 7 to 9 | G6H1 | Not modelled |
| Column vectors: add, subtract, scale | G24, G25 | 4 to 5 | G24, G25 | No templates |
| Vector arguments and proof (collinear points, parallel vectors) | G25 | 8 to 9 | G25H1 | Not modelled |

### 2.5 Probability

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Venn diagrams, two-way tables and set notation (union, intersection, complement) | P6 | 4 to 6 | P6, P6H1 | No templates |
| Conditional probability from two-way tables, Venn diagrams and tree diagrams | P9 | 7 to 8 | P9 | Not modelled |
| Conditional probability leading to an equation (for example sweets taken without replacement giving a quadratic) | P9 | 8 to 9 | P9 (later family) | Not modelled |

### 2.6 Statistics

| Content (our words) | DfE | Band | Node | Today |
|---|---|---|---|---|
| Scatter graphs and correlation | S6 | 4 to 5 | S6 | No templates |
| Quartiles, interquartile range and box plots | S4 | 6 to 7 | S4H1 | S4 templated |
| Cumulative frequency graphs, reading medians and quartiles | S3 | 6 to 7 | S3 | Not modelled |
| Histograms with unequal class widths; frequency density; estimating counts within an interval | S3 | 7 to 8 | S3 | Not modelled |

### 2.7 Totals

| Group | Nodes | Wave |
|---|---|---|
| Foundation statements Higher students need, with no templates today (N4, N6, N7, N8, N15, N16, A2, A4, A5, A7, A11, A12, A18, A19, A22, A25, R10, R13, R16, G18, G19, G20 trig, G21, G24, G25, P6, S6) | 27 | 1 |
| Higher extensions and Higher-only nodes, bands 4 to 7 (N7H1, N8H1, N10H1, A4H1, A4H3, A7H1, A9H1, A11H1, A12H1, A18H1, A25H1, R13H1, R16H1, G7H1, G8, G10, G19H1, G22, G23, P6H1, P9, S3, S4H1) | 23 | 1 |
| Higher extensions and Higher-only nodes, bands 7 to 9 (N8H2, N16H1, A4H2, A5H1, A6H1, A13, A15, A16, A18H2, A19H1, A20, A22H1, A22H2, A24H1, R15, G6H1, G20H1, G25H1) | 18 | 2 |

Wave 1 is a usable Higher course for students aiming at grades 4 to 7. Wave 2 completes the grade 8 to 9 content. Not planned: constructions and loci (G2), plans and elevations (G13) and bearings (G15), which are Foundation statements that need interactive drawing rather than typed answers; they wait for a drawing input on both tiers.

---

## 3. Curriculum work

### 3.1 Modelling Higher in the graph (proposed ADR, amends ADR-0021)

**Options considered:**

- **A. Tier-tagged item families inside the existing node** (N8 gains surd families marked Higher). Rejected: mastery is per node (ADR-0026), so a Foundation student who secured N8 would see it fall back when surds arrive, SECURE coverage would demand Higher families, and a Higher student's N8 would mix two ideas with different difficulties.
- **B. Extension nodes** (chosen). Each Higher extension becomes its own node with code `<parent>H<n>`, `tier: HIGHER_ONLY`, an `extends:` link to its Foundation parent, and a strong prerequisite edge to it. Where a `higher:` sentence holds more than one idea (A4: factorising with a not 1, algebraic fractions, index laws), each idea is its own node (A4H1, A4H2, A4H3), so SECURE is reachable in a sensible number of attempts.

Consequences: ADR-0021's "one node per DfE statement" becomes "one node per DfE statement, plus one per Higher idea within a statement"; nodes count rises from 97 to 127. The `higher:` sentences on the parent nodes stay as documentation and point at the extension codes.

Schema and code changes:

- `common.schema.json` `nodeCode`: `^[NARGPS][1-9][0-9]?(H[1-9])?$`; the re-check pattern in `misconceptions.schema.json` follows.
- `nodes.schema.json`: optional `extends` (a node code, required when the code has an `H` suffix), `band` (`G4_5`, `G6_7`, `G8_9`), `weight_higher` (Higher mark density, 0.1 to 3). A cross-file check: an extension node is `HIGHER_ONLY`, its parent exists and is `FOUNDATION`, and it has an edge to its parent of strength 0.8 or more.
- `topics.schema.json`: a `tier` (`FOUNDATION` or `HIGHER`), so the 13 MVP topics stay Foundation.
- `learner/planner.py` `_natural`: today `([A-Z]+)(\d+)` falls back to `(code, 0)` for `N8H1`; it must sort N8, N8H1, N8H2, N9.
- `seed/curriculum.py` and `seed/upsert.py`: carry `extends`, `band` and `weight_higher`; natural keys are unchanged (the node code).

Example (`nodes.yaml`, under `NUMBER`):

```yaml
    - code: N8H1
      tier: HIGHER_ONLY
      extends: N8
      band: G6_7
      visual: 2
      title: Surds
      description: Simplify surds, and add, multiply and expand brackets with them, leaving answers exact.
```

### 3.2 The course, made explicit (proposed ADR)

Today the course is implied: the planner, diagnostic and progress page treat any node with a maths-core template as practisable (`_practisable` in `routes/learning.py`; `_templates_by_node` in `diagnostic.py`; `node_infos` in `tutor/learner_store.py` has no tier filter). Adding a single Higher template would put it in every Foundation student's plan, and adding wave 1's Foundation templates (N4, A4 and the rest) would widen the Foundation course without anyone deciding to.

Proposal: `curriculum/maths/courses.yaml`, seeded into `course` and `course_node` link rows (kept in step with the YAML like topic nodes, ADR-0021):

```yaml
courses:
  - tier: FOUNDATION
    # The 24 nodes taught today; adding one here is a product decision.
    nodes: [N1, N2, N3, N9, N10, N11, N12, R4, R5, R6, R7, R9, A8, A9, A10, A17, G3, G7, G16, G17, G20, P7, P8, S4]
  - tier: HIGHER
    includes: FOUNDATION
    nodes: [N4, N6, N7, N7H1, N8, N8H1, ...]
```

The API computes "practisable" as the student's course nodes that have templates. A node with templates outside the course is neither offered nor shown. Prerequisites outside the course are still "looked through" (ADR-0026), so a Higher node whose Foundation parent is outside the Foundation course still has a working gate. Cross-file checks: every course node exists, and every Higher course node's ancestors are declared in `prerequisites.yaml`.

### 3.3 Prerequisite edges

About 90 new edges. Rules of thumb, so reviewers can check them:

- An extension depends on its parent at strength 0.9.
- Technique edges at 0.6 to 0.8 (A18H1 needs A2 substitution and N8H1 surds when answers are exact; G22 needs G20; P9 needs P6 and P8; S3 needs S2 and N13 for class widths).
- Weak context edges at 0.3 to 0.5 (A16 needs A9H1 for the tangent; R15 needs A15).

Example:

```yaml
  N8H1:
    - { code: N8, strength: 0.9 }
    - { code: N6, strength: 0.8 }
    - { code: N4, strength: 0.6 }
  A18H1:
    - { code: A18, strength: 0.9 }
    - { code: A2, strength: 0.7 }
    - { code: N8H1, strength: 0.5 }
  G22:
    - { code: G20, strength: 0.8 }
    - { code: G3, strength: 0.4 }
    - { code: A17, strength: 0.5 }
```

The DAG test, the "every course node's ancestors declared" check and the planted-cycle test already exist; they extend to the new codes.

### 3.4 Misconceptions

Target: at least 3 per newly templated Foundation node and 4 per Higher node, about **240 new entries** (85 today): about 80 overlap, 90 Higher wave 1 and 70 Higher wave 2. The cross-file rule "at least four misconceptions per MVP topic" extends to every Higher topic. Every entry follows the existing conventions: student text names the idea, never an item's numbers; teacher text describes the error; `detect` uses the ADR-0022 rule language; `scene` names a planned template (only built ones play, ADR-0031); `recheck` names a family on the same node; `evidence` is `brief-s2` where the brief's topic map lists it, otherwise `practice`. Add them with `/new-misconception`, which already writes the maths-core rule stub.

Detection by kind:

- **Distractor rules** (most): the wrong answer is a pure function of the item parameters, as today. Examples: `sqrt_split_over_sum` (the root of a sum taken as the sum of roots), `fractional_index_multiply` (8 to the power 2/3 taken as 8 times 2/3), `negative_index_negates` (2 to the power -3 taken as -8), `perpendicular_negate_only` (gradient -m rather than -1/m), `turning_point_sign_kept` (the turning point of (x - 3)² + 2 read as (-3, 2)), `quadratic_formula_minus_b_squared` (-b² read as a negative square), `sqrt_positive_root_only` (x² = 9 giving only 3), `translate_f_x_plus_a_right` (f(x + a) moved right), `composite_wrong_order` (fg(x) worked as f first), `centre_angle_halved`, `area_sf_as_length` (area scale factor k rather than k²), `sine_rule_mismatched_pair`, `cosine_rule_multiply_before_subtract`, `histogram_height_as_frequency`, `conditional_over_whole_space`, `bounds_divide_by_upper`, `compound_as_simple`, `decay_multiplier_above_one`, `quadratic_nth_second_difference_as_coefficient`, `trig_radians_mode`.
- **Rules that return several values.** Some slips change a set of answers (x² = 9 gives {3}; a factorising sign slip gives {2, -3} for {-2, 3}). Rules may return a `FiniteSet` or a set of tuples; equivalence compares sets (section 4.2).
- **Structure rules** (ADR-0022, so far only 2): needed where the value is right and the form shows the slip. Examples: `surd_not_simplified` (√18 left unsimplified when simplest form is asked), `not_rationalised`, `not_fully_factorised` (2(x² + 3x) when 2x(x + 3) is asked), `inequality_sign_not_reversed` read from the written relation, `proof_example_only` (a worked number given instead of an algebraic argument, recognised because the student's lines contain no letters).
- **Classifier only:** misconceptions in reasoning that no rule can see, such as "a reason quoted for the wrong circle theorem" in free text. These can only be SUSPECTED and never block SECURE (ADR-0026).

### 3.5 Item families

At least 3 families per node, as the MVP required, named `<node>.<idea>` (for example `N8H1.simplify`, `N8H1.multiply-brackets`, `N8H1.root-of-sum`). Each family maps to one maths-core template. A family per misconception's re-check, with a different surface from the teaching family. Higher nodes get one **problem-solving family** each (a two-step context with one final answer), because AO2 and AO3 carry 60% of Higher marks.

### 3.6 Order of work

1. Schema and check changes (3.1, 3.2) with planted-fault tests, before any content.
2. Wave 1 Foundation overlap nodes: misconceptions and edges (they are prerequisites of the rest).
3. Wave 1 Higher nodes, strand by strand in the order algebra, number, geometry, ratio, statistics, probability (algebra carries 30% of Higher marks).
4. Wave 2, in H8.

### 3.7 Seeding conventions to keep

- `pnpm curriculum:check` (no database) on every change; `pnpm db:seed --dry-run --verbose` shows the diff; the second seed reports zero changes.
- Additive only: nothing is removed; anything taken out of the YAML is retired, never deleted (ADR-0021).
- Quote YAML values containing `: ` or commas in flow mappings (curriculum/README.md).
- Each wave's seed ends with the admin curriculum browser reviewed at 375, 768 and 1280 px (with a tier filter added in H1).

---

## 4. maths-core

### 4.1 Input: the allow-list and converter (amends ADR-0025)

Additions to `mathjson.py`, each with fuzz tests (the M3 fuzz suite runs 1,500 random trees and 400 hostile ones; extend it with the new heads):

| Addition | Why | Guard |
|---|---|---|
| `Sin`, `Cos`, `Tan`, `Arcsin`, `Arccos`, `Arctan` | Trigonometry, sine and cosine rules, exact values | Angles are degrees by convention: a bare number argument is read as degrees, as GCSE writes them; `Degrees` already exists. Inverse trig results are in degrees. No nesting of trig inside trig. |
| `Or`, `And`, chained relations (`-2 < x < 3`) | Quadratic inequalities, multiple solutions written in one line | At most 2 relations joined, one letter. |
| `Vector` (column vector) and bold vector letters | G24, G25, G25H1 | Two components, numbers or linear expressions; vector letters only in linear combinations (no product of two vectors). |
| Letter exponents in trusted maths only | Exponential graphs (A12H1), growth `a × b^x` in claims | Still refused in student input, as today; allowed in tutor and scene claims with a positive rational base and a single-letter exponent, sampled on a bounded range. |
| Subscripts on a letter (`x_{n+1}`) | Iteration formulae in stems and claims | Display and claims only; student answers to iteration items are numbers. |

Limits stay: 400 nodes, depth 24, 3 letters (vectors use `a` and `b`, proofs use `n`), 4 radicals, degree 12. The radical limit is enough for rationalising (a/(b + √c) multiplied through has 2 to 3 roots).

### 4.2 Answer kinds and form rules

New `AnswerFormat` fields and kinds in `formats.py`:

| Kind or form | Used for | Check |
|---|---|---|
| `kind: "solutions"`, `count: n` | Two roots, two intersection points | Multiset equality, order ignored. The UI shows `count` answer boxes ("x = [ ] or x = [ ]"), which is easier to type and to parse than one line with "or". One right value of two is wrong overall, with a format-style hint that does not say which one. |
| `kind: "inequality"` | A22, A22H1, set notation later | Both sides reduced with `solveset` over the reals to an `Interval` or `Union`, then compared. |
| `kind: "vector"` | Column vectors, vector expressions | Element by element; an expression in `a` and `b` compared as a linear combination. |
| `form: "surd"` | Simplest surd form | Read from the student's MathJSON: every root's argument square-free, no root of a fraction, and no root in a denominator when `rationalised: true`. |
| `form: "factorised"` | A4, A4H1 "factorise fully" | Top level is a product; each factor is irreducible over the integers; the product of the factors equals the target. Needed for Foundation A4 too. |
| `form: "completed_square"` | A11H1, A18H2 | Shape `p(x + q)² + r` with numbers p, q, r. |
| `tolerance: {low, high}` | Read-offs from a graph, a tangent gradient, a cumulative frequency median, an area by strips | The value lies in a range the template computes from the diagram's exact geometry, as marking of read-off answers accepts a range. |
| `steps` (command word `SHOW_THAT`, which exists) | Show-that and algebraic proof | See 4.4. |

`equivalent()` gains set comparison (sets of numbers, of tuples), interval comparison and vector comparison. Sampling-based equivalence learns trig: points are drawn in degrees and the `_singular` check also refuses points where a tangent is undefined.

### 4.3 SymPy needs by topic

| Topic | What maths-core must do | SymPy | Watch out for |
|---|---|---|---|
| Surds | Exact comparison; simplest form; rationalising | `sqrt` auto-simplification, `radsimp`, `cancel` | Form is judged from the written MathJSON, because SymPy simplifies √18 to 3√2 before any rule sees it. |
| Fractional and negative indices | Exact powers | `Pow` with rational exponents (root index up to 10, as today) | Fractional bases with negative exponents: keep numbers small so results stay under 40 digits. |
| Quadratics | Roots as a set; irrational roots to a given dp; factorised and completed square forms | `Poly`, `factor`, `roots`, `solveset` | Rounded roots compare per root after rounding, as ADR-0025 does for one value. |
| Linear and quadratic simultaneous | Pairs of points | `solve` on the template side only (trusted parameters) | Students enter points, never systems: no solving of student input beyond today's degree 4. |
| Inequalities | Solution sets | `solveset(..., S.Reals)`, `Interval`, `Union` | Bounded to degree 2 and one letter; time it in the bench. |
| Algebraic fractions | Exact comparison; simplest form | `cancel`, `gcd`, `factor` | "Simplest" means numerator and denominator share no polynomial factor. |
| Functions | Composite and inverse expressions | `subs`; the inverse is solved in the template, never from input | Students type only the right-hand side; the label "f⁻¹(x) =" sits beside the box, as units do today. |
| Iteration | Values to a given dp | Exact rationals and `round_half_up` (exists) | Rules for "fed back the rounded value" and "substituted into the wrong side". |
| Trigonometry | Exact values (sin 60° = √3/2); lengths and angles to dp or sf | `sin(pi*x/180)`, `evalf` | Never `simplify` a large trig expression on the hot path; sample and confirm only small ones (`MAX_SIMPLIFY_OPS` already caps this). |
| Vectors | Element-wise and linear-combination equality | `Matrix` or `Tuple`, `linear_eq_to_matrix` | Bold letters are symbols restricted to degree 1. |
| Circle and tangent | Equation equivalence | Exists (constant multiple, solution set) | None new. |
| Proof | Step validity; final form checks | Existing step checker; `Poly` coefficients | See 4.4. |
| Graph read-offs and areas | Range checks | Exact geometry from the template | Ranges must be generous enough for a 375 px screen. |
| Histograms and cumulative frequency | Frequency density, counts within part of a class | `Rational` | Part-class estimates assume an even spread; the stem says so. |
| Bounds | Upper and lower bounds of results | `Rational` | Rules for "upper bound of the divisor to get the largest quotient". |

### 4.4 Templates, multi-step items and proof

- **About 220 new templates** (87 today): about 85 for the overlap nodes, 75 for Higher wave 1 and 60 for wave 2. Same contract as today: parameters from a seeded generator, redrawn until numbers are clean and every distractor distinct; reproducible from `(template_id, seed)`; one distractor per rule that can show itself.
- **Multi-step questions** are common at Higher. Phase 1 keeps one final answer per item and puts the multi-step work in the problem-solving family. Phase 2 (H8) adds **linked parts**: a template can emit a short chain (part a, then part b using the same parameters), each part its own item and attempt, so the learner model and mastery rules need no change.
- **Show that and proof** are checked as working, not as prose:
  - The student enters lines of working. Each line must follow from the one before (the existing step checker), the first must be the given expression or a correct algebraic setup, the last must equal the target, and at least one line must be more than a copy.
  - For algebraic proof the setup is checked by meaning: "an odd number" is accepted as any expression odd for every integer n (checked by parity at several integers), and the conclusion by form: "a multiple of 4" means the last line is 4 times an expression with integer coefficients.
  - Written conclusions and "give reasons" are not marked. Reasons for circle theorems and angle facts become a choice from a closed list in our own words (choice items, guess rate from the number of options, ADR-0026).
- **Diagrams.** Higher geometry and statistics items need diagrams. Each template's `diagram` data is drawn by the scene primitives' static diagram renderer (it exists for scenes), with a text description generated from the same parameters for screen readers.

### 4.5 Property tests and worked examples

Per template, as today: Hypothesis over 40 seeds checks every distractor is distinct, never equal to the answer, and equal to its rule; the generated item verifies. New properties:

- Set answers: any permutation of the right roots is accepted; dropping one root is not.
- Surd and factorised forms: the form check accepts the canonical form, rejects a known unsimplified form, and is unchanged by reordering terms.
- Inequalities: an answer written as `3 > x` equals `x < 3`; a reversed sign does not.
- Trig: exact-value answers equal their decimal only when the question allows a decimal.
- Every new rule has a hand-worked example from its misconception's description in `test_rule_examples.py` (ADR-0025), because a property test cannot catch a rule that models the wrong slip.
- A test reads `courses.yaml` and `nodes.yaml`: every template's node exists, and no template on a Foundation course node uses a Higher-only answer kind or form.

### 4.6 Golden set

The golden set grows from 300 items to **about 1,000** (about three per new template), frozen as today, with `pnpm evals` at 100%. The scene golden set adds 8 real items per new scene. M3's hand check was done by Claude and "not yet checked by a person"; for grades 6 to 9 a qualified maths teacher should check every tenth golden item before Higher students see any of it.

### 4.7 The 150 ms budget

Today's p95 is 2 to 4 ms, so there is room, but the new operations are the slow kind. Actions:

- Extend `pnpm maths:bench` with a Higher mix: surd forms, quadratic sets, inequalities, trig sampling, vector combinations, proof chains of 6 lines, and hostile inputs at the limits.
- Gate: p95 under 150 ms and no single verification over 1 s, on Linux CI.
- The per-verification process sandbox with a hard time limit, still to come from ADR-0025 and M10, becomes a prerequisite of H2: `solveset` and `simplify` on adversarial inputs are where SymPy can run long.

---

## 5. Learner model and diagnostic

### 5.1 Tier in the profile

- `student_profile.tier` gets its own values, `FOUNDATION` or `HIGHER` (today it reuses the curriculum's `FOUNDATION`/`HIGHER_ONLY`, which would store a Higher student as "HIGHER_ONLY"). Migration in 8.6.
- `SetupIn` accepts `tier: FOUNDATION | HIGHER` and validates `target_grade` by tier: Foundation 4 or 5; Higher 4 to 9 (see open question 4).
- A tier change is allowed later from Settings and recorded in the audit log (`profile.tier_changed`). Nothing is deleted: mastery is per node, so a student moving from Higher to Foundation keeps their Higher records, hidden until they move back.

### 5.2 Scope

Every place that builds the student's node list (`/v1/me/plan`, `/v1/me/progress`, the diagnostic, the tutor graph's `plan_session`) passes the tier, and `node_infos` returns only the student's course nodes (3.2), with out-of-course prerequisites still looked through. A test signs up a Foundation student, seeds every Higher template, and asserts no Higher node appears in their plan, progress map, diagnostic or tutor lesson.

### 5.3 Target grades and planning weights

`choose_node` today weights by `exam_weight_hint` (Foundation mark density), flattened for target grade 5. For Higher:

- Weight by `weight_higher` (Higher mark density per node) for Higher students.
- Gate by band, by target grade:

| Target | Open from the start | Opens later |
|---|---|---|
| 4 or 5 (Higher) | Band 4 to 5 | Band 6 to 7 once most band 4 to 5 nodes in the strand are secured; band 8 to 9 not offered unless the student asks for stretch |
| 6 or 7 | Bands 4 to 5 and 6 to 7 | Band 8 to 9 once most band 6 to 7 nodes in the strand are secured |
| 8 or 9 | All bands | (none) |

  "Most" starts at 70% and is tuned with the simulator.
- Flatten the weighting for targets 7 to 9, as grade 5 does today, because those students need breadth.
- Never show bands or grades on nodes to the student (non-goal: grade predictions as fact).

### 5.4 Foundation prerequisites and a test-out route

Higher students will meet up to 50 Foundation course nodes. Grinding through each one to SECURE would waste able students' time, which ADR-0026 already listed for M7 ("Offer a test-out route, and let onboarding evidence count towards coverage"), not yet built.

Proposal for Higher students:

- A confident, correct diagnostic answer on a node's hardest family, plus 2 more counted correct answers spread over 2 sessions (they can come from interleaved review items), secures a Foundation node, instead of 3 after a full learning run.
- Coverage counts each family's misconceptions probed by any of those answers.
- Any match of a misconception on the node reopens it as today.

The two-failure prerequisite diagnostic walks into Foundation nodes unchanged: an extension node's first probe is its parent (strength 0.9). Propagation (a capped boost of half the edge strength, never above 0.9) is unchanged, so a Foundation parent can never be secured by its Higher child alone.

### 5.5 Mastery thresholds

Keep ADR-0026's SECURE rule for every node: p_mastery at least 0.95; the last 3 counted correct answers across 2 sessions on 2 dates at least 8 hours apart; no open misconception; coverage. Two changes:

- **Guess rate per template.** BKT's p_guess is 0.2 for typed answers today. A typed surd, a pair of roots or a vector is far harder to guess, and ADR-0026's evidence shows false SECURE falls from 21.64% to 0.28% as chance success falls from 1 in 5 to 1 in 20. Templates declare a `guess_rate` from their answer kind (choice items 1 over the number of options; single numbers 0.2; exact forms, sets and vectors 0.05). This must be confirmed in the simulator, not assumed.
- **Family coverage**, also left to M7 by ADR-0026: require each item family on the node at least once before SECURE. Higher nodes have more varied families, so this matters more.

### 5.6 Review scheduling

FSRS is unchanged (target retention 0.9, days, at most 120 days apart). Two pressures:

- **Volume.** A Higher student may hold 60 or more secured nodes, and reviews are capped at 5 a session (`MAX_REVIEWS`). Raise the cap with the number of secured nodes (5 up to 20 secured, then up to 8), and keep interleaving by strand.
- **The pre-exam sweep** (ADR-0026, left to M7) matters more for Higher. It uses `exam_series` to schedule a review of every secured node in the 6 weeks before the exam.
- The FSRS time rule (72 seconds a mark) already scales with `marks`, so multi-mark Higher items need no special case.

### 5.7 A Higher diagnostic

- Same engine (`diagnostic.py`): typed answers, confidence before the reveal, stop and resume, "I do not know this yet".
- The queue starts with band 6 to 7 nodes, deepest first; a confident right answer passes over the node's prerequisites, now including its Foundation parent, so an able student skips most of the overlap content.
- 20 questions stays the cap; measure the time in H4 and raise it to 24 only if it stays under about 20 minutes.
- **Diagram questions included.** ADR-0032 skips them; for Higher that would skip circle theorems, trigonometry and histograms, so the diagnostic gets the static diagram renderer in H4.
- **A top-up diagnostic** for a Foundation student who moves to Higher: Higher course nodes only, at most 12 questions.

### 5.8 What to revisit in ADR-0026, and the simulator

ADR-0026 needs an amendment covering: the per-template guess rate; family coverage; the test-out route (5.4); band gating and Higher weights; the review cap and the pre-exam sweep; and any parameter refit from Foundation pilot data (its own consequence: "Refitting p_guess and p_learn on pilot data is the real fix").

`pnpm learner:report` gains Higher populations:

- learnable students on exact-form items (guess rate 0.05);
- able students who already know the Foundation parents (how many attempts the test-out saves, and how often it secures a node the student does not know);
- persistent misconceptions on Higher nodes (the 2% false SECURE bar, at 80% consistency, must hold);
- band gating (median sessions before band 8 to 9 opens for a target 8 student).

The simulator's own limits (one node at a time, no forgetting) stay recorded.

---

## 6. Scenes

### 6.1 New primitives and engine changes

| Change | For | Notes |
|---|---|---|
| Curves on `coordinate_grid` | Graph sketching, transformations, turning points, inequalities, iteration, tangents and areas | Sampled open polygons with a fixed point count, so a curve morphs point by point into its translation (the timeline already morphs elements that keep their id). Clipped to the grid region; asymptotes split the curve into pieces. The overlap check uses whole bounding boxes (ADR-0028's known limit), which would make every curve collide with every label, so open polygons get per-segment boxes. |
| `trig_triangle` | Sine rule, cosine rule, area of a triangle, 3D trig | Any triangle with sides a, b, c opposite angles A, B, C; each opposite pair shares a colour and a label; optional dropped height. |
| `circle_theorem` | G10 | Circle, centre, points on the circumference, chords, radii, tangent, angle arcs; built from existing circle, line and arc elements. |
| `vector_diagram` | G24, G25, G25H1 | Arrows on a lattice or a shape, bold labels, a path traced arrow by arrow, a reversed arrow for a negative vector. |
| `venn_diagram` | P6H1, P9 | Two or three sets, region counts, shading, set notation labels; a two-way table view of the same data. |
| `histogram` | S3, S4H1 | Frequency density axis, unequal widths, area shading, part-class shading; cumulative frequency curve and box plot views. |
| `function_machine` | A7H1 | Machines in a row, order of application, reversed for the inverse. |
| A cube view in `area_model` | N7H1 fractional indices | The edge of a cube from its volume (the root), then a square on that edge (the power). |
| `unit_circle` (wave 2) | A12H1, G21 | Why sin x = 0.5 has a second solution between 0° and 360°. |
| `sequence_table` (wave 2) | A25H1 | First and second differences under a sequence. |

Also needed:

- KaTeX maths for column vectors (`pmatrix`), bold vector letters, roots with an index and set notation. The DOM check judges the boxes, as for all maths (ADR-0028). Tall column vectors need measuring at the narrowest stage (288 px).
- The speakable text the device voice reads (ADR-0030) learns new readings: "root 3", "2 root 3", "sine of 30 degrees", "vector a", "a union b", "x squared", "the second difference". Tests make sure no sign or power is dropped.
- `PRIMITIVES` in `templates/template.ts`, the curriculum's `sceneTemplate` pattern and topic primitives all extend.
- Scene maths verification (`POST /v1/scenes/verify`) gains approximate claims (section 7.2) and trig and surd claims.

### 6.2 Prioritised Tier D backlog

One scene per Higher topic for its most common misconception first, as the MVP did. Priority weighs Higher mark density, how visual the idea is (`visual` in nodes.yaml) and how often the slip appears in the brief's topic map. Each scene needs its node's item template first (H3 for wave 1, H8 for wave 2).

| # | Scene key | Misconception (our name) | Node | Primitive | Wave |
|---|---|---|---|---|---|
| 1 | `area_model.expand_square` | A squared bracket expanded as two squares | A4 | area_model (reuse) | 1 |
| 2 | `number_line.two_square_roots` | Only the positive root of x² = k | A18 | number_line (reuse) | 1 |
| 3 | `pythagoras_squares.root_of_sum` | The root of a sum taken as the sum of roots | N8H1 | pythagoras_squares (reuse) | 1 |
| 4 | `area_model.factorise_grid` | Factor pairs chosen ignoring the coefficient of x² | A4H1 | area_model (reuse) | 1 |
| 5 | `coordinate_grid.perpendicular_gradient` | Perpendicular gradient taken as the negative only | A9H1 | coordinate_grid (reuse, with turn) | 1 |
| 6 | `trig_triangle.opposite_pairs` | Sine rule with a side and an angle that are not opposite | G22 | trig_triangle (new) | 1 |
| 7 | `circle_theorem.centre_double` | Angle at the centre halved rather than doubled | G10 | circle_theorem (new) | 1 |
| 8 | `histogram.frequency_density` | Bar height read as frequency | S3 | histogram (new) | 1 |
| 9 | `venn_diagram.given_shrinks_space` | Conditional probability over the whole sample space | P9 | venn_diagram (new) | 1 |
| 10 | `area_model.area_scale_factor` | Area scale factor taken as the length scale factor | G19H1 | area_model (reuse) | 1 |
| 11 | `coordinate_grid.turning_point` | Turning point read with the sign inside the bracket | A11H1 | coordinate_grid with curves | 1 |
| 12 | `vector_diagram.reverse_path` | A vector path taken in the wrong direction | G25 | vector_diagram (new) | 1 |
| 13 | `function_machine.composite_order` | fg(x) worked with f first | A7H1 | function_machine (new) | 1 |
| 14 | `area_model.fractional_index` | A fractional index multiplied rather than rooted and powered | N7H1 | area_model with cube view | 1 |
| 15 | `bar_model.repeated_percentage` | Compound change worked as simple | R16H1 | bar_model (reuse) | 1, if time |
| 16 | `coordinate_grid.translate_curve` | f(x + a) moved the wrong way | A13 | coordinate_grid with curves | 2 (first) |
| 17 | `coordinate_grid.circle_radius` | Radius read as r² in x² + y² = r² | A16 | coordinate_grid | 2 |
| 18 | `number_line.quadratic_inequality` | Only one interval kept for a quadratic inequality | A22H1 | number_line with a sketch | 2 |
| 19 | `coordinate_grid.line_meets_curve` | One intersection only for a line and a curve | A19H1 | coordinate_grid with curves | 2 |
| 20 | `number_line.bounds_division` | Upper bound of the divisor used for the largest quotient | N16H1 | number_line (reuse) | 2 |
| 21 | `coordinate_grid.area_strips` | Strip width or units ignored for the area under a graph | A15 | coordinate_grid with curves | 2 |
| 22 | `unit_circle.second_solution` | One angle only for a trig equation | A12H1 | unit_circle (new) | 2 |
| 23 | `trig_triangle.cosine_rule_order` | 2bc multiplied by the sum before subtracting | G22 | trig_triangle | 2 |
| 24 | `vector_diagram.collinear` | Parallel vectors taken as proof without a shared point | G25H1 | vector_diagram | 2 |
| 25 | `sequence_table.second_difference` | The second difference used as the coefficient of n² | A25H1 | sequence_table (new) | 2 |
| 26 | `coordinate_grid.tangent_gradient` | Gradient read from a chord instead of a tangent | R15 | coordinate_grid with curves | 2 |

Wave 1 delivers 14 scenes (15 if time allows); wave 2 delivers about 11. Every scene goes through `/new-template`: parameters, spec with reviewed narration, drawings for 16:9 and 4:5, maths claims, 8 golden inputs, static and DOM checks at every width in light and dark, and the pedagogy critic. A teacher's look at the scenes is still owed from M5; it should cover the Higher scenes too.

### 6.3 Tier L

Nothing changes in the loop (ADR-0030): Claude writes beats only, from enums built for each template. Per new scene:

- the Tier L eval cases are built from its golden inputs (`python -m eddy_api.scenes.eval build`), about 110 Higher cases for wave 1;
- `pnpm scenes:precompute` makes 3 variants per seeded misconception that has a scene.

At M6's measured cost (2.5p a variant, about 4p more for its critique), wave 1's precompute is roughly 25 misconceptions times 3 variants times 6.5p, about £5. A live Tier L eval run is a few pounds. Both need the product owner's go-ahead, with `--max-gbp 20`.

---

## 7. Tutor and safety

### 7.1 Prompt changes (`prompts/tutor.md`, a new minor version)

- Audience: "GCSE Maths, Foundation or Higher tier", with the student's tier and the node passed in the stable prefix.
- The allowed MathJSON heads gain `Sin`, `Cos`, `Tan`, `Root`, `Vector` and `Approx` (7.2), with an example for each.
- Multiple answers: any one of the roots is the answer, so never state either.
- Show-that: the target is in the question, so the steps are the answer. Show at most one step, as the ladder already says.
- Choosing a formula: teach which formula and why (brief section 1: formulae sheets stay), never which formulae a given board prints.
- Worked examples of a parallel problem stay at 150 words unless the eval shows Higher examples (the quadratic formula, a sine rule case) being cut short.

### 7.2 Output checks

- **Deeper maths.** `TutorMessage.maths` is nested at most four arrays deep, spelled out level by level because structured output cannot take a recursive schema (ADR-0031). The quadratic formula is five arrays deep and a rationalised denominator can be six, so the depth goes to 6: regenerate the zod schema, JSON Schema and pydantic (`pnpm schemas:generate`), and check that structured output still compiles the larger schema and that latency does not rise.
- **Approximate claims.** Every number must trace to the question or a verified claim. Trig and quadratic formula values are rounded (sin 35° is about 0.574), so add an `Approx` relation with a stated dp or sf; maths-core accepts it when the exact value is within half a unit of the last place.
- **Answer leaks.** The leak check (ADR-0025) learns set answers (any root is a leak), inequality answers (the whole solution set, or an endpoint with its relation, is a leak; the critical values alone are allowed only in a level 3 partial step) and vector answers.
- **Show-that leaks.** Writing the full chain of steps counts as a leak.

### 7.3 Evals

- **Pedagogy suite** (`evals/tutor/conversations.yaml`): add about 36 Higher conversations, all on Higher templates and written for Eddy, with no exam board material:
  - 6 stuck (completing the square, sine rule, a vector path);
  - 6 guessing (a guessed root, a guessed surd);
  - 6 answer demands (including "just write the whole proof");
  - 4 off topic;
  - 6 lessons (3 with scenes, 3 without);
  - 4 injections hidden in typed working;
  - 4 benign near-misses with Higher vocabulary;
  - plus the existing distress scenarios re-run with Higher items as context.

  The total rises from 72 to about 108.
- **A new rubric criterion** for problem solving: the tutor asks for a plan and names a strategy without doing the step. Calibrate it on the Opus sample like the others (kappa at least 0.4, `evals/thresholds.yaml`).
- Thresholds unchanged: zero answer leaks, every distress scenario handled, every injection held, rubric mean 3.0, p95 turn under 12 s.
- Use `--only` to run the Higher ids while iterating. A full run cost about £2.39 for 72 conversations (PLAN.md M7), so 108 is about £3.60. Every live run needs a go-ahead, with `--max-gbp 8` each.

### 7.4 Cost per session

M7 measured about £0.33 a session. Higher messages carry more maths (more claims to verify, so more regenerations) and longer worked examples, so expect about **£0.40 to £0.45**, to be measured in H6. Two settings may need the product owner:

- the per-student daily tutor cap (`tutor_gbp_per_student_per_day`, £0.50), which a long Higher session could reach;
- the tutor's effort (`low` in `config/models.yaml`), if Higher explanations score lower. A change of effort or model is a config change plus an eval run (ADR-0005).

### 7.5 Safety

Unchanged by design: the tripwires, both Haiku classifiers, the static safeguarding script (a draft until Eddy's safeguarding lead approves it, which still blocks real students on either tier), the ZDR gate and the rate limits. The injection and distress scenarios are re-run against Higher contexts to prove it. Nothing in Higher sends more personal data to Claude.

---

## 8. Web app and data

### 8.1 The tier choice goes live, behind a flag

`EDDY_HIGHER_TIER` (API setting; off by default, so production keeps "Coming later"; on in development and E2E). With it off, `PUT /v1/me/profile` refuses `HIGHER` (422) and the form keeps the disabled option. A Higher beta can be limited to an invite cohort (`invite_code.cohort` exists), so the first Higher students are a known group.

### 8.2 Set-up page (`welcome/set-up`)

- Enable the Higher radio; `welcome/actions.ts` sends the chosen tier instead of `"FOUNDATION"`.
- The target grade options follow the tier: Foundation 4 and 5 as today; Higher 4 to 9.
- Hints are plain and promise nothing ("Grade 7", with no claim about marks). One line under the tier choice: "Not sure which tier you are entered for? Your teacher can tell you."
- Errors, empty and loading states as M8 designed them.

### 8.3 Maths input

- A Higher keyboard layout as a second tab of the on-screen keyboard (`packages/ui/src/components/MathField.tsx`):
  - an nth root;
  - sin, cos and tan and their inverses;
  - the inequality signs;
  - a column vector and bold a and b;
  - letters x, y and n, and brackets.
- Every key is 44 px or more, with screen reader names ("square root with index", "sine").
- `latex-mathjson.ts` learns `\sin`, `\cos`, `\tan`, `^{-1}` on them, `\sqrt[n]{}`, `\begin{pmatrix}`, `\le`, `\ge`, chained inequalities and `\mathbf{a}`, with unit tests and the existing "nothing evaluated in the browser" rule.
- Answer boxes: `count` boxes for `solutions`; a label beside the box for functions ("f⁻¹(x) =") as units are shown today; a multi-line working field for show-that items.

### 8.4 Lessons and diagrams

Items with diagrams render through the scene primitives' static renderer in the question card and in the diagnostic, with the generated text description. Check them at 375 px: circle theorem diagrams and histograms are the risk.

### 8.5 Progress page

A Higher course has about 75 nodes against 24 today. The map groups nodes by strand, shows a "Higher" label on Higher nodes (never a grade), and folds secured Foundation groundwork into a collapsed section per strand. States stay "not started", "learning", "secure" and "needs review". `ProgressOut` gains `tier` and each node's `higher` flag.

### 8.6 Migration (Alembic `0008_higher_tier`)

- `student_profile.tier`: a new check `profile_tier` with values `FOUNDATION`, `HIGHER`. Every existing row is `FOUNDATION`, so the upgrade changes no data. The downgrade refuses while any profile is `HIGHER`, rather than rewriting students' choices.
- `curriculum_node`: `extends_node_id` (nullable, references `curriculum_node`), `band` (nullable check), `weight_higher` (`Numeric(4,2)`, nullable).
- `topic.tier`; new `course` and `course_node` tables (granted to `eddy_app` for reads, as other curriculum tables).
- No change to `attempt`, `item` (still `(template_id, seed)`), mastery or misconception state: new nodes simply get new rows.
- Follow the M2 rules: the models match the migration (autogenerate finds no difference), up, down and up again, and the API tests run as `eddy_app`.
- `pnpm api-client:generate` after the route changes.

### 8.7 Parent dashboard and notices

- What a parent sees is fixed by ADR-0033 (topics secured and being learned, minutes, last five lessons, reviews due, contacts). "Topics secured" counts the student's own course, so it changes meaning silently for a Higher student; label it "Topics secured in their course".
- Showing the tier, or the target grade, to a parent is new information about the student. It needs the student's preview to show it (same component, so automatic), a privacy notice update (version 0.3.0, which asks everyone to acknowledge again), and the product owner's decision (open question 5). Recommendation: show the tier, never the target grade.
- The short and full privacy notices already list tier and target grade as set-up data; no other wording changes.

### 8.8 Admin

A tier filter and the `extends` link on the curriculum browser; the Higher scenes in the scene gallery; Higher items in `/admin/costs` by route are already covered.

### 8.9 Documents to update

- SPEC.md: sections 1, 2.1, 2.2, 2.3 (remove Higher from the non-goals), 4.1, 7.1 (weights and gates), 8.2 (primitives), 10 (cost). That makes SPEC.md v0.2, for the product owner to approve.
- PLAN.md gets the H milestones; DECISIONS.md the ADRs listed per milestone; `curriculum/README.md`; and CLAUDE.md for any new command.
- `compliance/` mentions Foundation in the DfE standards matrix ("Stated purpose") and the DPIA ("students near the grade 3/4 boundary"). Those edits are drafted only with the product owner's explicit go-ahead, as always.

---

## 9. Milestones

Each milestone runs as PLAN.md's "How each milestone runs" (plan, failing tests first, implement, check, run the app and look at screenshots, fresh-context review, commit, evidence block), on its own branch (`h0-groundwork`, `h1-curriculum` and so on), merged by pull request only with the product owner's go-ahead. Every milestone's definition of done includes CLAUDE.md's five points:

- PLAN.md's checklist ticked only where evidence supports it;
- `pnpm check` and `pnpm e2e` green with zero serious or critical axe violations;
- screenshots at 375, 768 and 1280 px in light, dark and reduced motion looked at and fixed;
- a fresh-context review (`reviewer`, plus `pedagogy-critic` or `security-reviewer` where named);
- an evidence block in PLAN.md, CHANGELOG.md and a conventional commit.

The lists below add each milestone's own items.

### Approval gates for Higher

| Gate | Needed by | What is needed |
|---|---|---|
| This plan and SPEC.md v0.2 | H0 | Product owner approval |
| Foundation launch checklist signed | H7 (H0 to H6 can start before) | PLAN.md M10 sign-off |
| Live tutor evals | H6, H9 | Go-ahead and a cap per run (`--max-gbp 8`) |
| Tier L eval and precompute | H5, H8 | Go-ahead and a cap (`--max-gbp 20`) |
| A maths teacher reviewer | H3, H5, H8, H9 | A named person to hand-check golden items and scenes |
| Parent dashboard showing tier | H7 | Decision, and a notice version |
| `compliance/` edits | H9 | Explicit go-ahead each time |
| Turning `EDDY_HIGHER_TIER` on in production | H9 | Explicit go-ahead |
| Safeguarding lead, ZDR, legal review | Before any real student, either tier | As in PLAN.md |

### Timeline

About 19 weeks in sequence; about 12 weeks with three tracks (each in its own session and worktree, merged by PR).

```
Week:      1    2    3    4    5    6    7    8    9   10   11   12
Track A  [H0][---H2---][-------H3-------][----------H8----------]
Track B    [---H1---]       [---H4---][-----H7-----]
Track C                  [---------H5---------][--H6--]      [-H9-]
```

Critical path: H0, H1, H3, H5, H6, H8, H9. H2's converter and answer kinds must land before H3's templates; H5's scenes each wait for their item template.

### H0: Groundwork and decisions

Depends on: approval of this plan. Estimate: 0.5 week.

Deliverables:

- [ ] ADRs: Higher extension nodes (amends ADR-0021); the explicit course (`courses.yaml`); the profile tier and target grades (amends ADR-0032 and SPEC.md 4.1).
- [ ] SPEC.md v0.2 drafted for approval (8.9).
- [ ] `EDDY_HIGHER_TIER` setting, off by default; `SetupIn` refuses `HIGHER` while it is off.
- [ ] Course scoping in the API with no new content: `node_infos` filtered by course, with the Foundation course equal to today's 24 practisable nodes.

Definition of done:

- [ ] A test seeds a stand-in Higher template and shows a Foundation student never sees it in the plan, the progress map, the diagnostic or a lesson.
- [ ] Foundation behaviour unchanged: `pnpm learner:report` identical to M4's numbers, all E2E journeys pass.

### H1: Curriculum for Higher

Depends on: H0. Estimate: 1.5 weeks. Runs alongside H2.

Deliverables:

- [ ] Schemas: `nodeCode` and re-check patterns, `extends`, `band`, `weight_higher`, topic `tier`, `courses.yaml` and its schema.
- [ ] 41 Higher nodes (30 extensions, plus `band` and `weight_higher` on the 11 Higher-only nodes), and bands and Higher weights on the 27 overlap nodes.
- [ ] About 90 new prerequisite edges, following the strengths in 3.3.
- [ ] 16 Higher topics, each with at least four misconceptions and a primitive.
- [ ] Wave 1 misconceptions: about 80 overlap and 90 Higher, each with detection rules, a planned scene, a re-check family and evidence; added with `/new-misconception`.
- [ ] The Higher course in `courses.yaml` (wave 1 nodes).
- [ ] Seed: `extends`, `band`, `weight_higher`, courses; migration `0008_higher_tier` (8.6).
- [ ] Admin curriculum browser: tier filter and the extension link.

Definition of done:

- [ ] `pnpm curriculum:check` passes, and fails on planted faults: an extension without its parent edge, a Foundation-tier `H` code, a course node with an undeclared ancestor, a cycle through an extension node.
- [ ] Seed runs twice; the second run reports zero changes. Migration up, down (refused while a Higher profile exists) and up again; autogenerate finds no difference.
- [ ] `pedagogy-critic` reviews the misconception wording (no item numbers, kind wording, UK English).
- [ ] Admin browser screenshots reviewed; axe clean.

### H2: maths-core for Higher

Depends on: H0 (misconception codes from H1 are wired in as they land). Estimate: 2 weeks.

Deliverables:

- [ ] Converter: trig heads in degrees, `Or`/`And` and chained relations, `Vector` and bold vectors, letter exponents and subscripts in trusted maths only (4.1).
- [ ] Answer kinds and forms: `solutions`, `inequality`, `vector`, `surd`, `factorised`, `completed_square`, `tolerance` (4.2); `equivalent()` for sets, intervals and vectors.
- [ ] Show-that checking: step chains, setup by meaning, conclusion by form (4.4).
- [ ] Approximate claims (`Approx` with dp or sf) for the tutor and scene verifiers.
- [ ] Leak check for set, inequality and vector answers, and for show-that chains.
- [ ] The per-verification sandbox with a hard time limit (ADR-0025's outstanding item).
- [ ] `pnpm maths:bench` with the Higher mix.

Definition of done:

- [ ] Fuzz and property tests pass for every new head and kind; the converter never crashes and never executes input.
- [ ] p95 under 150 ms and no verification over 1 s on Linux CI, with the Higher mix.
- [ ] Coverage at least 85%.
- [ ] `security-reviewer` on the converter and sandbox.

### H3: Templates, wave 1 (grades 4 to 7)

Depends on: H1, H2. Estimate: 3 weeks.

Deliverables:

- [ ] At least 3 templates for each of the 27 overlap nodes and 23 wave 1 Higher nodes (about 160), with one problem-solving family per Higher node.
- [ ] Every misconception rule registered, with a hand-worked example per rule.
- [ ] `diagram` data for every geometry and statistics template, with a text description.
- [ ] Templates declare `guess_rate` (5.5).
- [ ] Golden set grown to about 780 items, frozen.

Definition of done:

- [ ] Golden set 100% verified (`pnpm evals`); the map from templates to misconceptions equals `misconceptions.yaml`.
- [ ] A maths teacher has hand-checked every tenth new golden item (the gate), with the result recorded in `evals/golden/maths/HAND-CHECK.md`.
- [ ] Bench and coverage as H2.

### H4: Learner model and diagnostic for Higher

Depends on: H1, H3 (templates for the nodes it plans). Estimate: 1.5 weeks.

Deliverables:

- [ ] Planner: Higher weights, band gates by target grade, flattening for targets 7 to 9 (5.3).
- [ ] Per-template guess rate in BKT; family coverage for SECURE; the test-out route for Foundation nodes (5.4, 5.5).
- [ ] Review cap that grows with secured nodes; the pre-exam sweep from `exam_series` (5.6).
- [ ] Higher diagnostic: band 6 to 7 probes, Foundation parents skipped on a confident right answer, diagram questions included; the top-up diagnostic on a tier change (5.7).
- [ ] Simulator populations for Higher; ADR-0026 amendment with the evidence.

Definition of done:

- [ ] Persistent misconceptions (80% consistency) falsely SECURE under 2% on Higher nodes, free answers and choice items.
- [ ] Learnable students reach SECURE within a bounded number of attempts on exact-form items; the test-out route's false SECURE rate is reported and accepted by the product owner.
- [ ] A synthetic Higher diagnostic finishes within 20 questions; its time with real items is measured in H7.
- [ ] Foundation numbers in `pnpm learner:report` unchanged. Coverage at least 85%.
- [ ] `pedagogy-critic` on the band gates and the test-out route.

### H5: Scenes for Higher, wave 1

Depends on: H2 (claims), H3 (each scene's item template). Estimate: 3 weeks.

Deliverables:

- [ ] Curves on `coordinate_grid` with per-segment overlap boxes; `trig_triangle`, `circle_theorem`, `vector_diagram`, `venn_diagram`, `histogram`, `function_machine`; a cube view in `area_model` (6.1).
- [ ] KaTeX column vectors, bold letters, indexed roots and set notation, measured; the new speakable readings.
- [ ] Scenes 1 to 14 of the backlog (15 if time allows), through `/new-template`, each with 8 golden inputs.
- [ ] Tier L eval cases built for the new scenes; live run and precompute only with a go-ahead.

Definition of done:

- [ ] Every new scene passes the static and DOM checks at every sample width in light and dark (`pnpm scenes:check`), and `pnpm scenes:golden` reports 0 problems.
- [ ] Captions, transcript, keyboard control and the static diagram for every new scene; gallery axe clean at 375, 768 and 1280 px in light, dark and reduced motion; every keyframe looked at.
- [ ] `pedagogy-critic` on every scene; the teacher reviewer has watched them.
- [ ] If the Tier L run was approved: at least 95% of cases pass within two attempts, and the cost is reported.

### H6: Tutor and evals for Higher

Depends on: H3, H5. Estimate: 1.5 weeks. Gate: live eval spend.

Deliverables:

- [ ] `prompts/tutor.md` new minor version (7.1); `TutorMessage.maths` depth 6, schemas regenerated; `Approx` claims; leak rules for sets, inequalities, vectors and show-that (7.2).
- [ ] About 36 Higher conversations and the problem-solving rubric criterion (7.3).
- [ ] Safety scenarios re-run with Higher contexts.

Definition of done:

- [ ] The full suite (about 108 conversations) meets `evals/thresholds.yaml`: zero leaks, every distress scenario handled, every injection held, rubric mean at least 3.0, judge kappa at least 0.4, turn p95 under 12 s.
- [ ] Cost per Higher session measured and reported against the £0.50 per-student daily cap.
- [ ] `pedagogy-critic` and `security-reviewer`.

### H7: Student app for Higher

Depends on: H4, H6, and the Foundation launch sign-off. Estimate: 2 weeks.

Deliverables:

- [ ] Set-up with Higher live behind the flag; target grades by tier; tier change in Settings with the audit entry and the top-up diagnostic (8.1, 8.2).
- [ ] Higher keyboard tab and the converter changes; answer boxes for sets, function labels and show-that working (8.3).
- [ ] Item diagrams in lessons and the diagnostic (8.4).
- [ ] Progress map grouped for a large course (8.5).
- [ ] Parent dashboard wording, and the tier shown or not as decided (8.7).
- [ ] API client regenerated.

Definition of done:

- [ ] Playwright journeys: Higher sign-up and set-up, the Higher diagnostic with a diagram question, a Higher lesson with a scene, a set answer and a show-that item, a review, a tier change each way, and a parent view, in all 9 projects.
- [ ] axe clean on every page; the Higher lesson completed by keyboard only.
- [ ] Screenshots at 375, 768 and 1280 px in light, dark and reduced motion, including the keyboard tab and diagrams at 375 px, reviewed and fixed.
- [ ] The Higher keyboard added to the manual screen reader checklist.

### H8: Wave 2 (grades 7 to 9)

Depends on: H3 to H7. Estimate: 3 weeks.

Deliverables:

- [ ] 18 wave 2 nodes into the Higher course; about 70 misconceptions; about 60 templates; linked parts (4.4) for chained questions; golden set to about 1,000.
- [ ] Scenes 16 to 26, with `unit_circle` and `sequence_table`.
- [ ] Pedagogy conversations for wave 2 topics (proof, graph transformations, iteration).

Definition of done:

- [ ] As H3, H5 and H6 for the new content, including the teacher's hand check and the live eval run (with a go-ahead).

### H9: Higher beta

Depends on: H8 (or H7, for a wave 1 beta). Estimate: 1 week.

Deliverables:

- [ ] Load test with Higher students in the mix (`scripts/load/load_test.py`); cost dashboard showing Higher sessions.
- [ ] Drafted compliance updates (stated purpose, DPIA audience) with the go-ahead; privacy notice version if the parent view changed.
- [ ] A Higher beta cohort invite code; a launch checklist addendum for Higher.

Definition of done:

- [ ] Higher launch checklist signed off by the product owner; `EDDY_HIGHER_TIER` turned on only with that go-ahead.

---

## 10. Risks, open questions and dependencies

### 10.1 Risks

| Risk | Mitigation |
|---|---|
| Higher widens the Foundation course by accident (any template is practisable today) | The explicit course (3.2) and the H0 test, before any content lands |
| Scope: about 70 nodes, 240 misconceptions, 220 templates, 25 scenes | Two waves, a flag, and a usable grade 4 to 7 course after wave 1 |
| Maths errors at grades 8 to 9 that an AI hand check misses | A qualified teacher's hand check as a gate in H3, H5 and H8 |
| SymPy slowness or blow-ups on trig, inequalities and proof chains | Input limits, solving only on trusted parameters, the sandbox in H2, the bench gate |
| Reasoning (AO2, AO3) cannot be verified, and proof marking is easy to get wrong | Mark working by steps and forms only; reasons as closed choices; never mark free text |
| False SECURE on exact-form items or through the test-out route | Per-template guess rates confirmed in the simulator; the 2% bar; Foundation pilot refit first |
| Tutor latency rises with deeper maths and more regenerations | Measure in H6; the 12 s p95 gate; templated fallback as today |
| Cost per session rises and meets the daily cap | Measure; adjust the cap or effort only with the product owner |
| Diagrams at 375 px (circle theorems, histograms) are hard to read and to describe for screen readers | Static renderer checks at every width; generated descriptions; manual checklist |
| Students choose a tier their school did not enter them for | Neutral set-up wording pointing to their teacher; tier change any time with no lost progress |
| The reformed GCSEs (brief section 1: taught from about 2029) change Higher content | The curriculum is versioned by spec (ADR-0021); bands and courses are data |

### 10.2 Open questions for the product owner

1. **Timing.** Build Higher now, or after Foundation pilot data has refitted the learner model? (Recommended: H0 to H2 now, H3 onward after the first pilot data.)
2. **Waves.** Ship a grade 4 to 7 Higher beta after wave 1, or wait for grades 8 to 9?
3. **Course scope.** Wave 1 adds templates to 27 Foundation statements. Should those also join the Foundation course (good for Foundation students too), or stay Higher only for now?
4. **Target grades on Higher.** Offer 4 to 9, or 5 to 9? Higher grade 4 needs a low share of the marks (brief section 1), and narrow misses get a 3, so the set-up hint for grade 4 on Higher needs careful, neutral wording.
5. **Parents.** May a parent see the tier? The target grade? Either needs a notice update.
6. **Tier changes.** Allowed at any time from Settings, or only with a confirmation step and a note to check with the teacher?
7. **Proof and reasons.** Accept that Eddy marks proof by checked steps and reasons by choice lists, and never marks written explanations?
8. **The teacher reviewer.** Who checks the golden items and scenes for grades 6 to 9, and how is that paid for?
9. **Spend.** A cap for Higher's live evals and precompute (estimate: about £40 across H5, H6 and H8, at the measured rates).
10. **Tutor effort and the daily cap.** If Higher needs `medium` effort or more than £0.50 a day per student, is that acceptable?
11. **Beta audience.** A closed Higher cohort by invite code first, or open to every invited student?
12. **Drawing.** Constructions, loci, plans and elevations and bearings need a drawing input on both tiers. Is that a later programme?

### 10.3 Dependencies

- **The Foundation launch** (PLAN.md M10 launch checklist signed) before any Higher student; Higher reuses every gate.
- **Eddy's named safeguarding lead** approving the script and tripwires (`SCRIPT_APPROVED`), and the alert channel. Both tiers wait on this.
- **ZDR with Anthropic**, the DPA and the transfer mechanism (SPEC.md section 10; DPIA R3).
- **Legal review** of the DPIA and notices (a Higher-only change is small, but the stated purpose changes).
- **Spend approval** for every `--live` run and for precompute.
- **Foundation pilot data** to refit BKT parameters (ADR-0026) before Higher's thresholds are trusted.
- **A qualified maths teacher** for the hand checks.
- **The DfE subject content text**, to confirm the Foundation and Higher split for A4 (three binomials), N16 and G8, as M2 recorded.
- **Hosting decision** (ADR-0035 or ADR-0014): no Higher-specific needs, but the load test should run on staging.

---

## 11. English

English is currently a data model only (SPEC.md section 2.2 and 6.6):

- set texts with copyright status and display policy;
- question types;
- level descriptors in our own words;
- Loop 4's output schemas (`ao_scores`, `next_step`, `confidence`) with the agreement metrics (quadratic weighted kappa, exact and adjacent agreement);
- nothing student-facing.

GCSE English is untiered, so nothing in this plan applies to it.

English lessons, marking and any English animations would be their own later programme (PLAN.md lists M11, formative feedback on public-domain extracts). At a headline level it would need:

- **Its own spec and plan.** The maths machinery does not transfer: there is no maths-core equivalent that can prove a mark right, so trust rests on calibration, not verification.
- **A calibration study.** A teacher-marked set of student responses written for Eddy, agreement targets per assessment objective, levels shown only above a confidence threshold (0.7 in PLAN.md M11), and never a definitive grade.
- **Human moderation** of a sample of every release, and an appeal path ("ask your teacher").
- **Texts.** Public-domain extracts in full; in-copyright set texts only as permitted by their display policy; a deterministic check that every quotation in feedback appears verbatim in the extract.
- **A writing interface.** A long-form text editor rather than MathLive, with autosave and accessibility for extended writing.
- **Safety for extended writing.** Essays and creative writing reveal far more than maths answers, so the tripwires and classifiers need English-specific scenarios: dark themes in fiction as benign near-misses, and real disclosures inside an essay. That needs the safeguarding lead's review too.
- **Its own evals.** Marking agreement, feedback quality (specific, kind, one next step), answer-copying and injection inside essays.
- **Cost.** Long inputs make every marked answer several times dearer than a maths turn, with per-student caps to match.
- **Animations, if any.** Annotated extracts (highlighting a technique, then its effect) and paragraph-structure diagrams would be new scene primitives. Their claims would be checked against the extract text rather than by maths-core.
- **Privacy.** DPIA and notice updates for storing essays, and their retention.
- **No exam board material.** None of AQA's, Pearson's or OCR's mark schemes, level wording or papers, as for maths.
