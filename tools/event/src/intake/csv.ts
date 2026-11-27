// RFC 4180 CSV parsing (quoted fields, "" escapes, newlines inside quotes, CRLF, BOM). Owned by #56.

/** Parse CSV text into rows of fields. Blank lines are skipped. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      endRow();
      i++;
    } else if (ch === '\n' || ch === '\r') endRow();
    else field += ch;
    i++;
  }
  if (quoted) throw new Error(`CSV: unclosed quote after data row ${rows.length}`);
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Rows as objects keyed by the header row. Missing cells become ''. */
export function csvRecords(text: string, delimiter = ','): { headers: string[]; records: Record<string, string>[] } {
  const [headers = [], ...rows] = parseCsv(text, delimiter);
  const records = rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])));
  return { headers, records };
}
