/**
 * Robust CSV Serializer and Parser supporting quoted fields, commas, and newlines.
 */

/**
 * Escapes and quotes a single CSV field value if necessary.
 */
export function escapeCsvField(val: any): string {
  if (val === null || val === undefined) {
    return '';
  }
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of objects to a CSV string.
 * Supports both signatures:
 *   objectsToCsv(rows)
 *   objectsToCsv(headers, rows)
 */
export function objectsToCsv(
  headersOrRows: string[] | Record<string, any>[],
  maybeRows?: Record<string, any>[],
): string {
  let headers: string[];
  let rows: Record<string, any>[];

  if (Array.isArray(headersOrRows) && headersOrRows.length > 0 && typeof headersOrRows[0] === 'object') {
    rows = headersOrRows as Record<string, any>[];
    headers = Object.keys(rows[0] || {});
  } else if (Array.isArray(headersOrRows) && headersOrRows.length === 0 && !maybeRows) {
    return '';
  } else {
    headers = (headersOrRows as string[]) || [];
    rows = maybeRows || [];
    if (headers.length === 0 && rows.length > 0) {
      headers = Object.keys(rows[0]);
    }
  }

  const headerLine = headers.map(escapeCsvField).join(',');
  const rowLines = rows.map((row) =>
    headers.map((h) => escapeCsvField(row[h] !== undefined ? row[h] : '')).join(','),
  );
  return [headerLine, ...rowLines].join('\r\n');
}

/**
 * Parses a CSV string into an array of objects based on header row.
 */
export function parseCsvToObjects(csvText: string): Record<string, any>[] {
  if (!csvText || !csvText.trim()) {
    return [];
  }

  const lines = splitCsvLines(csvText);
  if (lines.length === 0) return [];

  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const results: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvRow(line);
    const rowObj: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      rowObj[header] = values[j] !== undefined ? values[j] : '';
    }
    results.push(rowObj);
  }

  return results;
}

/**
 * Splits text into lines taking quoted multi-line fields into account.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i++; // skip \n of \r\n
      }
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * Parses a single CSV line honoring double quotes.
 */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}
