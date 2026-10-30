// Branded layouts for letters, guides and slides. Used on screen, in print and in the slideshow.
import type { CSSProperties } from "react";
import type { BrandSettings, GuideContent, LetterContent, Slide } from "../../../shared/types";
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
