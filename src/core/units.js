// Length/area formatting and parsing. All model lengths are stored in millimetres.

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** Format a millimetre length for display in the given unit system. */
export function formatLength(mm, units = 'metric') {
  if (!Number.isFinite(mm)) return '';
  if (units === 'imperial') {
    const sign = mm < 0 ? '-' : '';
    // Round to the nearest 1/16".
    let sixteenths = Math.round((Math.abs(mm) / MM_PER_INCH) * 16);
    const feet = Math.floor(sixteenths / (12 * 16));
    sixteenths -= feet * 12 * 16;
    const inches = Math.floor(sixteenths / 16);
    let frac = sixteenths - inches * 16;
    let fracStr = '';
    if (frac > 0) {
      const g = gcd(frac, 16);
      fracStr = ` ${frac / g}/${16 / g}`;
    }
    return `${sign}${feet}' ${inches}${fracStr}"`;
  }
  const rounded = Math.round(mm * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

/** Format an area given in mm² as m² or ft². */
export function formatArea(mm2, units = 'metric') {
  if (!Number.isFinite(mm2)) return '';
  if (units === 'imperial') return `${(mm2 / (MM_PER_FOOT * MM_PER_FOOT)).toFixed(0)} SF`;
  return `${(mm2 / 1e6).toFixed(2)} m²`;
}

/** Format a volume given in mm³ as m³ or ft³. */
export function formatVolume(mm3, units = 'metric') {
  if (!Number.isFinite(mm3)) return '';
  if (units === 'imperial') return `${(mm3 / MM_PER_FOOT ** 3).toFixed(2)} CF`;
  return `${(mm3 / 1e9).toFixed(2)} m³`;
}

export function lengthUnitLabel(units = 'metric') {
  return units === 'imperial' ? 'ft-in' : 'mm';
}

/**
 * Parse a user-entered length into millimetres. Accepts plain numbers in the
 * project's base unit, or explicit units: 3000, 3000mm, 3m, 300cm, 10', 10'6",
 * 10' 6 1/2", 6", 10.5ft. Returns NaN when the text is not a length.
 */
export function parseLength(text, units = 'metric') {
  if (typeof text === 'number') return text;
  const s = String(text).trim().toLowerCase();
  if (!s) return NaN;

  const metric = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)$/);
  if (metric) {
    const v = parseFloat(metric[1]);
    return metric[2] === 'm' ? v * 1000 : metric[2] === 'cm' ? v * 10 : v;
  }
  const ft = s.match(/^(-?\d+(?:\.\d+)?)\s*(ft|feet)$/);
  if (ft) return parseFloat(ft[1]) * MM_PER_FOOT;
  const inch = s.match(/^(-?\d+(?:\.\d+)?)\s*(in|inch|inches)$/);
  if (inch) return parseFloat(inch[1]) * MM_PER_INCH;

  // Feet-inch notation: 10' 6 1/2" | 10'-6" | 10' | 6" | 6 1/2"
  const fi = s.match(/^(-)?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*")?$/);
  if (fi && (fi[2] !== undefined || fi[3] !== undefined || fi[4] !== undefined)) {
    const feet = fi[2] ? parseFloat(fi[2]) : 0;
    let inches = fi[3] ? parseFloat(fi[3]) : 0;
    if (fi[4] && fi[5] && parseFloat(fi[5]) !== 0) inches += parseFloat(fi[4]) / parseFloat(fi[5]);
    const v = feet * MM_PER_FOOT + inches * MM_PER_INCH;
    return fi[1] ? -v : v;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const v = parseFloat(s);
    return units === 'imperial' ? v * MM_PER_FOOT : v;
  }
  return NaN;
}
