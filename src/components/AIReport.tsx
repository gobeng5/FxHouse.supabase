import { Fragment, type ReactNode } from 'react';

/**
 * An AI employee's report, rendered for reading. Reports use a small Markdown
 * subset — headings, "- " bullets, "> " notes, tables, **bold**, _italic_ and
 * `code` — so this renders it directly instead of pulling in a Markdown library.
 */

const PROBLEM = /\b(PROBLEM|FAILING|FAILED|DISCREPANC|NEEDS ATTENTION|ERROR)/i;
const CLEAR = /\b(ALL CLEAR|VERIFIED|WITHIN EXPECTATION|NO BETTER STRATEGY|CLEAN)\b/i;

export function reportTone(report: string): 'problem' | 'clear' | 'neutral' {
  // The verdict heading's ✅ / ❌ decides first ("0 failing" is not a problem).
  const first = report.split('\n')[0] ?? '';
  if (first.includes('❌')) return 'problem';
  if (first.includes('✅')) return 'clear';
  const head = report.split('\n').slice(0, 3).join(' ');
  return PROBLEM.test(head) ? 'problem' : CLEAR.test(head) ? 'clear' : 'neutral';
}

const FRAME = {
  problem: 'border-l-4 border-l-destructive bg-destructive/5',
  clear: 'border-l-4 border-l-bullish bg-bullish/5',
  neutral: 'border-l-4 border-l-border bg-muted/40',
};

/** **bold**, _italic_ and `code` inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\b_[^_]+_\b)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">{part.slice(1, -1)}</code>;
    if (part.startsWith('_') && part.endsWith('_')) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isSeparator = (row: string) => /^\|?[\s:|-]+\|?$/.test(row.trim()) && row.includes('-');

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; head: string[]; align: ('left' | 'right')[]; rows: string[][] }
  | { kind: 'para'; lines: string[] };

function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    if (!t) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, text: h[2] }); continue; }
    if (t.startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const align = cells(lines[i + 1]).map(c => (c.endsWith(':') && !c.startsWith(':') ? 'right' : 'left') as 'left' | 'right');
      const head = cells(t);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push({ kind: 'table', head, align, rows });
      continue;
    }
    const bullet = /^(?:-|•|\*)\s+(.*)$/.exec(t);
    if (bullet) {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'list') prev.items.push(bullet[1]); else blocks.push({ kind: 'list', items: [bullet[1]] });
      continue;
    }
    if (t.startsWith('>')) {
      const prev = blocks[blocks.length - 1];
      const text = t.replace(/^>\s?/, '');
      if (prev?.kind === 'quote') prev.lines.push(text); else blocks.push({ kind: 'quote', lines: [text] });
      continue;
    }
    const prev = blocks[blocks.length - 1];
    // Consecutive plain lines form one paragraph; a blank line starts a new one.
    if (prev?.kind === 'para' && lines[i - 1]?.trim()) prev.lines.push(t); else blocks.push({ kind: 'para', lines: [t] });
  }
  return blocks;
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case 'heading':
      return b.level <= 3
        ? <h3 key={key} className="text-base font-semibold mb-2">{inline(b.text)}</h3>
        : <h4 key={key} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1.5">{inline(b.text)}</h4>;
    case 'list':
      return <ul key={key} className="list-disc pl-5 space-y-1 mb-2">{b.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>;
    case 'quote':
      return <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground text-xs my-2 space-y-1">{b.lines.map((l, i) => <p key={i}>{inline(l)}</p>)}</blockquote>;
    case 'table':
      return (
        <div key={key} className="overflow-x-auto my-2 rounded border border-border/60">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-muted/60">
              <tr>{b.head.map((c, i) => <th key={i} style={{ textAlign: b.align[i] }} className="px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{b.head.map((_, ci) => <td key={ci} style={{ textAlign: b.align[ci] }} className={`px-2 py-1.5 border-t border-border/40 ${ci === b.head.length - 1 ? '' : 'whitespace-nowrap'}`}>{inline(r[ci] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'para':
      return <p key={key} className="mb-2 last:mb-0">{b.lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>;
  }
}

export function AIReport({ report }: { report: string }) {
  return (
    <div className={`rounded-md p-3 text-sm leading-relaxed ${FRAME[reportTone(report)]}`}>
      {parse(report).map(renderBlock)}
    </div>
  );
}
