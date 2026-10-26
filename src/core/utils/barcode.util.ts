/**
 * GS1 EAN-13 Barcode Generator and Validator.
 * Pakistan GS1 Country Code prefix: 8964.
 */

/**
 * Calculates the GS1 Modulo-10 check digit for the first 12 digits of an EAN-13 barcode.
 */
export function calculateEan13CheckDigit(first12Digits: string): number {
  if (!/^\d{12}$/.test(first12Digits)) {
    throw new Error(`Expected 12 numeric digits, received: ${first12Digits}`);
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(first12Digits[i], 10);
    // GS1 weighting: odd positions (1st, 3rd... index 0, 2...) weight 1, even positions (2nd, 4th... index 1, 3...) weight 3
    sum += i % 2 === 0 ? digit : digit * 3;
  }

  const remainder = sum % 10;
  return (10 - remainder) % 10;
}

/**
 * Generates a valid 13-digit EAN-13 barcode starting with a specified prefix (default: 8964 for Pakistan).
 */
export function generateEan13Barcode(prefix = '8964'): string {
  // We need 12 digits total before calculating the 13th check digit
  const remainingDigitsCount = 12 - prefix.length;
  if (remainingDigitsCount <= 0) {
    throw new Error(`Prefix length (${prefix.length}) must be less than 12 digits`);
  }

  // Generate random digits to fill the rest of the 12 digits
  let randomPart = '';
  for (let i = 0; i < remainingDigitsCount; i++) {
    randomPart += Math.floor(Math.random() * 10).toString();
  }

  const first12Digits = `${prefix}${randomPart}`;
  const checkDigit = calculateEan13CheckDigit(first12Digits);

  return `${first12Digits}${checkDigit}`;
}

/**
 * Validates whether a barcode is a valid 13-digit EAN-13 barcode with a correct Modulo-10 check digit.
 */
export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) {
    return false;
  }
  const first12 = barcode.substring(0, 12);
  const checkDigit = parseInt(barcode[12], 10);
  return calculateEan13CheckDigit(first12) === checkDigit;
}
