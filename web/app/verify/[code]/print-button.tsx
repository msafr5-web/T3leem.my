'use client';

/** Opens the browser's print dialog; "Save as PDF" there produces the certificate PDF (A4 landscape). */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      طباعة / حفظ PDF
    </button>
  );
}
