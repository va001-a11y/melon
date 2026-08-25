import type { ReactNode } from "react";

/**
 * A small, safe Markdown renderer.
 *
 * Models write Markdown by default — headings, tables, bold — and showing it
 * raw is what makes replies look like source code. This builds React elements
 * directly and never touches innerHTML, so model output cannot inject markup.
 * It covers what chat models actually emit rather than the full spec.
 */

type InlineKind = "code" | "strongem" | "strong" | "em" | "del" | "link";

/**
 * Inline rules, most specific first.
 *
 * The content groups are non-greedy and allow any character, so bold can
 * contain italics and vice versa. An earlier version forbade `*` inside
 * `**…**`, which made "**bold with *italics* inside**" fail to match and
 * fall through to a wrong reading — the surrounding markers ended up visible
 * and the emphasis landed on the wrong words.
 */
const INLINE_RULES: { re: RegExp; kind: InlineKind; recurse: boolean }[] = [
  { re: /`([^`]+)`/, kind: "code", recurse: false },
  { re: /\*\*\*([\s\S]+?)\*\*\*/, kind: "strongem", recurse: true },
  { re: /___([\s\S]+?)___/, kind: "strongem", recurse: true },
  { re: /\*\*([\s\S]+?)\*\*/, kind: "strong", recurse: true },
  { re: /__([\s\S]+?)__/, kind: "strong", recurse: true },
  { re: /~~([\s\S]+?)~~/, kind: "del", recurse: true },
  { re: /\*([^*\n]+?)\*/, kind: "em", recurse: true },
  { re: /(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/, kind: "em", recurse: true },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, kind: "link", recurse: true },
];

function renderInline(kind: InlineKind, inner: ReactNode, key: string, match: RegExpExecArray): ReactNode {
  switch (kind) {
    case "code":
      return <code key={key}>{match[1]}</code>;
    case "strongem":
      return (
        <strong key={key}>
          <em>{inner}</em>
        </strong>
      );
    case "strong":
      return <strong key={key}>{inner}</strong>;
    case "del":
      return <del key={key}>{inner}</del>;
    case "link":
      return /^https?:\/\//i.test(match[2]) ? (
        <a key={key} href={match[2]} target="_blank" rel="noreferrer noopener">
          {inner}
        </a>
      ) : (
        // Anything that is not plainly http(s) stays inert text.
        <span key={key}>{match[0]}</span>
      );
    default:
      return <em key={key}>{inner}</em>;
  }
}

/** Inline: **bold**, *italic*, `code`, [text](url), ~~strike~~, and nesting. */
function inline(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;

  // The guard is belt-and-braces: each step consumes characters, so this
  // always terminates, but deeply pathological input should not recurse far.
  while (rest.length > 0 && depth < 6) {
    let best: { rule: (typeof INLINE_RULES)[number]; m: RegExpExecArray } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      // Earliest match wins; ties go to the earlier (more specific) rule.
      if (m && (best === null || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) break;

    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    const key = `${keyPrefix}-i${n++}`;
    const inner = best.rule.recurse ? inline(best.m[1], key, depth + 1) : best.m[1];
    out.push(renderInline(best.rule.kind, inner, key, best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }

  if (rest.length > 0) out.push(rest);
  return out;
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, "").trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={`b${key++}`} className="md-code">
          <code data-lang={lang}>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Table: a header row followed by a |---|---| divider
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i++]));
      }
      blocks.push(
        <div key={`b${key++}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{inline(h, `h${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{inline(row[ci] ?? "", `r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Heading. The space after the hashes is optional: models frequently
    // write "###Title", and rendering that literally looks broken.
    const heading = /^(#{1,6})\s*(\S.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = (`h${level + 2 > 6 ? 6 : level + 2}` as unknown) as "h3";
      blocks.push(
        <Tag key={`b${key++}`} className={`md-h md-h${level}`}>
          {inline(heading[2], `hd${key}`)}
        </Tag>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr key={`b${key++}`} className="md-hr" />);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={`b${key++}`} className="md-quote">
          {inline(body.join(" "), `q${key}`)}
        </blockquote>
      );
      continue;
    }

    // Lists
    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) {
        items.push(lines[i++].replace(ordered ? numbered : bullet, ""));
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`b${key++}`} className="md-list">
          {items.map((item, ii) => (
            <li key={ii}>{inline(item, `li${ii}`)}</li>
          ))}
        </Tag>
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: gather until a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s*\S/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    if (para.length > 0) {
      blocks.push(
        <p key={`b${key++}`} className="md-p">
          {inline(para.join("\n"), `p${key}`)}
        </p>
      );
    }
  }

  return <div className="md">{blocks}</div>;
}
