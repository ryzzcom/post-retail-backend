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
 */
export function objectsToCsv(headers: string[], rows: Record<string, any>[]): string {
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
      rowObj[header] = values[j] !== undefined ? values[j].trim() : '';
    }
    results.push(rowObj);
  }

  return results;
}

/**
 * Splits CSV content into lines respecting quoted newlines.
 */
function splitCsvLines(csvText: string): string[] {
  const lines: string[] = [];
  let currentLine = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && csvText[i + 1] === '\n') {
        i++; // Skip \n in \r\n
      }
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Parses a single CSV line into an array of field values.
 */
function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        // Escaped double quote
        currentVal += '"';
        i++;
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      values.push(currentVal);
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  values.push(currentVal);
  return values;
}
