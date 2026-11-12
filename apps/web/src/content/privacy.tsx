/**
 * The privacy notices (SPEC.md section 4.1, Children's Code standard 4): a short one at a
 * reading age of about 12, and the full one. Both are drafts until legal review (SPEC.md
 * section 16.2), and say only what Eddy actually does today. Raise PRIVACY_NOTICE_VERSION in
 * src/lib/notices.ts whenever the meaning changes.
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

export function DraftNote() {
  return (
    <p className="m-0 mb-8 rounded-card border border-l-4 border-rule border-l-field-border bg-paper-raised p-4">
      This notice is a draft while Eddy is in a closed trial. A lawyer will check it before Eddy
      opens to everyone, and we will ask you to read it again if anything important changes.
    </p>
  );
}

/** The short notice: plain words, short sentences. */
export function ChildPrivacyNotice() {
  return (
    <>
      <Section title="What Eddy keeps">
        <ul className="m-0 mb-4 flex flex-col gap-2 pl-6">
          <li>Your email address, so you can sign in.</li>
          <li>The month and year you were born. Never the day.</li>
          <li>Your exam board, target grade and the settings you choose.</li>
          <li>
            Your answers, how sure you felt, the hints you used and the explanations you watched.
          </li>
          <li>The messages you send to the tutor.</li>
        </ul>
        <p className="m-0">
          We do not ask for your name, school, address or phone number. There are no adverts, no
          tracking and we never sell anything about you.
        </p>
      </Section>
      <Section title="Why">
        <p className="m-0 mb-3">
          To teach you: to choose your next question, spot which idea tripped you up, and show you
          an explanation made for that mistake.
        </p>
        <p className="m-0">To keep you safe, and to keep Eddy working and secure.</p>
      </Section>
      <Section title="The AI that writes Eddy's replies">
        <p className="m-0">
          Eddy uses an AI model called Claude, made by a company called Anthropic. Some of your
          answers and messages go to Claude so it can write a reply. We never send your email or
          anything else that says who you are. Eddy only sends anything once Anthropic has agreed
          not to keep it or use it to train their AI.
        </p>
      </Section>
      <Section title="If we are worried about you">
        <p className="m-0">
          If you write something that makes us worried about your safety, Eddy stops the lesson and
          shows you who can help. A person at Eddy who is trained to keep young people safe may read
          what you wrote. We do not tell your parents automatically.
        </p>
      </Section>
      <Section title="Parents">
        <p className="m-0">
          A parent or carer can only see your progress if you give them a code and then say yes.
          While they can, you always see a note saying so, and you can see exactly what they see.
          They see topics secured, time spent and reviews due, never your messages or answers. You
          can stop it at any time, and they are told.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p className="m-0">
          Messages with the tutor are deleted after 90 days. If you delete your account, we remove
          everything about you within 30 days. Records of safety worries are kept for longer, so we
          can show we acted.
        </p>
      </Section>
      <Section title="What you can do">
        <p className="m-0 mb-3">
          In Settings you can see and download everything we hold about you, or delete your account.
          Signed in, you can also ask us about your data, or tell us if something is wrong, with
          Report a concern.
        </p>
        <p className="m-0">
          If you are not happy with how we answer, you can complain to the Information
          Commissioner&apos;s Office (ICO), which looks after data rights in the UK, at ico.org.uk
          or on 0303 123 1113.
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
export function FullPrivacyNotice() {
  return (
    <>
      <Section title="Who we are">
        <p className="m-0">
          Eddy is a GCSE Maths tutor, in a closed trial. The organisation responsible for your data
          (the controller), and the contact for privacy questions, will be named here before Eddy
          opens to everyone. Until then, signed-in students can use Report a concern at the foot of
          any page.
        </p>
      </Section>
      <Section title="The data we hold">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>Account: email address, the invite code you joined with, and when you joined.</li>
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
            Tutor: your messages to the tutor and its replies, and records of any safety concern.
          </li>
          <li>
            Service: sign-in sessions, an audit log of important actions (such as joining, reading
            this notice or asking to delete your account), and technical logs.
          </li>
        </ul>
      </Section>
      <Section title="What we use it for, and why we may">
        <p className="m-0 mb-3">
          We use your data to provide the tutoring you asked for, to keep you safe, and to keep Eddy
          secure and working. Our proposed lawful basis is legitimate interests, weighed against
          your interests and rights, with extra care because many users are under 18. This is being
          reviewed by a lawyer.
        </p>
        <p className="m-0">
          We do not use your data for advertising, we do not sell it, and Eddy makes no decisions
          about you with legal or similarly significant effects. Its estimates of what you know only
          choose your next question.
        </p>
      </Section>
      <Section title="Who else handles it">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>
            Anthropic, which provides the Claude AI model. It receives the parts of your answers and
            messages needed to write a reply, with a random id instead of anything that identifies
            you. Eddy only sends data once Anthropic has confirmed zero data retention and no
            training on it.
          </li>
          <li>
            Our hosting and email providers, which store and send data for us under contract. They
            will be listed here before Eddy opens to everyone.
          </li>
        </ul>
      </Section>
      <Section title="Parents and carers">
        <p className="m-0">
          A student can give a parent or carer a code. A parent who uses it gives us their email
          address and confirms they are the student&apos;s parent or carer and an adult. Nothing is
          shared until the student accepts. A linked parent sees topics secured, time spent this
          week, the dates of recent lessons and reviews due, and each view is recorded. They never
          see messages, answers or safety records. Either side can end the link, and the other is
          told by email.
        </p>
      </Section>
      <Section title="Safety">
        <p className="m-0">
          If something you write suggests you may be at risk, the lesson stops and you are shown who
          can help (Childline, Shout and 999). A short extract is recorded for Eddy&apos;s trained
          safeguarding lead to review. Parents are not told automatically, because that is not
          always safe. In a serious emergency we may share information with services that can help,
          as the law allows.
        </p>
      </Section>
      <Section title="How long we keep it">
        <ul className="m-0 flex flex-col gap-2 pl-6">
          <li>Tutor messages: deleted after 90 days.</li>
          <li>
            Your account and learning data: while you use Eddy. When you ask to delete your account
            it stops working straight away, and your data is erased within 30 days.
          </li>
          <li>
            Safety records and the audit log: kept longer, to show we acted properly. The exact
            periods are being set in our data protection impact assessment and will be listed here.
          </li>
          <li>Sign-in links: work once and expire after 30 minutes.</li>
        </ul>
      </Section>
      <Section title="Your rights">
        <p className="m-0 mb-3">
          You can ask for a copy of your data, ask us to correct it, delete it, or limit or object
          to how we use it. Downloading your data and deleting your account are in Settings, two
          clicks from any page. For anything else, use Report a concern while signed in.
        </p>
        <p className="m-0">
          You can complain to the Information Commissioner&apos;s Office at ico.org.uk or on 0303
          123 1113.
        </p>
      </Section>
    </>
  );
}
