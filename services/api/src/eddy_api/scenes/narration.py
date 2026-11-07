"""Narration checks repeated in Python (ADR-0028's list before M6, SPEC.md section 7.2 step 3).

The scene engine already checks word counts, dashes, tone words and focus ids; services/api
checks model narration again before it is stored, and adds what only matters for model-written
text. `reference` is the reviewed Tier D narration for the same item, and `seen` the versions this
student has already watched.

- At most 25 words a beat, counted across zero-width spaces too.
- No dash (U+2012 to U+2015), control or invisible character, and NFC form.
- Tone: no blame or gushing words, no exclamation marks, no emoji; nothing about the student's
  confidence, earlier attempts or exams (a variant may be shown to other students too).
- UK spelling and GCSE words, and money in pounds and pence.
- Numbers in digits: a number word, a superscript or a vulgar fraction only where the reviewed
  narration uses it, because maths-core traces digits.
- A reading age of 13 or below (Flesch-Kincaid grade 8 or below, as UK reading age is about the
  US grade plus 5), and no harder than the reviewed scene by more than 2 grades; each beat ends a
  sentence, no single beat reads above grade 10, and taught maths words count as two syllables.
- Nothing that looks like personal data: an email address, a web address or a phone number.
- Different from what the student has seen: no more than half the beats may share a run of
  eight words with an earlier version.
"""

import re
import unicodedata
from collections.abc import Sequence

MAX_WORDS = 25
MAX_GRADE = 8.0
MIN_GRADE_ALLOWANCE = 5.0
GRADE_MARGIN = 2.0
MAX_BEAT_GRADE = 10.0
SHARED_RUN = 8
DASHES = re.compile(f"[{chr(0x2012)}-{chr(0x2015)}]")
ZERO_WIDTH = re.compile("[" + "".join(map(chr, (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF))) + "]")
APOSTROPHES = "'" + chr(0x2019)
# The same list as packages/schemas TONE_WORDS.
TONE_WORDS = (
    "wrong",
    "careless",
    "easy",
    "simple",
    "just",
    "obviously",
    "silly",
    "forgot",
    "should have",
    "well done",
    "great job",
    "amazing",
    "brilliant",
    "don't worry",
)
# A cached variant may reach other students: say nothing about this one's history or feelings.
HISTORY_WORDS = (
    "confident",
    "confidence",
    "unsure",
    "you were sure",
    "you felt",
    "slip again",
    "mistake again",
    "this slip before",
    "last time",
    "second time",
    "exam",
    "exams",
    "grade",
)
US_SPELLINGS = {
    "math": "maths",
    "color": "colour",
    "colors": "colours",
    "colored": "coloured",
    "center": "centre",
    "centers": "centres",
    "centered": "centred",
    "meter": "metre",
    "meters": "metres",
    "centimeter": "centimetre",
    "centimeters": "centimetres",
    "millimeter": "millimetre",
    "millimeters": "millimetres",
    "kilometer": "kilometre",
    "kilometers": "kilometres",
    "liter": "litre",
    "liters": "litres",
    "gray": "grey",
    "favorite": "favourite",
    "behavior": "behaviour",
    "neighbor": "neighbour",
    "neighbors": "neighbours",
    "labeled": "labelled",
    "labeling": "labelling",
    "modeling": "modelling",
    "traveled": "travelled",
    "totaled": "totalled",
    "totaling": "totalling",
    "equaled": "equalled",
    "equaling": "equalling",
    "fulfill": "fulfil",
    "slope": "gradient",
    "trapezoid": "trapezium",
    "parentheses": "brackets",
    "pythagorean": "Pythagoras'",
    "pemdas": "BIDMAS",
    "percent": "per cent",
}
US_PHRASES = {
    "least common multiple": "lowest common multiple",
    "greatest common factor": "highest common factor",
    "greatest common divisor": "highest common factor",
    "plug in": "substitute",
}
# -ize and -yze words are US spellings, except these.
IZE_ALLOWED = {"size", "sizes", "sized", "prize", "prizes", "seize", "capsize", "resize"}
# "one", "once" and "two" are left out: they are far more often a pronoun or a count of what is
# drawn ("which one", "the two sides") than a stated value, and maths-core traces every digit.
NUMBER_WORDS = {
    "zero", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "half", "halves", "quarter", "quarters", "third", "thirds",
    "double", "twice", "triple",
}  # fmt: skip
# GCSE words a student is taught and must hear: the reading-age formula counts them as two
# syllables rather than penalising the exact word the maths needs.
MATHS_WORDS = {
    "numerator", "numerators", "denominator", "denominators", "probability", "probabilities",
    "perpendicular", "hypotenuse", "equivalent", "multiply", "multiplying", "multiplied",
    "multiplication", "independent", "interior", "alternate", "parallelogram", "rectangle",
    "rectangles", "triangle", "triangles", "diagonal", "horizontal", "vertical", "gradient",
    "coordinate", "coordinates", "decimal", "decimals", "percentage", "percentages",
    "proportion", "translation", "translated", "negative", "positive", "calculation", "median",
    "average", "ordinary", "standard", "variable", "equation", "equations", "subtracting",
    "dividing", "division", "fraction", "fractions", "simplifies", "simplify", "original",
    "hundredths", "thousandths", "ratio", "triangular", "area", "areas", "angles", "vector",
}  # fmt: skip
WORD = re.compile(r"[A-Za-z]+(?:['" + chr(0x2019) + r"][a-z]+)?")
EMAIL = re.compile(r"\S+@\S+")
WEB = re.compile(r"(https?://|www\.)", re.IGNORECASE)
# A UK phone number: 0 or +44, then 9 or 10 more digits, with or without spaces.
PHONE = re.compile(r"(?<![\d.])(?:\+44\s?|0)\d(?:\s?\d){8,9}(?![\d.])")
CURRENCY = re.compile(r"\$|\b(dollars?|cents?)\b", re.IGNORECASE)


def _phrases(words: Sequence[str]) -> re.Pattern[str]:
    alternatives = "|".join(w.replace("'", f"[{APOSTROPHES}]") for w in words)
    return re.compile(rf"\b({alternatives})\b", re.IGNORECASE)


TONE = _phrases(TONE_WORDS)
HISTORY = _phrases(HISTORY_WORDS)
PHRASES = _phrases(tuple(US_PHRASES))


def words(text: str) -> list[str]:
    return [w for w in ZERO_WIDTH.sub(" ", text).split() if w]


def _syllables(word: str) -> int:
    word = word.lower()
    if word in MATHS_WORDS:
        return 2
    count = len(re.findall(r"[aeiouy]+", word))
    if word.endswith("e") and not word.endswith(("le", "ee")) and count > 1:
        count -= 1
    return max(count, 1)


def _as_sentences(lines: Sequence[str]) -> str:
    """Each beat ends a sentence, whether or not it ends with a full stop."""
    return " ".join(line if re.search(r"[.!?]\s*$", line) else f"{line}." for line in lines)


def grade(text: str) -> float:
    """Flesch-Kincaid grade of plain text; numbers count as one-syllable words."""
    sentences = max(len(re.findall(r"[.!?]+(?:\s|$)", text)), 1)
    tokens = words(text)
    if not tokens:
        return 0.0
    syllables = sum(_syllables(m.group()) if (m := WORD.search(t)) else 1 for t in tokens)
    return 0.39 * len(tokens) / sentences + 11.8 * syllables / len(tokens) - 15.59


def scene_grade(lines: Sequence[str]) -> float:
    return grade(_as_sentences(lines))


def _runs(text: str) -> set[tuple[str, ...]]:
    tokens = [t.lower() for t in WORD.findall(text)]
    return {tuple(tokens[i : i + SHARED_RUN]) for i in range(len(tokens) - SHARED_RUN + 1)}


def _too_close(lines: Sequence[str], version: Sequence[str]) -> bool:
    """More than half the beats repeat a run of eight words from an earlier version."""
    earlier = set().union(*(_runs(line) for line in version)) if version else set()
    shared = sum(1 for line in lines if _runs(line) & earlier)
    return bool(lines) and shared > len(lines) / 2


def _line_problems(i: int, line: str, reference_words: set[str], reference: str) -> list[str]:
    problems: list[str] = []
    count = len(words(line))
    if count > MAX_WORDS:
        problems.append(f"Beat {i}: {count} words; at most {MAX_WORDS}.")
    if DASHES.search(line):
        problems.append(f"Beat {i}: contains a dash. Use a full stop or a comma instead.")
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in line):
        problems.append(f"Beat {i}: contains a control or invisible character.")
    if unicodedata.normalize("NFC", line) != line:
        problems.append(f"Beat {i}: is not in Unicode NFC form.")
    if tone := TONE.search(line):
        problems.append(f'Beat {i}: says "{tone.group(1)}". Name the slip, never the student.')
    if "!" in line:
        problems.append(f"Beat {i}: has an exclamation mark.")
    if any(unicodedata.category(c) == "So" and c != chr(0xB0) for c in line):
        problems.append(f"Beat {i}: has an emoji or picture symbol.")
    if history := HISTORY.search(line):
        problems.append(
            f'Beat {i}: says "{history.group(1)}". Never mention the student\'s confidence, '
            "earlier attempts or exams: other students may see this version."
        )
    for word in WORD.findall(line):
        lower = word.lower()
        uk = US_SPELLINGS.get(lower)
        if uk:
            problems.append(f'Beat {i}: write "{uk}", not "{word}" (UK English).')
        elif re.search(r"(ize|izes|ized|izing|yze|yzes|yzed)$", lower) and (
            lower not in IZE_ALLOWED
        ):
            problems.append(f'Beat {i}: use the -ise or -yse spelling, not "{word}" (UK English).')
        if lower in NUMBER_WORDS and lower not in reference_words:
            problems.append(
                f'Beat {i}: write "{word}" in digits, as the reviewed scene writes its numbers.'
            )
    for phrase in PHRASES.finditer(line):
        problems.append(
            f'Beat {i}: write "{US_PHRASES[phrase.group(1).lower()]}", not "{phrase.group(1)}".'
        )
    # A superscript or vulgar fraction after a digit is a number the trace cannot read (10 to
    # the 3, a half); after a letter it is part of a unit (cm squared), which is fine.
    numeric = {m.group(1) for m in re.finditer(r"(?<![A-Za-z])(\S)", line)}
    for char in {c for c in numeric if unicodedata.category(c) == "No"}:
        if char not in reference:
            problems.append(
                f'Beat {i}: write "{char}" the way the reviewed scene writes numbers and powers.'
            )
    if CURRENCY.search(line):
        problems.append(f"Beat {i}: money is in pounds and pence.")
    if EMAIL.search(line) or WEB.search(line) or PHONE.search(line):
        problems.append(f"Beat {i}: looks like it contains personal or contact details.")
    if count >= 8 and scene_grade([line]) > MAX_BEAT_GRADE:
        problems.append(f"Beat {i}: is too hard to read; use shorter, everyday words.")
    return problems


def narration_problems(
    lines: Sequence[str],
    *,
    reference: Sequence[str] = (),
    seen: Sequence[Sequence[str]] = (),
) -> list[str]:
    """Problems as sentences, for Claude's feedback. Empty when every line passes."""
    reference_text = " ".join(reference)
    reference_words = {w.lower() for w in WORD.findall(reference_text)}
    problems: list[str] = []
    for i, line in enumerate(lines, start=1):
        problems += _line_problems(i, line, reference_words, reference_text)
    ceiling = MAX_GRADE
    if reference:
        ceiling = min(MAX_GRADE, max(scene_grade(reference) + GRADE_MARGIN, MIN_GRADE_ALLOWANCE))
    level = scene_grade(lines)
    if lines and level > ceiling:
        problems.append(
            f"The narration reads at about UK reading age {level + 5:.0f}; keep it at "
            f"{ceiling + 5:.0f} or below with shorter sentences and everyday words."
        )
    for version in seen:
        if _too_close(lines, version):
            problems.append(
                "This version is too close to one the student has already seen: more than half "
                "of its beats repeat eight words in a row. Find a different way in."
            )
            break
    return problems
