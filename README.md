# Accessibility Checker

A browser-based tool that checks HTML for common WCAG 2.1 AA accessibility problems. Paste a page or a snippet, and it lists each issue with the WCAG criterion, an explanation of how to fix it, and the code that caused it.

Everything runs in the browser with plain HTML, CSS, and JavaScript. No frameworks, no build step, and nothing is uploaded.

## What it checks

| Check | WCAG |
|---|---|
| Missing page language (`lang`) | 3.1.1 |
| Missing or empty `<title>` | 2.4.2 |
| Images without `alt`, or alt text that is a file name | 1.1.1 |
| Form fields without labels | 1.3.1, 4.1.2 |
| Links and buttons with no accessible name | 2.4.4, 4.1.2 |
| Vague link text ("click here", "read more") | 2.4.4 |
| Skipped heading levels, empty headings, missing `h1` | 1.3.1, 2.4.6 |
| Duplicate `id` values | 4.1.1 |
| Positive `tabindex` | 2.4.3 |
| `iframe` without a title | 4.1.2 |
| Tables without header cells | 1.3.1 |
| Autoplaying audio or video | 1.4.2 |
| Zoom disabled in the viewport meta tag | 1.4.4 |
| Low text contrast (inline styles) | 1.4.3 |

## Run it

Open `index.html` in a browser. Click **Load sample** to see it in action.

## Limitations

Automated tools find only part of real accessibility problems. Contrast is checked only for inline `style` colors, not external stylesheets. Always test with a keyboard and a screen reader as well.

## Ideas for next steps

- Check a live URL through a small PHP proxy
- Read colors from `<style>` blocks
- Export the report as CSV or PDF
- Highlight the problem in a preview of the page
