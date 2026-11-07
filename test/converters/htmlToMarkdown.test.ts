import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../src/converters/htmlToMarkdown';

// Expected strings are the output of upstream's
// `markdownify.markdownify(html, heading_style=ATX, bullets="-", newline_style=BACKSLASH).strip()`
// (gateway_core/converters/markdown.py at bc2e875), run via `uv run python` in upstream/.
describe('htmlToMarkdown', () => {
  const cases: [string, string, string][] = [
    [
      'headings, br and bullets',
      '<h2>T</h2><p>a<br>b</p><ul><li>x</li></ul>',
      '## T\n\na\\\nb\n\n- x',
    ],
    [
      'plain paragraph',
      '<p>This is the full post body in HTML.</p>',
      'This is the full post body in HTML.',
    ],
    [
      'inline marks and links',
      "<h1>H1</h1><p>Hello <strong>bold</strong> and <em>it</em> and <a href='https://x.com'>link</a></p>",
      '# H1\n\nHello **bold** and *it* and [link](https://x.com)',
    ],
    ['ordered list', '<ol><li>one</li><li>two</li></ol>', '1. one\n2. two'],
    ['fenced code', '<pre><code>a = 1\nb = 2</code></pre>', '```\na = 1\nb = 2\n```'],
    ['blockquote', '<blockquote><p>quoted</p></blockquote>', '> quoted'],
    [
      'escapes underscores and asterisks',
      '<p>snake_case 2*3 # not</p>',
      'snake\\_case 2\\*3 # not',
    ],
    ['consecutive br', '<p>a<br><br>b</p>', 'a\\\n\\\nb'],
    ['image', "<img src='a.png' alt='pic'>", '![pic](a.png)'],
    ['rule', '<p>one</p><hr><p>two</p>', 'one\n\n---\n\ntwo'],
    ['inline code', '<p>x <code>y</code></p>', 'x `y`'],
    ['whitespace only', '<p>   </p>', ''],
    ['empty', '', ''],
  ];
  it.each(cases)('%s', (_name, html, expected) => {
    expect(htmlToMarkdown(html)).toBe(expected);
  });
});
