import sanitizeHtml from 'sanitize-html';

// Strict allowlist sanitizer for Gmail HTML bodies. The goal is to keep
// structural formatting (paragraphs, lists, tables, links, images) but
// strip everything that would either (a) leak email-author colors and
// fonts into the Notion-pivot palette, or (b) be a security hazard
// (scripts, event handlers, javascript: URLs, etc.).
//
// Inline style attributes are removed entirely — emails ship aggressive
// inline CSS that would otherwise override our type/colors. The
// .sb-mail-html container in globals.css enforces the look.

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

export function sanitizeEmailHtml(input: string | null | undefined): string {
  if (!input) return '';
  return sanitizeHtml(input, {
    allowedTags: [
      'p', 'br', 'div', 'span', 'pre', 'hr',
      'a', 'strong', 'em', 'b', 'i', 'u',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'q', 'cite',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'img',
      'sup', 'sub', 'small', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      // Drop everything else — no inline style, no class, no on*.
    },
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
    // Drop entire <style>/<script>/<head>/<title> blocks INCLUDING contents.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head', 'title'],
    // Belt + suspenders — sanitize-html already drops these by default,
    // but listing here makes the policy explicit.
    disallowedTagsMode: 'discard',
    parseStyleAttributes: false,
  });
}
