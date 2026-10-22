import React from "react";

// The few Markdown bits Bannergress renders in descriptions (paragraphs, line
// breaks, bold, italics, lists, links), built as React elements: no HTML is
// ever injected, and links are http(s) only.
const INLINE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;

function link(href, text, key) {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
      {text}
    </a>
  );
}

export function renderInline(text, keyPrefix = "i") {
  const out = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      out.push(link(match[3], match[2], key));
    } else if (match[4]) {
      out.push(link(match[4], match[4], key));
    } else if (match[5]) {
      out.push(<strong key={key}>{renderInline(match[6] ?? match[7], key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(match[9] ?? match[10], key)}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

function withBreaks(lines, key) {
  return lines.flatMap((line, i) => [
    ...(i ? [<br key={`${key}-br-${i}`} />] : []),
    ...renderInline(line, `${key}-${i}`),
  ]);
}

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export default function SimpleMarkdown({ text, className = "" }) {
  const blocks = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((line) => line.trim() !== ""))
    .filter((lines) => lines.length);

  return (
    <div className={className}>
      {blocks.map((lines, b) => {
        const key = `b${b}`;
        if (lines.every((line) => BULLET.test(line)) || lines.every((line) => NUMBERED.test(line))) {
          const numbered = NUMBERED.test(lines[0]);
          const Tag = numbered ? "ol" : "ul";
          return (
            <Tag key={key}>
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>
                  {renderInline(line.replace(numbered ? NUMBERED : BULLET, ""), `${key}-${i}`)}
                </li>
              ))}
            </Tag>
          );
        }
        return <p key={key}>{withBreaks(lines, key)}</p>;
      })}
    </div>
  );
}
