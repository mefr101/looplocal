// Color helpers for organization branding: WCAG contrast math and applying an accent color.
// Used by layout.js (every page) and settings.js (the live preview).

const INK = '#0f172a'; // the dark text color the site already puts on bright fills
const WHITE = '#ffffff';

function toRgb(hex)
{
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Relative luminance as defined by WCAG 2.x. */
function luminance(hex)
{
  const [r, g, b] = toRgb(hex).map((channel) =>
  {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two #rrggbb colors, from 1 to 21. */
export function contrastRatio(hexA, hexB)
{
  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export function isHexColor(value)
{
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Whichever of dark ink or white reads better on this background. */
export function textColorFor(hex)
{
  return contrastRatio(hex, INK) >= contrastRatio(hex, WHITE) ? INK : WHITE;
}

/**
 * Set the accent color on an element (the whole page by default). Buttons, active links and
 * highlights all read these variables from tokens.css. Passing null restores the defaults.
 */
export function applyBrandColor(hex, element = document.documentElement)
{
  const names = ['--color-brand', '--color-brand-hover', '--color-brand-tint', '--color-on-brand'];
  if (!isHexColor(hex))
  {
    for (const name of names) element.style.removeProperty(name);
    return;
  }
  element.style.setProperty('--color-brand', hex);
  element.style.setProperty('--color-brand-hover', `color-mix(in srgb, ${hex} 85%, black)`);
  element.style.setProperty('--color-brand-tint', `color-mix(in srgb, ${hex} 14%, var(--color-surface))`);
  element.style.setProperty('--color-on-brand', textColorFor(hex));
}
