// Branded layouts for letters, guides and slides. Used on screen, in print and in the slideshow.
import type { CSSProperties } from "react";
import type {
  BrandSettings,
  CardsContent,
  ConsentContent,
  FaqContent,
  GuideContent,
  LetterContent,
  MouthContent,
  Slide,
  TimelineContent,
} from "../../../shared/types";
import { api } from "../lib/api";
import { contactLine, fullName } from "../lib/brand";

const brandStyle = (b: BrandSettings) => ({ "--brand": b.brandColour }) as CSSProperties;
const lines = (text: string) => text.split(/\n/).map((l) => l.trim()).filter(Boolean);

function BrandMark({ brand }: { brand: BrandSettings }) {
  return (
    <div className="mark">
      {brand.logo && <img className="mark-logo" src={api.logoUrl(brand.logo)} alt="" />}
      <div>
        <div className="mark-name">{brand.displayName}</div>
        {(brand.qualifications || brand.practiceName) && (
          <div className="mark-sub">{[brand.qualifications, brand.practiceName].filter(Boolean).join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

export function LetterPaper({
  brand,
  content,
  patientName,
  date = new Date(),
}: {
  brand: BrandSettings;
  content: LetterContent;
  patientName: string;
  date?: Date;
}) {
  return (
    <article className="paper letter" style={brandStyle(brand)}>
      <header className="letterhead">
        <BrandMark brand={brand} />
        <address>
          {lines(brand.address).map((l, i) => (
            <span key={i}>{l}</span>
          ))}
          {brand.phone && <span>{brand.phone}</span>}
          {brand.email && <span>{brand.email}</span>}
        </address>
      </header>
      <p className="letter-date">{date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      <p>Dear {patientName.trim() || "[patient name]"},</p>
      {content.subject && <p className="letter-subject">{content.subject}</p>}
      {content.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p>{brand.signOff || "Kind regards"},</p>
      <div className="signature-space" />
      <p>
        <strong>{brand.displayName}</strong>
        {brand.qualifications && (
          <>
            <br />
            {brand.qualifications}
          </>
        )}
        {brand.gdcNumber && (
          <>
            <br />
            GDC {brand.gdcNumber}
          </>
        )}
      </p>
      <footer className="paper-footer">{contactLine(brand)}</footer>
    </article>
  );
}

export function GuidePaper({ brand, content }: { brand: BrandSettings; content: GuideContent }) {
  return (
    <article className="paper guide" style={brandStyle(brand)}>
      <header className="guide-head">
        <BrandMark brand={brand} />
      </header>
      <h1 className="guide-title">{content.title}</h1>
      {content.intro && <p className="guide-intro">{content.intro}</p>}
      {content.sections.map((s, i) => (
        <section key={i} className="guide-section">
          <h2>{s.heading}</h2>
          {s.paragraphs.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
          {s.bullets.length > 0 && (
            <ul>
              {s.bullets.map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <footer className="paper-footer">
        {fullName(brand)}
        {brand.gdcNumber ? ` · GDC ${brand.gdcNumber}` : ""}
        {contactLine(brand) ? ` · ${contactLine(brand)}` : ""}
      </footer>
    </article>
  );
}

/** Declarations every consent form carries, whatever the treatment. */
export const CONSENT_DECLARATIONS = [
  "The proposed treatment, its benefits, risks and the alternatives (including no treatment) have been explained to me, and I have read this form.",
  "I have had the opportunity to ask questions, and they have been answered to my satisfaction.",
  "I have been told the cost of treatment. I understand it may change if the plan has to change, and that I will be told before this happens.",
  "I understand that I can change my mind and withdraw my consent at any time.",
  "I consent to the treatment described above.",
];

export function ConsentPaper({ brand, content, patientName }: { brand: BrandSettings; content: ConsentContent; patientName: string }) {
  return (
    <article className="paper consent" style={brandStyle(brand)}>
      <header className="guide-head">
        <BrandMark brand={brand} />
      </header>
      <h1 className="guide-title consent-title">{content.title}</h1>
      <div className="consent-fields">
        <span>
          Patient name: <span className="fill">{patientName.trim()}</span>
        </span>
        <span>
          Date of birth: <span className="fill" />
        </span>
        {content.teeth && <span>Teeth: {content.teeth}</span>}
      </div>

      <section className="guide-section">
        <h2>The proposed treatment</h2>
        <p>{content.treatment}</p>
      </section>
      {content.benefits.length > 0 && (
        <section className="guide-section">
          <h2>Benefits</h2>
          <ul>
            {content.benefits.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="guide-section">
        <h2>Risks</h2>
        <ul>
          {content.risks.map((r, i) => (
            <li key={i}>
              <strong>{r.risk}</strong>
              {r.detail ? `: ${r.detail}` : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="guide-section">
        <h2>Alternatives</h2>
        <ul>
          {content.alternatives.map((a, i) => (
            <li key={i}>
              <strong>{a.option}</strong>
              {a.summary ? `: ${a.summary}` : ""}
            </li>
          ))}
          <li>
            <strong>No treatment</strong>
            {content.noTreatment ? `: ${content.noTreatment}` : ""}
          </li>
        </ul>
      </section>
      {content.aftercare.length > 0 && (
        <section className="guide-section">
          <h2>What you need to do</h2>
          <ul>
            {content.aftercare.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="guide-section">
        <h2>Cost</h2>
        <p>{content.cost || "[fee]"}</p>
      </section>

      <section className="guide-section consent-sign">
        <h2>Declaration</h2>
        <ul className="ticks">
          {CONSENT_DECLARATIONS.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
        <div className="sign-grid">
          <span>Patient signature</span>
          <span className="fill" />
          <span>Date</span>
          <span className="fill" />
          <span>Parent, guardian or interpreter (if applicable)</span>
          <span className="fill" />
          <span>Date</span>
          <span className="fill" />
        </div>
        <p className="small-print">
          Clinician: I have explained the treatment, its benefits, risks and alternatives, and answered the patient's questions.
        </p>
        <div className="sign-grid">
          <span>{fullName(brand)}{brand.gdcNumber ? `, GDC ${brand.gdcNumber}` : ""}</span>
          <span className="fill" />
          <span>Date</span>
          <span className="fill" />
        </div>
      </section>
      <footer className="paper-footer">{contactLine(brand)}</footer>
    </article>
  );
}

/** One 16:9 slide. Text sizes follow the slide's width, so thumbnails and full screen look the same. */
export function SlideFrame({
  brand,
  slide,
  imageUrl,
  number,
}: {
  brand: BrandSettings;
  slide: Slide;
  imageUrl?: string;
  number?: number;
}) {
  return (
    <div className="slide" style={brandStyle(brand)}>
      <div className={`slide-body${imageUrl ? " with-image" : ""}`}>
        <div className="slide-text">
          <h2>{slide.title}</h2>
          {slide.bullets.length > 0 && (
            <ul>
              {slide.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
        {imageUrl && (
          <div className="slide-image">
            <img src={imageUrl} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          </div>
        )}
      </div>
      <SlideFooter brand={brand} number={number} />
    </div>
  );
}

function SlideFooter({ brand, number }: { brand: BrandSettings; number?: number }) {
  return (
    <div className="slide-footer">
      <span>
        {brand.displayName}
        {brand.practiceName ? ` · ${brand.practiceName}` : ""}
      </span>
      {brand.logo ? <img src={api.logoUrl(brand.logo)} alt="" /> : number !== undefined && <span>{number}</span>}
    </div>
  );
}

export function CoverSlide({ brand, title }: { brand: BrandSettings; title: string }) {
  return (
    <div className="slide cover" style={brandStyle(brand)}>
      {brand.logo && <img className="cover-logo" src={api.logoUrl(brand.logo)} alt="" />}
      <h1>{title}</h1>
      <p className="cover-name">{fullName(brand)}</p>
      {brand.practiceName && <p className="cover-practice">{brand.practiceName}</p>}
    </div>
  );
}

export function EndSlide({ brand }: { brand: BrandSettings }) {
  const contact = [brand.phone, brand.email, brand.website].filter(Boolean);
  return (
    <div className="slide cover" style={brandStyle(brand)}>
      <h1>Any questions?</h1>
      <p className="cover-name">Get in touch with us any time</p>
      {contact.map((c) => (
        <p key={c} className="cover-practice">
          {c}
        </p>
      ))}
    </div>
  );
}

export function TimelinePaper({ brand, content }: { brand: BrandSettings; content: TimelineContent }) {
  return (
    <article className="paper guide" style={brandStyle(brand)}>
      <header className="guide-head">
        <BrandMark brand={brand} />
      </header>
      <h1 className="guide-title">{content.title}</h1>
      {content.intro && <p className="guide-intro">{content.intro}</p>}
      <ol className="journey">
        {content.visits.map((v, i) => (
          <li key={i}>
            <span className="journey-dot">{i + 1}</span>
            <div className="journey-body">
              <div className="journey-when">{[v.when, v.duration].filter(Boolean).join(" · ")}</div>
              <h2>{v.name}</h2>
              <p>{v.whatHappens}</p>
              {v.howYouFeel && (
                <p className="journey-feel">
                  <strong>How you'll feel: </strong>
                  {v.howYouFeel}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {content.closing && <p className="guide-intro">{content.closing}</p>}
      <footer className="paper-footer">{contactLine(brand)}</footer>
    </article>
  );
}

export function MouthPaper({
  brand,
  content,
  imageUrl,
}: {
  brand: BrandSettings;
  content: MouthContent;
  imageUrl: (index: number | null) => string | undefined;
}) {
  return (
    <article className="paper guide" style={brandStyle(brand)}>
      <header className="guide-head">
        <BrandMark brand={brand} />
      </header>
      <h1 className="guide-title">{content.title}</h1>
      {content.intro && <p className="guide-intro">{content.intro}</p>}
      {content.items.map((m, i) => {
        const url = imageUrl(m.imageIndex);
        return (
          <section key={i} className={`mouth-item${url ? " with-image" : ""}`}>
            {url && <img src={url} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div>
              <h2>
                <span className="mouth-num">{i + 1}</span>
                {m.heading}
              </h2>
              <p>{m.explanation}</p>
            </div>
          </section>
        );
      })}
      {content.summary && <p className="mouth-summary">{content.summary}</p>}
      <footer className="paper-footer">{contactLine(brand)}</footer>
    </article>
  );
}

export function CardsPaper({ brand, content }: { brand: BrandSettings; content: CardsContent }) {
  const section = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <h3>{title}</h3>
        <ul>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="care-cards" style={brandStyle(brand)}>
      {content.cards.map((c, i) => (
        <article key={i} className="care-card">
          <header>
            <span>{brand.displayName}</span>
            {brand.logo ? <img src={api.logoUrl(brand.logo)} alt="" /> : brand.practiceName && <span>{brand.practiceName}</span>}
          </header>
          <h2>{c.visit}</h2>
          {section("Before your visit", c.before)}
          {section("After your visit", c.after)}
          {section(brand.phone ? `Call us on ${brand.phone} if` : "Call us if", c.callUsIf)}
        </article>
      ))}
    </div>
  );
}

export function FaqPaper({ brand, content }: { brand: BrandSettings; content: FaqContent }) {
  return (
    <article className="paper guide" style={brandStyle(brand)}>
      <header className="guide-head">
        <BrandMark brand={brand} />
      </header>
      <h1 className="guide-title">{content.title}</h1>
      {content.items.map((q, i) => (
        <section key={i} className="guide-section faq">
          <h2>{q.question}</h2>
          <p>{q.answer}</p>
        </section>
      ))}
      <p className="guide-intro">Anything else you'd like to know? Just ask us{brand.phone ? ` on ${brand.phone}` : ""}.</p>
      <footer className="paper-footer">{contactLine(brand)}</footer>
    </article>
  );
}
