const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const urlBtn = document.getElementById('url-btn');
const htmlForm = document.getElementById('check-form');
const input = document.getElementById('html-input');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const results = document.getElementById('results');
const resultsHeading = document.getElementById('results-heading');
const summary = document.getElementById('summary');
const list = document.getElementById('issue-list');
const filterButtons = document.querySelectorAll('.filter');

const RENDER_TIMEOUT = 10000;

let currentIssues = [];
let currentFilter = 'all';

const SAMPLE = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, user-scalable=no">
  <style>.muted { color: #aaaaaa; }</style>
</head>
<body>
  <h1>Welcome</h1>
  <h3>Upcoming events</h3>
  <img src="campus.jpg">
  <p class="muted">Registration closes Friday.</p>
  <a href="/events">Click here</a>
  <a href="/search"><i class="icon-search"></i></a>
  <form>
    <input type="email" placeholder="Your email">
    <button></button>
  </form>
  <div id="note">One</div>
  <div id="note">Two</div>
  <iframe src="https://example.com/map"></iframe>
</body>
</html>`;

/* ---------- Helpers ---------- */

function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  statusEl.textContent = '';
  results.hidden = true;
}

function clearMessages() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function setBusy(busy, message = '') {
  urlBtn.disabled = busy;
  htmlForm.querySelector('button[type=submit]').disabled = busy;
  statusEl.textContent = message;
}

/**
 * Renders the HTML in a hidden, script-free iframe so the browser applies
 * all the page's CSS. Resolves with the rendered document, or null.
 */
function renderPage(html, baseUrl) {
  return new Promise(resolve => {
    document.getElementById('render-frame')?.remove();

    let source = html;
    if (baseUrl) {
      const base = `<base href="${escapeText(baseUrl)}">`;
      source = /<head[^>]*>/i.test(source)
        ? source.replace(/<head[^>]*>/i, m => m + base)
        : base + source;
    }

    const frame = document.createElement('iframe');
    frame.id = 'render-frame';
    frame.title = 'Hidden preview used for color contrast checks';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('sandbox', 'allow-same-origin'); // no scripts, no forms, no popups

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        resolve(frame.contentDocument && frame.contentDocument.body ? frame.contentDocument : null);
      } catch {
        resolve(null);
      }
    };
    frame.addEventListener('load', finish);
    setTimeout(finish, RENDER_TIMEOUT);

    frame.srcdoc = source;
    document.body.appendChild(frame);
  });
}

/* ---------- Running a check ---------- */

async function check(html, sourceUrl) {
  setBusy(true, 'Rendering the page to measure colors…');
  const renderedDoc = await renderPage(html, sourceUrl);

  setBusy(true, 'Running checks…');
  const { issues } = runChecks(html, { renderedDoc });
  setBusy(false);

  currentIssues = issues.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  currentFilter = 'all';
  filterButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === 'all')));

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  let text = issues.length
    ? `Found ${errors} error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'}.`
    : 'No issues found by the automated checks.';
  if (sourceUrl) text = `${text} Checked ${sourceUrl}`;
  if (!renderedDoc) text += ' (Colors could only be checked from inline styles.)';

  // Pages built entirely with JavaScript send almost no HTML to begin with.
  const textLength = new DOMParser().parseFromString(html, 'text/html').body?.textContent.trim().length || 0;
  if (sourceUrl && textLength < 200) {
    text += ' This page seems to build its content with JavaScript, so most of it could not be checked.';
  }

  summary.textContent = text;
  results.hidden = false;
  render();
  resultsHeading.focus();
}

function render() {
  list.innerHTML = '';

  if (currentIssues.length === 0) {
    list.innerHTML = '<li class="pass">No issues found by the automated checks.</li>';
    return;
  }

  currentIssues
    .filter(i => currentFilter === 'all' || i.severity === currentFilter)
    .forEach(issue => {
      const li = document.createElement('li');
      li.className = `issue ${issue.severity}`;
      li.innerHTML = `
        <h3><span class="badge ${issue.severity}">${issue.severity}</span>${escapeText(issue.title)}</h3>
        <p class="wcag">WCAG ${escapeText(issue.wcag)}</p>
        ${issue.note ? `<p>${escapeText(issue.note)}</p>` : ''}
        <p><strong>How to fix:</strong> ${escapeText(issue.fix)}</p>
        ${issue.code ? `<code>${escapeText(issue.code)}</code>` : ''}
      `;
      list.appendChild(li);
    });
}

/* ---------- Events ---------- */

urlForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearMessages();
  const url = urlInput.value.trim();
  setBusy(true, 'Downloading the page…');

  let data;
  try {
    const response = await fetch('fetch.php?url=' + encodeURIComponent(url));
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      throw new Error('URL checking needs PHP. Run the project with "php -S localhost:8000" (see the README), or paste the page source in the HTML box instead.');
    }
    data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load that page.');
  } catch (err) {
    setBusy(false);
    const message = err instanceof TypeError
      ? 'Could not reach fetch.php. URL checking needs PHP (see the README). You can paste the page source in the HTML box instead.'
      : err.message;
    showError(message);
    return;
  }

  await check(data.html, data.url);
});

htmlForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearMessages();
  const value = input.value.trim();

  if (looksLikeUrl(value)) {
    urlInput.value = value;
    showError('That is a web address, not HTML. Use the "Web page address" box above to check a link. It has been copied there for you.');
    urlInput.focus();
    return;
  }
  if (!looksLikeHtml(value)) {
    showError('No HTML tags were found. Paste HTML code (it starts with < like <div> or <!DOCTYPE html>).');
    input.focus();
    return;
  }

  await check(value, null);
});

filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    filterButtons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
});

document.getElementById('sample-btn').addEventListener('click', () => {
  input.value = SAMPLE;
  input.focus();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  input.value = '';
  urlInput.value = '';
  results.hidden = true;
  clearMessages();
  input.focus();
});
