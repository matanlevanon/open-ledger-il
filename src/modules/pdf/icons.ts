/**
 * Small monochrome line icons for the header's icon row (R17 task 6: ID, email, phone, address,
 * website). Inline SVG, `currentColor` stroke, sized by the surrounding `.icon` CSS class, so no
 * icon font needs bundling and Browser Rendering needs no network to draw them.
 */
const svg = (paths: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
  id: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 13h4M7 16h7"/>'),
  email: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>'),
  phone: svg(
    '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 9 9 0 0 0 2.9.5 1.2 1.2 0 0 1 1.2 1.2v2.9A1.2 1.2 0 0 1 19.5 21 16.5 16.5 0 0 1 3 4.5a1.2 1.2 0 0 1 1.2-1.2h2.9A1.2 1.2 0 0 1 8.3 4.5a9 9 0 0 0 .5 2.9 1.2 1.2 0 0 1-.3 1.2z"/>',
  ),
  pin: svg('<path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>'),
  website: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>'),
  badge: svg('<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m8 12.5 2.5 2.5L16 9.5" stroke="#fff" stroke-width="2.2"/>'),
} as const;
