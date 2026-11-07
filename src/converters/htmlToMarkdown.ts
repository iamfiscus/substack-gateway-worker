// Port of gateway_core/converters/markdown.py `html_to_markdown` (upstream bc2e875).
// Upstream runs markdownify with ATX headings, `-` bullets, fenced code blocks
// and backslash line breaks; node-html-markdown is configured to match.

import { NodeHtmlMarkdown } from 'node-html-markdown';

const converter = new NodeHtmlMarkdown(
  {
    bulletMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    codeFence: '```',
    useInlineLinks: true,
    maxConsecutiveNewlines: 2,
  },
  // markdownify's BACKSLASH newline style: `<br>` becomes `\` + newline.
  { br: { content: '\\\n', recurse: false, spaceIfRepeatingChar: false } },
);

export function htmlToMarkdown(html: string): string {
  return converter.translate(html).trim();
}
