# Screen reader checklist (design system)

Automated checks (axe, Playwright) cannot hear what a screen reader says. Run this by hand against Storybook before a release, and after any change to MathField, Dialog, Toast, Feedback or the player controls.

**Set-up:** `pnpm storybook`, then open http://127.0.0.1:6006. Use each story's "Open canvas in new tab" button so only the story is on the page.

**Screen readers:** NVDA with Chrome on Windows (most students), VoiceOver with Safari on macOS, and VoiceOver with Safari on an iPhone (phones are the main device for many students).

Record each result in the table at the end, with the date and any wording that was wrong.

## 1. Maths answer field (Learning / Math Input, Math Input With Error)

1. Tab to the field. You should hear the name "Your answer", the hint "Type / for a fraction, ^ for a power.", and that it is an edit field.
2. Type `1/2`. You should hear the maths spoken as a fraction (for example "one half" or "1 over 2"), not "slash".
3. Press Backspace until it is empty. You should hear each deletion.
4. In "Math Input With Error", Tab to the field. You should hear that it is invalid, and the error "Check the denominators."
5. On iPhone, tap the field. The on-screen Foundation keyboard (digits, fraction, power, root, units, £) appears, and each key is announced with a sensible name.

## 2. Dialog and sheet (Structure / Dialog And Sheet)

1. Open the dialog with Enter. You should hear "Good place to stop", "dialog", and the description "You have practised for 25 minutes."
2. Tab repeatedly. Focus never reaches the page behind the dialog. After the last control it may move to the browser's own toolbar (native dialog behaviour), and the next Tab brings it back into the dialog.
3. Press Escape. The dialog closes and focus is back on "Open dialog".
4. Repeat with the sheet.

## 3. Toggle, confidence picker and tabs (Structure / Forms, Learning / Confidence, Structure / Topic Tabs)

1. The "Reduce motion" switch is announced once as "Reduce motion, switch, off", then its description. Space turns it on.
2. "How sure are you?" is announced as a group of four radio buttons. Arrow keys move between them.
3. Topic tabs: arrow keys move between tabs, and the panel's text is read on Tab.

## 4. Feedback and toasts (Learning / Learning Step, Structure / Toasts)

1. When feedback appears inside a live region after an action, it is read out without moving focus.
2. Press "Save" in Toasts. "Saved. Your next review is on Thursday." is read out. While focus is on the toast's dismiss button, it does not disappear.

## 5. Explanation player (Player / Controls)

1. Each control has a clear name: "Replay from the start", "Previous step", "Play", "Next step".
2. The speed buttons read as "0.75x", "1x" and "1.25x" inside "Playback speed", and say which is pressed.
3. "Captions" and "Transcript" say whether they are pressed. Stepping announces "Step N of 6".

## Results

| Date | Screen reader and browser | Section | Pass or problem | Notes |
|---|---|---|---|---|
| | | | | |
