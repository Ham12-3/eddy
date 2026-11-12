# Screen reader checklist (M8)

For you to run with NVDA (Windows, Firefox or Chrome) and VoiceOver (iPhone Safari, and macOS Safari if available). Use a fresh invite code from `python -m eddy_api.invites`, and read sign-in emails in Mailpit at http://127.0.0.1:8025. Note the screen reader, browser and anything that was confusing, silent or read twice.

## Every page

- [ ] "Skip to content" is the first thing reached, and it moves to the page's heading.
- [ ] The page title (the browser tab) names the page, such as "Today | Eddy".
- [ ] There is one level 1 heading, and the headings list makes sense on its own.
- [ ] The footer's "Report a concern", "Privacy notice" and the Childline, Shout and 999 line are read.

## Sign-up

- [ ] Invite code: the label and hint are read; a wrong code reads its error, and focus stays on the field.
- [ ] Age: "When were you born?" is read as the group's name, with Month and Year as labelled lists. Nothing mentions an age limit.
- [ ] Under 13 (use a recent year): the stop page is read in full and makes sense without seeing it.
- [ ] Email, then "Check your email": the next step is clear.

## Onboarding

- [ ] Privacy notice: the sections read in order, and "I have read this" is a button.
- [ ] Set-up: each radio group reads its question, its hint and the choice made; "Higher, coming later" is read as unavailable.
- [ ] Display options: each checkbox reads its label and hint.

## Diagnostic and lessons

- [ ] The question is read, with its maths spoken sensibly (for example "negative 11").
- [ ] The maths field reads its label and hint; what you type is echoed back.
- [ ] "How sure are you?" reads as a group of four radios.
- [ ] After "Check my answer", the result ("That is right" or "Not this time") is announced without moving focus.
- [ ] "Eddy is writing" is announced while waiting, and Eddy's reply is announced when it arrives.
- [ ] A scene: its Play, step and Captions controls are buttons with names, and the captions can be read.
- [ ] "Ask Eddy": the message box has a label; "I am stuck: give me a hint" is a button.

## Review, progress and settings

- [ ] Review: the empty state, or the list of due ideas, is read.
- [ ] Progress: each idea reads its name and its state ("Secure", "Learning") in words.
- [ ] Settings: saving reads "Saved."; "Type DELETE to confirm" reads its label and any error.
- [ ] Report a concern: the result "Thank you, we have your report" is announced.
