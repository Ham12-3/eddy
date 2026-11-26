/**
 * The desktop app's privacy notices (ADR-0036): a short one at a reading age of about 12, and the
 * full one. Eddy on a computer keeps everything on that computer and sends nothing anywhere, so
 * these say something different from the online notices in `privacy.tsx`. Both are drafts until
 * legal review (SPEC.md section 16.2), and say only what Eddy actually does today. Raise
 * LOCAL_PRIVACY_NOTICE_VERSION in src/lib/notices.ts whenever the meaning changes.
 */
import { linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import type { ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="m-0 mb-3 text-h3">{title}</h2>
      {children}
    </section>
  );
}

export function LocalDraftNote() {
  return (
    <p className="m-0 mb-8 rounded-card border border-l-4 border-rule border-l-field-border bg-paper-raised p-4">
      This notice is a draft, and this copy of Eddy is a test version. A lawyer will check the
      notice before Eddy is finished, and Eddy will ask you to read it again if anything important
      changes.
    </p>
  );
}

/** The short notice: plain words, short sentences. */
export function LocalChildPrivacyNotice() {
  return (
    <>
      <Section title="Where your work is kept">
        <p className="m-0 mb-3">
          On this computer, and nowhere else. Eddy does not use the internet. Nothing you do in Eddy
          is sent to the people who made it, or to anyone else.
        </p>
        <p className="m-0">There are no adverts and no tracking.</p>
      </Section>
      <Section title="What Eddy keeps">
        <ul className="m-0 mb-4 flex flex-col gap-2 pl-6">
          <li>The name you gave your profile.</li>
          <li>The month and year you were born. Never the day.</li>
          <li>Your exam board, target grade and the settings you choose.</li>
          <li>
            Your answers, how sure you felt, the hints you used and the explanations you watched.
          </li>
          <li>The messages you send to the tutor.</li>
          <li>Your PIN, if you set one, scrambled so that nobody can read it.</li>
        </ul>
        <p className="m-0">Eddy does not ask for your email, school, address or phone number.</p>
      </Section>
      <Section title="Why">
        <p className="m-0">
          To teach you: to choose your next question, spot which idea tripped you up, and show you
          an explanation made for that mistake.
        </p>
      </Section>
      <Section title="The AI that writes Eddy's replies">
        <p className="m-0">
          A small AI model is built into Eddy and runs on this computer. Your messages go to it and
          no further. No AI company sees them.
        </p>
      </Section>
      <Section title="If Eddy stops a lesson to show you help">
        <p className="m-0 mb-3">
          If you write something that sounds as if you might not be safe, Eddy stops the lesson and
          shows you who can help.
        </p>
        <p className="m-0 mb-3">
          Eddy does not tell anyone. No teacher, parent or other person gets a message, and nobody
          reads what you wrote. Eddy cannot get help for you. So please contact the people Eddy
          shows you, or talk to an adult you trust.
        </p>
        <p className="m-0 mb-3">
          Eddy saves a short note on this computer, with a few of the words you wrote.
        </p>
        <p className="m-0">
          Eddy sometimes gets this wrong and stops over a joke or a saying. If that happens, you are
          not in trouble and nobody is told.
        </p>
      </Section>
      <Section title="Other people who use this computer">
        <p className="m-0 mb-3">
          Each person has their own profile. Without a PIN, anyone who uses this computer can open
          your profile and read your messages. A PIN stops them opening it from the list. Choose
          Switch profile when you finish.
        </p>
        <p className="m-0 mb-3">
          A PIN is a simple lock, not a safe. A person who can sign in to this computer could still
          find Eddy&apos;s files, with or without your PIN. Eddy cannot show or reset a PIN: if you
          forget it, the profile cannot be opened again.
        </p>
        <p className="m-0">
          If there is something you do not want people at home to read, Eddy is not a safe place to
          write it. The people at the bottom of every page are there to listen.
        </p>
      </Section>
      <Section title="How long Eddy keeps it">
        <p className="m-0 mb-3">
          Eddy deletes your messages with the tutor after 90 days. When a profile is deleted, Eddy
          erases its answers, messages and settings. Eddy can only do this tidying while it is open.
        </p>
        <p className="m-0">
          Two things stay on this computer after a profile is deleted. One is the short note from
          any lesson Eddy stopped, with a few of your words but not your profile name. The other is
          a plain list of actions, such as when a profile was made or opened. You cannot see or
          delete these from inside Eddy.
        </p>
      </Section>
      <Section title="What you can do">
        <p className="m-0">
          In Settings you can see and download what Eddy holds in your profile, or delete the
          profile. The short notes and the list of actions are not in the download.
        </p>
      </Section>
      <p className="m-0">
        <NextLink href="/privacy/full" className={linkClassName}>
          Read the full privacy notice
        </NextLink>
      </p>
    </>
  );
}

/** The full notice. */
export function LocalFullPrivacyNotice() {
  return (
    <>
      <Section title="What this is">
        <p className="m-0">
          Eddy is a GCSE Maths tutor that runs on one computer. It does not connect to the internet
          and has no accounts. The people who made Eddy receive nothing from it and hold no data
          about you. Who is responsible for Eddy, and how to contact them, will be named here before
          Eddy is given to students.
        </p>
      </Section>
      <Section title="The data kept on this computer">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>
            Profile: the name you chose, when the profile was made, and a scrambled PIN if set.
          </li>
          <li>
            Age: month and year of birth only, to check you are old enough and to know your school
            year.
          </li>
          <li>
            Set-up: exam board, tier, exam series, target grade, whether you are resitting, and your
            accessibility and display settings.
          </li>
          <li>
            Learning: every answer you give, how sure you said you were, hints used, time taken, the
            explanations you watched, and what Eddy estimates you know.
          </li>
          <li>
            Tutor: your messages to the tutor and its replies, and a note of any safety concern.
          </li>
          <li>
            A log of important actions (such as making a profile, reading this notice or deleting a
            profile), which records what happened but never what you wrote.
          </li>
        </ul>
      </Section>
      <Section title="What it is used for">
        <p className="m-0">
          Only to tutor you. Eddy makes no decisions about you with legal or similarly significant
          effects: its estimates of what you know only choose your next question. There is no
          advertising, and nothing is sold or shared.
        </p>
      </Section>
      <Section title="Who else handles it">
        <p className="m-0">
          Nobody. The AI model that writes Eddy&apos;s replies is part of the program and runs on
          this computer. No message, answer or other data is sent to any company or server.
        </p>
      </Section>
      <Section title="Safety">
        <p className="m-0">
          If something you write suggests you may be at risk, the lesson stops and you are shown who
          can help (Childline, Shout and 999). A record is kept on this computer with a short
          extract of what you wrote. Because Eddy sends nothing anywhere, no person reviews it and
          nobody is told. Eddy cannot get help for you: please contact the services shown, or an
          adult you trust.
        </p>
      </Section>
      <Section title="Sharing a computer">
        <p className="m-0">
          Profiles keep each person&apos;s work apart. Without a PIN, anyone using Eddy can open a
          profile and read its messages. An optional PIN stops a profile being opened from the list,
          until its owner chooses Switch profile or closes Eddy. The data is stored in the files of
          the Windows account Eddy was installed in. Anyone who can sign in to that account, or to
          an administrator account, could reach those files, so a PIN is not strong protection.
        </p>
      </Section>
      <Section title="How long it is kept">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>
            Tutor messages: deleted after 90 days. Eddy does this tidying while it is running, so it
            happens the next time Eddy is opened after that.
          </li>
          <li>
            A profile and its learning data: until you delete the profile. It stops working straight
            away, and its answers, messages and settings are erased within 30 days, the next time
            Eddy is running.
          </li>
          <li>
            Records of safety concerns: kept on this computer after a profile is deleted, without
            the profile name, with their short extract. Whether they should be erased too is being
            decided.
          </li>
          <li>
            The log of important actions: kept, and cannot be changed. It holds a profile&apos;s
            internal number, the action and the time, never a name or anything you wrote.
          </li>
          <li>
            Technical records of each reply the AI model wrote (when, and how long it took), with no
            link to a profile once it is deleted.
          </li>
        </ul>
      </Section>
      <Section title="Your choices">
        <p className="m-0 mb-3">
          Downloading your data and deleting your profile are in Settings, two clicks from any page.
          The download holds everything in your profile except records of safety concerns and the
          log of actions.
        </p>
        <p className="m-0">
          A PIN cannot be recovered. A profile whose PIN is forgotten cannot be opened, downloaded
          or deleted from inside Eddy.
        </p>
      </Section>
    </>
  );
}
