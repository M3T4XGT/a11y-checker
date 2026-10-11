/**
 * Accessibility rules.
 * Each rule receives a parsed Document and returns a list of issues:
 * { severity: 'error' | 'warning', message, element }
 */

const VAGUE_LINK_TEXT = ['click here', 'here', 'read more', 'more', 'link', 'learn more'];

function snippet(el) {
  const html = el.outerHTML;
  return html.length > 160 ? html.slice(0, 160) + '…' : html;
}

function accessibleName(el, doc) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map(id => doc.getElementById(id)?.textContent || '')
      .join(' ').trim();
    if (text) return text;
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const imgAlt = [...el.querySelectorAll('img[alt]')].map(i => i.getAttribute('alt')).join(' ');
  const text = (el.textContent + ' ' + imgAlt).trim();
  if (text) return text;

  return (el.getAttribute('title') || '').trim();
}

/* ---------- Color contrast helpers ---------- */

function parseColor(value) {
  if (!value) return null;
  value = value.trim().toLowerCase();
  const named = { black: '#000000', white: '#ffffff', red: '#ff0000', gray: '#808080', grey: '#808080', yellow: '#ffff00', blue: '#0000ff', green: '#008000' };
  if (named[value]) value = named[value];

  let m = value.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map(c => parseInt(c + c, 16));
  m = value.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [m[1], m[2], m[3]].map(Number);
  return null;
}

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function inlineStyle(el, prop) {
  const style = el.getAttribute('style') || '';
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i');
  const m = style.match(re);
  return m ? m[1].trim() : null;
}

function findInlineBackground(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    const bg = inlineStyle(node, 'background-color') || inlineStyle(node, 'background');
    const parsed = parseColor(bg);
    if (parsed) return parsed;
    node = node.parentElement;
  }
  return [255, 255, 255];
}

/* ---------- Contrast on a rendered page (uses real CSS) ---------- */

const MAX_CONTRAST_ISSUES = 40;

function parseRgba(value) {
  const m = value && value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4] && m[4].endsWith('%')) a /= 100;
  return { rgb: [m[1], m[2], m[3]].map(Number), a };
}

function blend(top, bottom) {
  return top.rgb.map((c, i) => c * top.a + bottom[i] * (1 - top.a));
}

// Returns the solid background color behind an element, or null when a
// background image or gradient makes it impossible to know.
function renderedBackground(el, win) {
  const layers = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const cs = win.getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const bg = parseRgba(cs.backgroundColor);
    if (bg && bg.a > 0) {
      layers.push(bg);
      if (bg.a >= 1) break;
    }
    node = node.parentElement;
  }
  let color = [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) color = blend(layers[i], color);
  return color;
}

function hasOwnText(el) {
  return [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
}

function isVisible(el, win) {
  let node = el;
  while (node && node.nodeType === 1) {
    const cs = win.getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    node = node.parentElement;
  }
  // Screen-reader-only text (clipped to 1px) is not visible on screen.
  const rect = el.getBoundingClientRect();
  return !(rect.width <= 1 && rect.height <= 1);
}

function renderedContrastIssues(rdoc) {
  const win = rdoc.defaultView;
  const issues = [];
  let skipped = 0;
  const seen = new Set();

  for (const el of rdoc.body ? rdoc.body.querySelectorAll('*') : []) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'].includes(el.tagName.toUpperCase())) continue;
    if (!hasOwnText(el) || !isVisible(el, win)) continue;

    const cs = win.getComputedStyle(el);
    const fg = parseRgba(cs.color);
    if (!fg) continue;
    const bg = renderedBackground(el, win);
    if (!bg) continue; // text on an image: needs a manual check

    const fgSolid = fg.a < 1 ? blend(fg, bg) : fg.rgb;
    const ratio = contrastRatio(fgSolid, bg);
    const size = parseFloat(cs.fontSize) || 16;
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const needed = large ? 3 : 4.5;
    if (ratio >= needed) continue;

    // Group repeats of the same color pair so one CSS rule doesn't flood the report.
    const key = fgSolid.map(Math.round).join() + '|' + bg.map(Math.round).join() + '|' + needed;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    if (issues.length >= MAX_CONTRAST_ISSUES) { skipped++; continue; }
    const toHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    issues.push({
      severity: 'error',
      element: el,
      note: `Contrast is ${ratio.toFixed(2)}:1, needs ${needed}:1. Text ${toHex(fgSolid)} on ${toHex(bg)}, ${Math.round(size)}px.`
    });
  }

  if (skipped && issues.length) {
    issues[issues.length - 1].note += ` (${skipped} more elements use the same or similar low-contrast colors.)`;
  }
  return issues;
}

/* ---------- Rules ---------- */

const RULES = [
  {
    id: 'html-lang',
    title: 'Page language is missing',
    wcag: '3.1.1 Language of Page (A)',
    fix: 'Add a lang attribute, for example <html lang="en">.',
    run(doc, isFullPage) {
      if (!isFullPage) return [];
      const lang = doc.documentElement.getAttribute('lang');
      return lang && lang.trim() ? [] : [{ severity: 'error', element: doc.documentElement, html: '<html>' }];
    }
  },
  {
    id: 'page-title',
    title: 'Page title is missing or empty',
    wcag: '2.4.2 Page Titled (A)',
    fix: 'Add a descriptive <title> inside <head>.',
    run(doc, isFullPage) {
      if (!isFullPage) return [];
      const t = doc.querySelector('title');
      return t && t.textContent.trim() ? [] : [{ severity: 'error', html: '<head>' }];
    }
  },
  {
    id: 'img-alt',
    title: 'Image has no alt attribute',
    wcag: '1.1.1 Non-text Content (A)',
    fix: 'Add alt text that describes the image, or alt="" if it is purely decorative.',
    run(doc) {
      return [...doc.querySelectorAll('img:not([alt])')]
        .filter(img => img.getAttribute('role') !== 'presentation' && img.getAttribute('aria-hidden') !== 'true')
        .map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'img-alt-filename',
    title: 'Image alt text looks like a file name',
    wcag: '1.1.1 Non-text Content (A)',
    fix: 'Describe what the image shows instead of using the file name.',
    run(doc) {
      return [...doc.querySelectorAll('img[alt]')]
        .filter(img => /\.(png|jpe?g|gif|svg|webp)$/i.test(img.getAttribute('alt').trim()) || /^(image|img|photo|picture)$/i.test(img.getAttribute('alt').trim()))
        .map(element => ({ severity: 'warning', element }));
    }
  },
  {
    id: 'form-label',
    title: 'Form field has no label',
    wcag: '1.3.1 Info and Relationships (A), 4.1.2 Name, Role, Value (A)',
    fix: 'Connect a <label for="id"> to the field, wrap it in a <label>, or add aria-label.',
    run(doc) {
      const fields = doc.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea');
      return [...fields].filter(f => {
        if (f.getAttribute('aria-label')?.trim() || f.getAttribute('aria-labelledby')) return false;
        if (f.closest('label')) return false;
        if (f.id && doc.querySelector(`label[for="${CSS.escape(f.id)}"]`)) return false;
        return true;
      }).map(element => ({
        severity: 'error',
        element,
        note: element.getAttribute('placeholder') ? 'A placeholder is not a replacement for a label.' : ''
      }));
    }
  },
  {
    id: 'empty-link',
    title: 'Link has no accessible name',
    wcag: '2.4.4 Link Purpose (A)',
    fix: 'Give the link visible text, or an aria-label if it only contains an icon.',
    run(doc) {
      return [...doc.querySelectorAll('a[href]')]
        .filter(a => !accessibleName(a, doc))
        .map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'vague-link',
    title: 'Link text is not descriptive',
    wcag: '2.4.4 Link Purpose (A)',
    fix: 'Use link text that makes sense on its own, like "Download the 2026 course catalog".',
    run(doc) {
      return [...doc.querySelectorAll('a[href]')]
        .filter(a => VAGUE_LINK_TEXT.includes(accessibleName(a, doc).toLowerCase()))
        .map(element => ({ severity: 'warning', element }));
    }
  },
  {
    id: 'empty-button',
    title: 'Button has no accessible name',
    wcag: '4.1.2 Name, Role, Value (A)',
    fix: 'Add text inside the button, or an aria-label for icon-only buttons.',
    run(doc) {
      const buttons = doc.querySelectorAll('button, [role="button"], input[type=submit], input[type=button], input[type=reset]');
      return [...buttons].filter(b => {
        if (b.tagName === 'INPUT') {
          return b.getAttribute('type') !== 'submit' && b.getAttribute('type') !== 'reset' && !b.value?.trim() && !b.getAttribute('aria-label');
        }
        return !accessibleName(b, doc);
      }).map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'heading-order',
    title: 'Heading level is skipped',
    wcag: '1.3.1 Info and Relationships (A)',
    fix: 'Go down one level at a time (h1 → h2 → h3). Use CSS to change the size instead.',
    run(doc) {
      const issues = [];
      let last = 0;
      doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        const level = Number(h.tagName[1]);
        if (last && level > last + 1) {
          issues.push({ severity: 'warning', element: h, note: `Jumped from h${last} to h${level}.` });
        }
        last = level;
      });
      return issues;
    }
  },
  {
    id: 'no-h1',
    title: 'Page has no h1 heading',
    wcag: '1.3.1 Info and Relationships (A), 2.4.6 Headings and Labels (AA)',
    fix: 'Add one <h1> that describes the main purpose of the page.',
    run(doc, isFullPage) {
      return isFullPage && !doc.querySelector('h1') ? [{ severity: 'warning', html: '<body>' }] : [];
    }
  },
  {
    id: 'empty-heading',
    title: 'Heading is empty',
    wcag: '2.4.6 Headings and Labels (AA)',
    fix: 'Add text to the heading or remove it.',
    run(doc) {
      return [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .filter(h => !accessibleName(h, doc))
        .map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'duplicate-id',
    title: 'Duplicate id attribute',
    wcag: '4.1.1 Parsing (A)',
    fix: 'Make each id unique. Labels and ARIA references break when ids repeat.',
    run(doc) {
      const seen = new Map();
      doc.querySelectorAll('[id]').forEach(el => {
        const list = seen.get(el.id) || [];
        list.push(el);
        seen.set(el.id, list);
      });
      return [...seen.entries()]
        .filter(([, els]) => els.length > 1)
        .map(([id, els]) => ({ severity: 'error', element: els[1], note: `id="${id}" is used ${els.length} times.` }));
    }
  },
  {
    id: 'positive-tabindex',
    title: 'Positive tabindex changes focus order',
    wcag: '2.4.3 Focus Order (A)',
    fix: 'Use tabindex="0" or "-1" only, and fix the order in the HTML instead.',
    run(doc) {
      return [...doc.querySelectorAll('[tabindex]')]
        .filter(el => Number(el.getAttribute('tabindex')) > 0)
        .map(element => ({ severity: 'warning', element }));
    }
  },
  {
    id: 'iframe-title',
    title: 'iframe has no title',
    wcag: '4.1.2 Name, Role, Value (A)',
    fix: 'Add a title that describes the embedded content, for example title="Campus map".',
    run(doc) {
      return [...doc.querySelectorAll('iframe')]
        .filter(f => !f.getAttribute('title')?.trim() && !f.getAttribute('aria-label')?.trim())
        .map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'table-headers',
    title: 'Data table has no header cells',
    wcag: '1.3.1 Info and Relationships (A)',
    fix: 'Use <th scope="col"> or <th scope="row"> for header cells.',
    run(doc) {
      return [...doc.querySelectorAll('table')]
        .filter(t => t.getAttribute('role') !== 'presentation' && !t.querySelector('th'))
        .map(element => ({ severity: 'warning', element }));
    }
  },
  {
    id: 'autoplay',
    title: 'Media plays automatically',
    wcag: '1.4.2 Audio Control (A)',
    fix: 'Remove autoplay, or make sure the media is muted and has visible controls.',
    run(doc) {
      return [...doc.querySelectorAll('video[autoplay], audio[autoplay]')]
        .filter(m => !m.hasAttribute('muted'))
        .map(element => ({ severity: 'error', element }));
    }
  },
  {
    id: 'zoom-disabled',
    title: 'Zooming is disabled',
    wcag: '1.4.4 Resize Text (AA)',
    fix: 'Remove user-scalable=no and maximum-scale from the viewport meta tag.',
    run(doc) {
      const meta = doc.querySelector('meta[name="viewport"]');
      if (!meta) return [];
      const content = (meta.getAttribute('content') || '').toLowerCase().replace(/\s/g, '');
      const max = content.match(/maximum-scale=([\d.]+)/);
      return content.includes('user-scalable=no') || content.includes('user-scalable=0') || (max && Number(max[1]) < 2)
        ? [{ severity: 'error', element: meta }]
        : [];
    }
  },
  {
    id: 'color-contrast',
    title: 'Text color contrast is too low',
    wcag: '1.4.3 Contrast (Minimum) (AA)',
    fix: 'Use at least 4.5:1 for normal text, or 3:1 for large text (24px, or 18.66px bold).',
    run(doc, isFullPage, ctx) {
      if (ctx && ctx.renderedDoc) return renderedContrastIssues(ctx.renderedDoc);

      // Fallback: page could not be rendered, so check inline styles only.
      const issues = [];
      doc.querySelectorAll('[style*="color"]').forEach(el => {
        const fg = parseColor(inlineStyle(el, 'color'));
        if (!fg || !el.textContent.trim()) return;
        const bg = findInlineBackground(el);
        const ratio = contrastRatio(fg, bg);
        const size = parseFloat(inlineStyle(el, 'font-size')) || 16;
        const bold = /bold|[6-9]00/.test(inlineStyle(el, 'font-weight') || '') || /^(B|STRONG|H[1-6])$/.test(el.tagName);
        const large = size >= 24 || (bold && size >= 18.66);
        const needed = large ? 3 : 4.5;
        if (ratio < needed) {
          issues.push({ severity: 'error', element: el, note: `Contrast is ${ratio.toFixed(2)}:1, needs ${needed}:1. (Only inline styles are checked.)` });
        }
      });
      return issues;
    }
  }
];

/** True when the text contains at least one HTML tag. */
function looksLikeHtml(text) {
  return /<\s*[a-z!][^>]*>/i.test(text);
}

/** True when the text is just a web address. */
function looksLikeUrl(text) {
  return /^(https?:\/\/|www\.)\S+$/i.test(text.trim());
}

/**
 * Runs every rule.
 * options.renderedDoc: the same page rendered in an iframe, so styles
 * from stylesheets can be measured for the contrast check.
 */
function runChecks(html, options = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const isFullPage = /<html[\s>]/i.test(html);
  const issues = [];
  const ctx = { renderedDoc: options.renderedDoc || null };

  RULES.forEach(rule => {
    rule.run(doc, isFullPage, ctx).forEach(found => {
      issues.push({
        id: rule.id,
        title: rule.title,
        wcag: rule.wcag,
        fix: rule.fix,
        severity: found.severity,
        note: found.note || '',
        code: found.html || (found.element ? snippet(found.element) : '')
      });
    });
  });

  return { issues, rulesRun: RULES.length };
}

if (typeof module !== 'undefined') module.exports = { runChecks, contrastRatio, parseColor, looksLikeHtml, looksLikeUrl };
