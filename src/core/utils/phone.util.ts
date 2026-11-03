/**
 * Pakistani Phone Number Utilities
 */

/**
 * Mask Pakistani phone number (e.g. 0300-***4567)
 */
export function maskPakistaniPhone(phone?: string | null): string {
  if (!phone) return 'N/A';
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.length >= 7) {
    return `${clean.slice(0, 4)}-***${clean.slice(-4)}`;
  }
  return clean || 'N/A';
}

/**
 * Normalize Pakistani phone number to uniform 11-digit format (03001234567)
 */
export function normalizePakistaniPhone(phone?: string | null): string {
  if (!phone) return '';
  let clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('92') && clean.length === 12) {
    clean = '0' + clean.slice(2);
  }
  return clean;
}
