// Inline SVG icon set (24×24, stroke-based, uses currentColor).

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  select: svg('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  wall: svg('<rect x="3" y="9" width="18" height="6" fill="currentColor" fill-opacity=".25"/><path d="M3 9h18M3 15h18"/>'),
  door: svg('<path d="M4 20h16M7 20V5h7v15"/><path d="M14 5l4 2v13"/><circle cx="12" cy="13" r=".8" fill="currentColor"/>'),
  window: svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14M4 12h16"/>'),
  floor: svg('<path d="M3 15l9-5 9 5-9 5z" fill="currentColor" fill-opacity=".2"/><path d="M3 15v2l9 5 9-5v-2"/>'),
  roof: svg('<path d="M2 13L12 5l10 8"/><path d="M5 11v8h14v-8"/>'),
  room: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 10h8M8 14h5"/>'),
  grid: svg('<circle cx="6" cy="5" r="2.5"/><path d="M6 7.5V21" stroke-dasharray="3 2"/><circle cx="18" cy="5" r="2.5"/><path d="M18 7.5V21" stroke-dasharray="3 2"/>'),
  level: svg('<path d="M3 8h13M3 16h13" stroke-dasharray="3 2"/><path d="M17 8l2-2 2 2-2 2zM17 16l2-2 2 2-2 2z"/>'),
  dimension: svg('<path d="M4 6v12M20 6v12M4 12h16"/><path d="M7 10l-3 2 3 2M17 10l3 2-3 2"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  move: svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'),
  mirror: svg('<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6L3 18h6zM15 6l6 12h-6z"/>'),
  trim: svg('<path d="M4 20V8M4 8h12"/><path d="M16 8h4M4 8V4" stroke-dasharray="2 2"/><circle cx="4" cy="8" r="1.5" fill="currentColor"/>'),
  split: svg('<path d="M3 12h7M14 12h7"/><path d="M14 6l-4 12"/>'),
  delete: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  view3d: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>'),
  elevation: svg('<circle cx="12" cy="12" r="5"/><path d="M12 7l3 5h-6z" fill="currentColor"/>'),
  plan: svg('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h9v9M12 3v5"/>'),
  schedule: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>'),
  visibility: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  zoomfit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  open: svg('<path d="M3 7V5h7l2 2h9v12H3z"/><path d="M3 10h18"/>'),
  new: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>'),
  types: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  ifc: svg('<path d="M4 4h16v16H4z"/><path d="M8 9v6M11 9v6M11 9h3M11 12h2.5M18 9h-2v6h2"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
  units: svg('<path d="M3 17l14-14 4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  family: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  folder: svg('<path d="M3 6h6l2 2h10v11H3z"/>'),
  sample: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  csv: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 15h6M9 18h4"/>'),
};

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f80ed"/><stop offset="1" stop-color="#1a4fa0"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#lg)"/><path d="M14 30l18-13 18 13" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M19 28v19h26V28" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M29 47v-9h6v9" fill="none" stroke="#fff" stroke-width="3.5"/></svg>`;
