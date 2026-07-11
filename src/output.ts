export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyCell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function renderTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '(no results)';
  }
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }
  const cells = rows.map((row) => columns.map((column) => stringifyCell(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (values: string[]) =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join('  ');
  const separator = widths.map((width) => '-'.repeat(width));
  return [formatRow(columns), formatRow(separator), ...cells.map(formatRow)].join('\n');
}

function renderKeyValue(entries: Record<string, unknown>): string {
  const keys = Object.keys(entries);
  const width = Math.max(0, ...keys.map((key) => key.length));
  return keys.map((key) => `${key.padEnd(width)}  ${stringifyCell(entries[key])}`).join('\n');
}

/**
 * Human-readable rendering for terminal use: an offset-paginated envelope (`{data, pagination}`)
 * or bare array becomes a column table; a single-key wrapper (`{space: {...}}`, `{messages: [...]}`)
 * unwraps to render its inner value; any other object becomes key/value lines. Anything else
 * falls back to `printJson`.
 */
export function printPretty(value: unknown): void {
  if (isPlainObject(value) && Array.isArray(value.data)) {
    process.stdout.write(`${renderTable(value.data.filter(isPlainObject))}\n`);
    if (isPlainObject(value.pagination)) {
      process.stdout.write(`${renderKeyValue(value.pagination)}\n`);
    }
    return;
  }
  if (Array.isArray(value)) {
    process.stdout.write(`${renderTable(value.filter(isPlainObject))}\n`);
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const onlyKey = keys.length === 1 ? keys[0] : undefined;
    if (onlyKey !== undefined) {
      const onlyValue = value[onlyKey];
      if (isPlainObject(onlyValue) || Array.isArray(onlyValue)) {
        printPretty(onlyValue);
        return;
      }
    }
    process.stdout.write(`${renderKeyValue(value)}\n`);
    return;
  }
  printJson(value);
}
