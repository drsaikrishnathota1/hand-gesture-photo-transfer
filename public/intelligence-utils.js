(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AirGestureIntelligenceUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE_ABBR = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
    Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
    Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
    Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
    Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
    Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
    Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
    'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC'
  };

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function prettySegment(value) {
    const raw = clean(value).toUpperCase();
    const map = {
      WINDOWS_DESKTOP: 'Windows Desktop',
      APPLE_DESKTOP: 'Apple Desktop',
      APPLE_MOBILE: 'Apple Mobile',
      ANDROID_MOBILE: 'Android Mobile',
      TABLET_USER: 'Tablet',
      LINUX_DESKTOP: 'Linux Desktop',
      GENERAL_DESKTOP: 'General Desktop',
      MOBILE_USER: 'Mobile',
      NOT_OPTED_IN: 'Unclassified',
      UNKNOWN: 'Unclassified',
      GENERAL: 'General'
    };
    if (!raw) return 'Unclassified';
    return map[raw] || raw.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  function prettyDevice(value) {
    const raw = clean(value);
    const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!compact) return 'Unspecified';
    if (compact.includes('laptopdesktop') || compact.includes('lapopdeskop') || compact === 'desktop' || compact === 'laptop') return 'Laptop/Desktop';
    if (compact.includes('mobile') || compact === 'phone' || compact === 'smartphone') return 'Mobile';
    if (compact.includes('tablet') || compact.includes('ipad')) return 'Tablet';
    return raw;
  }

  function prettyBrowser(value) {
    const raw = clean(value);
    const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!compact) return 'Unspecified';
    if (compact.includes('chrome') || compact === 'chome') return 'Chrome';
    if (compact.includes('safari')) return 'Safari';
    if (compact.includes('edge')) return 'Edge';
    if (compact.includes('firefox')) return 'Firefox';
    return raw;
  }

  function prettyOs(value) {
    const raw = clean(value);
    const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return 'Unspecified';
    if (compact.includes('windows')) return 'Windows';
    if (compact.includes('android')) return 'Android';
    if (compact.includes('macos') || compact === 'mac') return 'macOS';
    if (compact.includes('ios') || compact.includes('ipados')) return 'iOS / iPadOS';
    if (compact.includes('linux')) return 'Linux';
    return raw;
  }

  function prettyFileType(value) {
    const raw = clean(value).toUpperCase();
    const map = { IMAGE: 'Images', PDF: 'PDF', DOCUMENT: 'Documents', VIDEO: 'Video', OTHER: 'Other' };
    return map[raw] || (raw || 'Other');
  }

  function prettyLocation(value, compact = true) {
    let raw = clean(value);
    if (!raw || /^(unknown|unspecified|n\/a)$/i.test(raw)) return 'Unspecified';
    if (/^us$/i.test(raw) || /^united states( of america)?$/i.test(raw)) return 'United States';

    raw = raw
      .replace(/United States of America \(the\)/gi, 'United States')
      .replace(/United States of America/gi, 'United States')
      .replace(/,\s*US$/i, ', United States');

    const parts = raw.split(',').map((part) => clean(part)).filter(Boolean);
    if (parts.length >= 2 && compact) {
      let city = parts[0];
      const state = parts[1];
      if (/^Township of Boone$/i.test(city)) city = 'Boone Township';
      return `${city}, ${STATE_ABBR[state] || state}`;
    }
    return raw;
  }

  function prettyHourUtc(value) {
    const numeric = Number(String(value).split(':')[0]);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) return clean(value) || '—';
    const suffix = numeric >= 12 ? 'PM' : 'AM';
    const hour = numeric % 12 || 12;
    return `${hour}:00 ${suffix} UTC`;
  }

  function opportunityLabel(score) {
    const n = Number(score || 0);
    if (n >= 80) return 'Very strong';
    if (n >= 65) return 'Strong';
    if (n >= 50) return 'Moderate';
    return 'Explore';
  }

  return {
    clean,
    prettySegment,
    prettyDevice,
    prettyBrowser,
    prettyOs,
    prettyFileType,
    prettyLocation,
    prettyHourUtc,
    opportunityLabel
  };
});
