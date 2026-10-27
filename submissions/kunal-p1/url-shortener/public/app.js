/**
 * Dashboard behaviour: plain DOM APIs, no framework, no build step.
 *
 * Security notes:
 * - All server data is written with `textContent` (never `innerHTML`), so a
 *   stored target URL or user agent cannot inject markup.
 * - The API key lives in `sessionStorage` only and is cleared when the tab closes.
 * - Outbound links use `rel="noopener noreferrer nofollow"`.
 */
(function () {
  'use strict';

  var API_KEY_STORAGE = 'url-shortener.apiKey';

  var els = {
    form: document.getElementById('shorten-form'),
    url: document.getElementById('url'),
    alias: document.getElementById('alias'),
    expiresAt: document.getElementById('expiresAt'),
    apiKey: document.getElementById('apiKey'),
    submit: document.getElementById('submit-btn'),
    refresh: document.getElementById('refresh-btn'),
    formError: document.getElementById('form-error'),
    result: document.getElementById('result'),
    resultLink: document.getElementById('result-link'),
    resultCode: document.getElementById('result-code'),
    resultTarget: document.getElementById('result-target'),
    resultExpires: document.getElementById('result-expires'),
    copy: document.getElementById('copy-btn'),
    statsCode: document.getElementById('stats-code'),
    statsEmpty: document.getElementById('stats-empty'),
    statsPanel: document.getElementById('stats-panel'),
    statsError: document.getElementById('stats-error'),
    statTotal: document.getElementById('stat-total'),
    statUnique: document.getElementById('stat-unique'),
    statLast: document.getElementById('stat-last'),
    statStatus: document.getElementById('stat-status'),
    chart: document.getElementById('chart'),
    linksBody: document.getElementById('links-body'),
  };

  /** @returns {string} stored key, or '' */
  function getStoredKey() {
    try {
      return sessionStorage.getItem(API_KEY_STORAGE) || '';
    } catch (_error) {
      return '';
    }
  }

  function setStoredKey(value) {
    try {
      if (value) sessionStorage.setItem(API_KEY_STORAGE, value);
      else sessionStorage.removeItem(API_KEY_STORAGE);
    } catch (_error) {
      /* private mode: ignore */
    }
  }

  function authHeaders() {
    var key = (els.apiKey.value || '').trim() || getStoredKey();
    return key ? { Authorization: 'Bearer ' + key } : {};
  }

  function showError(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function clearError(node) {
    node.textContent = '';
    node.hidden = true;
  }

  /**
   * Read the JSON body defensively: an unexpected HTML error page must not
   * throw a parse error that hides the real status code.
   */
  async function readJson(response) {
    var text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_error) {
      return { error: { message: text.slice(0, 200) } };
    }
  }

  function describeError(body, status) {
    if (body && body.error) {
      var message = body.error.message || 'Request failed';
      if (body.error.code) return message + ' (' + body.error.code + ')';
      return message;
    }
    return 'Request failed with status ' + status;
  }

  /** datetime-local -> ISO-8601 UTC string, or undefined when empty. */
  function toIsoOrUndefined(value) {
    if (!value) return undefined;
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
  }

  function formatDateTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function renderResult(payload) {
    els.resultLink.textContent = payload.shortUrl;
    els.resultLink.href = payload.shortUrl;
    els.resultCode.textContent = payload.code;
    els.resultTarget.textContent = payload.targetUrl;
    els.resultTarget.title = payload.targetUrl;
    els.resultExpires.textContent = payload.expiresAt ? formatDateTime(payload.expiresAt) : 'Never';
    els.result.hidden = false;
  }

  async function shorten(event) {
    event.preventDefault();
    clearError(els.formError);

    var url = els.url.value.trim();
    if (!url) {
      showError(els.formError, 'Enter a URL to shorten.');
      els.url.focus();
      return;
    }

    var body = { url: url };
    var alias = els.alias.value.trim();
    if (alias) body.alias = alias;
    var expiresAt = toIsoOrUndefined(els.expiresAt.value);
    if (expiresAt) body.expiresAt = expiresAt;

    var key = (els.apiKey.value || '').trim();
    if (key) setStoredKey(key);

    els.submit.disabled = true;
    els.submit.textContent = 'Shortening…';

    try {
      var response = await fetch('/shorten', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body),
      });
      var payload = await readJson(response);

      if (!response.ok) {
        showError(els.formError, describeError(payload, response.status));
        return;
      }

      renderResult(payload);
      els.alias.value = '';
      els.expiresAt.value = '';
      loadStats(payload.code);
      loadLinks();
    } catch (error) {
      showError(
        els.formError,
        'Network error: ' + (error && error.message ? error.message : 'unknown'),
      );
    } finally {
      els.submit.disabled = false;
      els.submit.textContent = 'Shorten';
    }
  }

  function renderChart(series) {
    els.chart.textContent = '';
    if (!series || series.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No clicks recorded yet.';
      els.chart.appendChild(empty);
      return;
    }

    var max = series.reduce(function (acc, point) {
      return Math.max(acc, point.clicks);
    }, 0);

    series.forEach(function (point) {
      var bar = document.createElement('div');
      bar.className = 'bar';
      var heightPct = max === 0 ? 4 : Math.max(4, Math.round((point.clicks / max) * 100));
      bar.style.height = heightPct + '%';
      bar.setAttribute('data-zero', point.clicks === 0 ? 'true' : 'false');
      bar.title = point.date + ': ' + point.clicks + (point.clicks === 1 ? ' click' : ' clicks');
      bar.setAttribute('aria-label', bar.title);
      els.chart.appendChild(bar);
    });
  }

  async function loadStats(code) {
    if (!code) {
      els.statsPanel.hidden = true;
      els.statsEmpty.hidden = false;
      return;
    }
    clearError(els.statsError);
    els.statsCode.value = code;

    try {
      var response = await fetch('/stats/' + encodeURIComponent(code), {
        headers: authHeaders(),
      });
      var payload = await readJson(response);

      if (!response.ok) {
        els.statsPanel.hidden = true;
        els.statsEmpty.hidden = true;
        showError(els.statsError, describeError(payload, response.status));
        return;
      }

      els.statsEmpty.hidden = true;
      els.statsPanel.hidden = false;
      els.statTotal.textContent = String(payload.totalClicks);
      els.statUnique.textContent = String(payload.uniqueVisitors);
      els.statLast.textContent = formatDateTime(payload.lastAccessedAt);
      els.statStatus.textContent = payload.deletedAt
        ? 'Deleted'
        : payload.expired
          ? 'Expired'
          : 'Active';
      renderChart(payload.clicksPerDay);
    } catch (error) {
      els.statsPanel.hidden = true;
      showError(
        els.statsError,
        'Network error: ' + (error && error.message ? error.message : 'unknown'),
      );
    }
  }

  function statusBadge(item) {
    var span = document.createElement('span');
    if (item.expired) {
      span.className = 'badge warn';
      span.textContent = 'Expired';
    } else if (item.expiresAt) {
      span.className = 'badge muted';
      span.textContent = 'Expiring';
    } else {
      span.className = 'badge ok';
      span.textContent = 'Active';
    }
    return span;
  }

  function renderLinks(items) {
    els.linksBody.textContent = '';

    if (!items || items.length === 0) {
      var row = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'empty';
      cell.textContent = 'No links yet. Shorten one above.';
      row.appendChild(cell);
      els.linksBody.appendChild(row);
      return;
    }

    items.forEach(function (item) {
      var tr = document.createElement('tr');

      var codeCell = document.createElement('td');
      var codeButton = document.createElement('button');
      codeButton.type = 'button';
      codeButton.className = 'code-btn';
      codeButton.textContent = item.code;
      codeButton.addEventListener('click', function () {
        loadStats(item.code);
      });
      codeCell.appendChild(codeButton);
      tr.appendChild(codeCell);

      var targetCell = document.createElement('td');
      targetCell.className = 'target-cell';
      targetCell.textContent = item.url;
      targetCell.title = item.url;
      tr.appendChild(targetCell);

      var clicksCell = document.createElement('td');
      clicksCell.textContent = String(item.clickCount);
      tr.appendChild(clicksCell);

      var createdCell = document.createElement('td');
      createdCell.textContent = formatDate(item.createdAt);
      tr.appendChild(createdCell);

      var statusCell = document.createElement('td');
      statusCell.appendChild(statusBadge(item));
      tr.appendChild(statusCell);

      els.linksBody.appendChild(tr);
    });
  }

  async function loadLinks() {
    try {
      var response = await fetch('/links?limit=50', { headers: authHeaders() });
      var payload = await readJson(response);
      if (!response.ok) {
        if (response.status === 401) {
          showError(els.formError, 'Add an API key to list links.');
        } else {
          showError(els.formError, describeError(payload, response.status));
        }
        return;
      }
      renderLinks(payload.items);
    } catch (error) {
      showError(
        els.formError,
        'Could not load links: ' + (error && error.message ? error.message : 'unknown'),
      );
    }
  }

  async function copyResult() {
    var value = els.resultLink.textContent || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      els.copy.textContent = 'Copied';
      setTimeout(function () {
        els.copy.textContent = 'Copy';
      }, 1500);
    } catch (_error) {
      var range = document.createRange();
      range.selectNodeContents(els.resultLink);
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      els.copy.textContent = 'Press Ctrl+C';
    }
  }

  els.form.addEventListener('submit', shorten);
  els.refresh.addEventListener('click', loadLinks);
  els.copy.addEventListener('click', copyResult);
  els.statsCode.addEventListener('change', function () {
    loadStats(els.statsCode.value.trim());
  });

  var stored = getStoredKey();
  if (stored) els.apiKey.value = stored;

  loadLinks();
})();
