export interface RedirectCsvRule {
  from: string;
  to: string;
}

export const REDIRECT_CSV_HEADERS = ['Old Path', 'New Path'] as const;

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeRedirectRulesCsv(rules: readonly RedirectCsvRule[]): string {
  const rows = [
    REDIRECT_CSV_HEADERS,
    ...rules.map(rule => [rule.from, rule.to] as const),
  ];

  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

export function downloadRedirectRulesCsv(
  rules: readonly RedirectCsvRule[],
  filename = 'webflow-redirects.csv',
): void {
  const csv = serializeRedirectRulesCsv(rules);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
