/**
 * R24 Phase B: the business the app acts on. The Worker reads it from the X-Business-Id header or
 * this cookie, so plain links and new tabs open the same business as the page.
 */
export const BUSINESS_COOKIE = 'ledger_business';

export function setCurrentBusiness(id: number): void {
  document.cookie = `${BUSINESS_COOKIE}=${id}; path=/; SameSite=Strict; max-age=31536000`;
}

/** Switches business and reloads, so every screen reads the new business from the start. */
export function switchBusiness(id: number): void {
  setCurrentBusiness(id);
  window.location.assign('/');
}
