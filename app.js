const form = document.getElementById('check-form');
const input = document.getElementById('html-input');
const results = document.getElementById('results');
const resultsHeading = document.getElementById('results-heading');
const summary = document.getElementById('summary');
const list = document.getElementById('issue-list');
const filterButtons = document.querySelectorAll('.filter');

let currentIssues = [];
let currentFilter = 'all';

const SAMPLE = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, user-scalable=no">
</head>
<body>
  <h1>Welcome</h1>
  <h3>Upcoming events</h3>
  <img src="campus.jpg">
  <p style="color:#999999">Registration closes Friday.</p>
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

function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function render() {
  list.innerHTML = '';
  const visible = currentIssues.filter(i => currentFilter === 'all' || i.severity === currentFilter);

  if (currentIssues.length === 0) {
    list.innerHTML = '<li class="pass">No issues found by the automated checks.</li>';
    return;
  }

  visible.forEach(issue => {
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

form.addEventListener('submit', e => {
  e.preventDefault();
  const { issues } = runChecks(input.value);
  currentIssues = issues.sort((a, b) => (a.severity === 'error' ? -1 : 1) - (b.severity === 'error' ? -1 : 1));

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  summary.textContent = issues.length
    ? `Found ${errors} error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'}.`
    : 'No issues found.';

  results.hidden = false;
  render();
  resultsHeading.focus();
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
  results.hidden = true;
  input.focus();
});
