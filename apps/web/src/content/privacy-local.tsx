/**
 * The desktop app's privacy notices (ADR-0036): a short one at a reading age of about 12, and the
 * full one. Eddy on a computer keeps everything on that computer and sends nothing anywhere, so
 * these say something different from the online notices in `privacy.tsx`. Both are drafts until
 * legal review (SPEC.md section 16.2), and say only what Eddy actually does today. Raise
 * LOCAL_PRIVACY_NOTICE_VERSION in src/lib/notices.ts whenever the meaning changes.
 *
 * The desktop app ships with typed chat off: a student answers questions and asks for hints, and
 * never types a message to the tutor. So there is no AI model at work, nothing typed is stored,
 * and a lesson is never stopped to show the help message. If typed chat is ever switched on
 * (`typed_chat_enabled` in services/api), these notices must say so first: version 0.3.0 in the
 * git history has the wording for messages, the built-in model and safety notes.
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
          <li>Your PIN, if you set one, scrambled so that nobody can read it.</li>
        </ul>
        <p className="m-0">
          Eddy does not ask for your email, school, address or phone number. You answer maths
          questions and ask for hints. There is nowhere to type a message.
        </p>
      </Section>
      <Section title="Why">
        <p className="m-0">
          To teach you: to choose your next question, spot which idea tripped you up, and show you
          an explanation made for that mistake.
        </p>
      </Section>
      <Section title="No AI is listening">
        <p className="m-0">
          Eddy&apos;s hints and explanations were written in advance. No AI model runs while you use
          Eddy, and no AI company sees anything you do.
        </p>
      </Section>
      <Section title="If you are worried about something">
        <p className="m-0">
          Eddy only does maths, and it cannot tell anyone anything. If something is worrying you,
          the people at the bottom of every page are there to listen, or you can talk to an adult
          you trust.
        </p>
      </Section>
      <Section title="Other people who use this computer">
        <p className="m-0 mb-3">
          Each person has their own profile. Without a PIN, anyone who uses this computer can open
          your profile and see your answers and progress. A PIN stops them opening it from the list.
          Choose Switch profile when you finish.
        </p>
        <p className="m-0">
          A PIN is a simple lock, not a safe. A person who can sign in to this computer could still
          find Eddy&apos;s files, with or without your PIN. Eddy cannot show or reset a PIN: if you
          forget it, the profile cannot be opened again.
        </p>
      </Section>
      <Section title="How long Eddy keeps it">
        <p className="m-0 mb-3">
          Eddy keeps your profile until you delete it. When a profile is deleted, Eddy erases its
          answers, progress and settings. Eddy can only do this tidying while it is open.
        </p>
        <p className="m-0">
          One thing stays on this computer after a profile is deleted: a plain list of actions, such
          as when a profile was made or opened, without your profile name. You cannot see or delete
          it from inside Eddy.
        </p>
      </Section>
      <Section title="What you can do">
        <p className="m-0">
          In Settings you can see and download what Eddy holds in your profile, or delete the
          profile. The list of actions is not in the download.
        </p>
        <p className="m-0 mt-3">
          A copy you download is an ordinary file. It stays where you saved it until you delete it
          yourself.
        </p>
      </Section>
      <Section title="If Eddy is removed from this computer">
        <p className="m-0">
          Removing Eddy does not delete your work. It stays on this computer until someone deletes
          it. The full privacy notice says how.
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
          Eddy is finished.
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
            Lessons: the hints and feedback Eddy showed you. You do not type messages to Eddy, so
            none are kept.
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
          Nobody. Eddy&apos;s hints and explanations were written in advance and are part of the
          program. No AI model runs while Eddy is in use, and no answer or other data is sent to any
          company or server.
        </p>
      </Section>
      <Section title="Safety">
        <p className="m-0">
          Eddy takes no free text, so it cannot notice that someone is at risk, and it cannot tell
          anyone anything. Every page shows who to contact (Childline, Shout and 999). Nobody
          reviews what happens in Eddy.
        </p>
      </Section>
      <Section title="Sharing a computer">
        <p className="m-0">
          Profiles keep each person&apos;s work apart. Without a PIN, anyone using Eddy can open a
          profile and see its answers and progress. An optional PIN stops a profile being opened
          from the list, until its owner chooses Switch profile or closes Eddy. The data is stored
          in the files of the Windows account Eddy was installed in. Anyone who can sign in to that
          account, or to an administrator account, could reach those files, so a PIN is not strong
          protection.
        </p>
      </Section>
      <Section title="How long it is kept">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>
            The hints and feedback shown in lessons: deleted after 90 days. Eddy does this tidying
            while it is running, so it happens the next time Eddy is opened after that.
          </li>
          <li>
            A profile and its learning data: until you delete the profile. It stops working straight
            away, and its answers, progress and settings are erased the next time Eddy is running.
          </li>
          <li>
            The log of important actions: kept, and cannot be changed. It holds a profile&apos;s
            internal number, the action and the time, never a name or anything you wrote.
          </li>
        </ul>
      </Section>
      <Section title="Your choices">
        <p className="m-0 mb-3">
          Downloading your data and deleting your profile are in Settings, two clicks from any page.
          The download holds everything in your profile except the log of actions.
        </p>
        <p className="m-0">
          A PIN cannot be recovered. A profile whose PIN is forgotten cannot be opened, downloaded
          or deleted from inside Eddy.
        </p>
        <p className="m-0 mt-3">
          A copy of your data that you download is an ordinary file wherever you saved it. Eddy does
          not keep track of it or delete it.
        </p>
      </Section>
      <Section title="Removing Eddy from the computer">
        <p className="m-0 mb-3">
          Removing Eddy in Windows Settings, under Apps, removes the program. It does not remove the
          profiles or their work, which stay in the files of the Windows account.
        </p>
        <p className="m-0">
          To remove those too, close Eddy, type %LOCALAPPDATA% into the address bar of File
          Explorer, and delete the folder named Eddy. That deletes every profile on the computer and
          the log of actions, and it cannot be undone. It is also the only way to remove a profile
          whose PIN is forgotten.
        </p>
      </Section>
    </>
  );
}
