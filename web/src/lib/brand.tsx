// The dentist's branding, loaded once and shared by the header, letters, guides and slides.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { defaultBrand, type BrandSettings } from "../../../shared/types";
import { api } from "./api";

interface BrandState {
  brand: BrandSettings;
  setBrand: (b: BrandSettings) => void;
}

const BrandContext = createContext<BrandState>({ brand: defaultBrand(), setBrand: () => {} });

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<BrandSettings>(defaultBrand);

  useEffect(() => {
    api.getBrand().then(setBrand).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--brand", brand.brandColour);
    document.title = brand.displayName ? `${brand.displayName} · Case workspace` : "Case workspace";
  }, [brand.brandColour, brand.displayName]);

  return <BrandContext.Provider value={{ brand, setBrand }}>{children}</BrandContext.Provider>;
}

export const useBrand = () => useContext(BrandContext);

/** Name with qualifications, e.g. "Dr Aran Maxwell-Cox BDS MJDF". */
export const fullName = (b: BrandSettings) => [b.displayName, b.qualifications].filter(Boolean).join(" ");

/** One-line contact details for letter and guide footers. */
export const contactLine = (b: BrandSettings) =>
  [b.practiceName, b.address.replace(/\s*\n\s*/g, ", "), b.phone, b.email, b.website].filter(Boolean).join(" · ");

export function Logo({ className }: { className?: string }) {
  const { brand } = useBrand();
  if (!brand.logo) return null;
  return <img className={className} src={api.logoUrl(brand.logo)} alt={brand.practiceName || brand.displayName} />;
}

/**
 * Renders its children only when printing. The rest of the app is hidden in print,
 * so Print gives a clean letter, guide or slide set that can be saved as a PDF.
 */
export function PrintOnly({ children, landscape }: { children: ReactNode; landscape?: boolean }) {
  return createPortal(
    <div className="print-root">
      {landscape && <style>{"@page { size: A4 landscape; margin: 0; }"}</style>}
      {children}
    </div>,
    document.body,
  );
}
