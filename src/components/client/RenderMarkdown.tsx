import { inlineMarkdownToHtml } from '../../lib/inline-markdown';
import { ChartBlock, DataTableBlock, MetricBlock, SparklineBlock } from '../ChatBlocks';

export function RenderMarkdown({ text }: { text: string }) {
  const inlineMd = (s: string) => inlineMarkdownToHtml(s);
  const stripBold = (s: string) => s.replace(/\*\*/g, '').trim();
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Fenced code blocks: ```lang ... ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      idx++;
      const blockLines: string[] = [];
      while (idx < lines.length && !lines[idx].trimStart().startsWith('```')) {
        blockLines.push(lines[idx]);
        idx++;
      }
      if (idx < lines.length) idx++; // skip closing ```
      const blockContent = blockLines.join('\n').trim();

      // Rich blocks: metric, chart, datatable, sparkline
      if (lang === 'metric' || lang === 'chart' || lang === 'datatable' || lang === 'sparkline') {
        let parsed: unknown = null;
        try { parsed = JSON.parse(blockContent); } catch { /* invalid JSON */ }

        if (parsed !== null) {
          if (lang === 'metric') elements.push(<MetricBlock key={elements.length} data={parsed as Parameters<typeof MetricBlock>[0]['data']} />);
          else if (lang === 'chart') elements.push(<ChartBlock key={elements.length} data={parsed as Parameters<typeof ChartBlock>[0]['data']} />);
          else if (lang === 'datatable') elements.push(<DataTableBlock key={elements.length} data={parsed as Parameters<typeof DataTableBlock>[0]['data']} />);
          else if (lang === 'sparkline') elements.push(<SparklineBlock key={elements.length} data={parsed as Parameters<typeof SparklineBlock>[0]['data']} />);
        } else {
          elements.push(
            <pre key={elements.length} className="t-caption-sm bg-[var(--surface-3)]/60 border border-[var(--brand-border)]/50 rounded-[var(--radius-lg)] p-2 overflow-x-auto text-[var(--brand-text)] my-1">
              <code>{blockContent}</code>
            </pre>
          );
        }
        continue;
      }

      // Regular code block
      elements.push(
        <pre key={elements.length} className="t-caption-sm bg-[var(--surface-3)]/60 border border-[var(--brand-border)]/50 rounded-[var(--radius-lg)] p-2 overflow-x-auto text-[var(--brand-text)] my-1">
          <code>{blockContent}</code>
        </pre>
      );
      continue;
    }

    // Table: consecutive lines starting and ending with |
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const tableLines: string[] = [];
      while (idx < lines.length) {
        const tl = lines[idx].trim();
        if (tl.startsWith('|') && tl.includes('|', 1)) { tableLines.push(tl); idx++; }
        else break;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(c => c.trim());
        const isSep = (row: string) => /^\|[\s\-:]+\|/.test(row);
        const headers = parseRow(tableLines[0]);
        const dataStart = tableLines.length > 1 && isSep(tableLines[1]) ? 2 : 1;
        const rows = tableLines.slice(dataStart).filter(r => !isSep(r)).map(parseRow);
        elements.push(
          <div key={elements.length} className="overflow-x-auto my-1.5 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
            <table className="t-caption-sm w-full border-collapse">
              <thead>
                <tr className="bg-[var(--surface-3)]/50">
                  {headers.map((h, j) => (
                    <th key={j} className="text-left px-2.5 py-1.5 text-[var(--brand-text)] font-medium whitespace-nowrap"
                      dangerouslySetInnerHTML={{ __html: inlineMd(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, j) => (
                  <tr key={j} className={j < rows.length - 1 ? 'border-b border-[var(--brand-border)]/50' : ''}>
                    {row.map((cell, k) => (
                      <td key={k} className="px-2.5 py-1.5 text-[var(--brand-text)] whitespace-nowrap"
                        dangerouslySetInnerHTML={{ __html: inlineMd(cell) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Headings — strip bold markers inside (GPT sends ## **Overview**)
    if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={elements.length} className="t-body text-base font-semibold leading-snug text-[var(--brand-text-bright)] mt-3 mb-0.5">{stripBold(trimmed.slice(4))}</h4>);
      idx++; continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={elements.length} className="t-body text-lg font-semibold leading-snug text-[var(--brand-text-bright)] mt-3 mb-0.5">{stripBold(trimmed.slice(3))}</h3>);
      idx++; continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<h2 key={elements.length} className="t-h2 text-[var(--brand-text-bright)] mt-3 mb-0.5">{stripBold(trimmed.slice(2))}</h2>);
      idx++; continue;
    }

    // Bullet lists: - or • (handle both to avoid double-bullet)
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const content = trimmed.slice(2);
      elements.push(
        <div key={elements.length} className="flex gap-1.5 t-body text-[var(--brand-text)]" style={{ marginLeft: indent > 0 ? 12 : 0 }}>
          <span className="text-[var(--brand-text-muted)] shrink-0 mt-px">•</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
        </div>
      );
      idx++; continue;
    }

    // Numbered lists
    if (trimmed.match(/^\d+\.\s/)) {
      const content = trimmed.replace(/^\d+\.\s/, '');
      const num = trimmed.match(/^(\d+)\./)?.[1];
      elements.push(
        <div key={elements.length} className="flex gap-1.5 t-body text-[var(--brand-text)] mt-0.5" style={{ marginLeft: indent > 0 ? 12 : 0 }}>
          <span className="text-[var(--brand-text-muted)] shrink-0 w-4 text-right">{num}.</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
        </div>
      );
      idx++; continue;
    }

    // Empty line → small spacer
    if (trimmed === '') { elements.push(<div key={elements.length} className="h-1" />); idx++; continue; }

    // Regular paragraph
    elements.push(
      <p key={elements.length} className="t-body text-[var(--brand-text)] leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMd(trimmed) }} />
    );
    idx++;
  }

  return <div className="space-y-1">{elements}</div>;
}
