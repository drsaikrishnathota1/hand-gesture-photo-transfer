(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const U = window.AirGestureIntelligenceUtils || {};

  const prettySegment = U.prettySegment || ((v) => String(v || 'Unclassified'));
  const prettyDevice = U.prettyDevice || ((v) => String(v || 'Unspecified'));
  const prettyBrowser = U.prettyBrowser || ((v) => String(v || 'Unspecified'));
  const prettyOs = U.prettyOs || ((v) => String(v || 'Unspecified'));
  const prettyFileType = U.prettyFileType || ((v) => String(v || 'Other'));
  const prettyLocation = U.prettyLocation || ((v) => String(v || 'Unspecified'));
  const prettyHourUtc = U.prettyHourUtc || ((v) => `${v} UTC`);
  const opportunityLabel = U.opportunityLabel || ((score) => Number(score || 0) >= 65 ? 'Strong' : 'Explore');

  const state = {
    snapshot: null,
    baseline: null,
    filters: {
      range: 'all',
      segment: '',
      location: '',
      fileType: '',
      device: '',
      os: '',
      browser: '',
      day: '',
      hour: ''
    },
    marketMetric: 'count',
    charts: new Map(),
    aiChart: null,
    loadController: null,
    aiController: null,
    aiHistory: [],
    loadSequence: 0,
    initialized: false,
    refreshTimer: null,
    toastTimer: null,
    currentMode: 'dashboard'
  };

  const palette = ['#39d8ff', '#6d94ff', '#8b7dff', '#3ad99d', '#f1c75b', '#ff7d8a', '#6ee7d7', '#c18cff'];

  const panelPrompts = {
    audience: 'Which audience should we focus on first, what product categories fit that audience, and what market should we use for a small test?',
    market: 'Which market should management test first, what evidence supports it, and what product should be tested there?',
    product: 'What commercial product ideas are suggested by the current file-type mix, and which one should we test first?',
    platform: 'How should the current operating-system mix affect product and marketing priorities?',
    timing: 'When should we test promotions or support coverage based on current usage timing?',
    usage: 'What does current usage intensity suggest about a feature-tier or premium experiment?'
  };

  const filterLabels = {
    range: 'Period', segment: 'Audience', location: 'Market', fileType: 'Content',
    device: 'Device', os: 'OS', browser: 'Browser', day: 'Day', hour: 'Hour'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value, max = 0) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(Number(value || 0));
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const scaled = bytes / (1024 ** index);
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)} ${units[index]}`;
  }

  function showToast(message) {
    const toast = $('intelligenceToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    });

    let data = null;
    try { data = await response.json(); } catch { data = null; }

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function currentQuery() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.filters)) {
      if (key === 'range' && value === 'all') continue;
      if (value === '' || value === null || value === undefined) continue;
      params.set(key, String(value));
    }
    return params.toString() ? `?${params}` : '';
  }

  function hasActiveFilters() {
    return Object.entries(state.filters).some(([key, value]) =>
      key === 'range' ? value !== 'all' : value !== '' && value !== null && value !== undefined
    );
  }

  function displayFilterValue(key, value) {
    if (key === 'segment') return prettySegment(value);
    if (key === 'location') return prettyLocation(value);
    if (key === 'fileType') return prettyFileType(value);
    if (key === 'device') return prettyDevice(value);
    if (key === 'os') return prettyOs(value);
    if (key === 'browser') return prettyBrowser(value);
    if (key === 'hour') return prettyHourUtc(value);
    if (key === 'range') {
      return ({ '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' })[value] || 'All data';
    }
    return String(value);
  }

  function destroyChart(id) {
    const chart = state.charts.get(id);
    if (chart) chart.destroy();
    state.charts.delete(id);
  }

  function chartColors() {
    return {
      text: '#aebfd2',
      grid: 'rgba(148,163,184,.08)',
      tooltip: '#071321'
    };
  }

  function baseChartOptions() {
    const colors = chartColors();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: colors.text,
            usePointStyle: true,
            boxWidth: 8,
            padding: 13,
            font: { family: 'Inter', size: 10, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: colors.tooltip,
          borderColor: 'rgba(56,217,255,.18)',
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#c7d7e8',
          padding: 10
        }
      }
    };
  }

  function renderDoughnut(id, items, options = {}) {
    destroyChart(id);
    const canvas = $(id);
    if (!canvas || !window.Chart) return;
    const safe = (items || []).filter((item) => Number(item?.count ?? item?.users ?? 0) > 0);
    const valueField = options.valueField || 'count';

    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: safe.map((item) => options.label ? options.label(item) : item.name),
        datasets: [{
          data: safe.map((item) => Number(item[valueField] || 0)),
          backgroundColor: safe.map((_, i) => palette[i % palette.length]),
          borderColor: '#081524',
          borderWidth: 3,
          hoverOffset: 7
        }]
      },
      options: {
        ...baseChartOptions(),
        cutout: '67%',
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          ...baseChartOptions().plugins,
          legend: { ...baseChartOptions().plugins.legend, position: 'bottom' },
          tooltip: {
            ...baseChartOptions().plugins.tooltip,
            callbacks: {
              label: (ctx) => {
                const item = safe[ctx.dataIndex];
                const metric = valueField === 'users' ? `${formatNumber(item.users)} users` : `${formatNumber(item.count)} events`;
                return ` ${metric}${item.share !== undefined ? ` · ${item.share}%` : ''}`;
              },
              afterLabel: (ctx) => safe[ctx.dataIndex]?.bytes ? `Recorded volume: ${formatBytes(safe[ctx.dataIndex].bytes)}` : ''
            }
          }
        },
        onHover: (event, elements) => {
          if (event?.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        onClick: (_event, elements) => {
          if (!elements.length || !options.onSelect) return;
          options.onSelect(safe[elements[0].index]);
        }
      }
    });
    state.charts.set(id, chart);
  }

  function renderBar(id, items, options = {}) {
    destroyChart(id);
    const canvas = $(id);
    if (!canvas || !window.Chart) return;
    const valueField = options.valueField || 'count';
    const safe = [...(items || [])]
      .filter((item) => Number(item?.[valueField] ?? 0) >= 0)
      .sort((a, b) => Number(b[valueField] || 0) - Number(a[valueField] || 0))
      .slice(0, options.limit || 10);
    const colors = chartColors();

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: safe.map((item) => options.label ? options.label(item) : item.name),
        datasets: [{
          label: options.datasetLabel || 'Events',
          data: safe.map((item) => Number(item[valueField] || 0)),
          backgroundColor: safe.map((_, i) => `${palette[i % palette.length]}b8`),
          borderColor: safe.map((_, i) => palette[i % palette.length]),
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 27
        }]
      },
      options: {
        ...baseChartOptions(),
        indexAxis: options.horizontal === false ? 'x' : 'y',
        interaction: { mode: 'nearest', intersect: true },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: colors.grid },
            ticks: {
              color: colors.text,
              callback: (value) => options.formatValue === 'bytes' ? formatBytes(value) : formatNumber(value)
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: options.horizontal === false ? colors.grid : 'transparent' },
            ticks: { color: colors.text, autoSkip: false, font: { family: 'Inter', size: 10 } }
          }
        },
        plugins: {
          ...baseChartOptions().plugins,
          legend: { display: false },
          tooltip: {
            ...baseChartOptions().plugins.tooltip,
            callbacks: {
              label: (ctx) => options.formatValue === 'bytes'
                ? ` ${formatBytes(ctx.raw)}`
                : ` ${formatNumber(ctx.raw)} ${options.valueSuffix || ''}`.trimEnd(),
              afterLabel: (ctx) => {
                const item = safe[ctx.dataIndex];
                return item?.users !== undefined && valueField !== 'users' ? `${formatNumber(item.users)} users` : '';
              }
            }
          }
        },
        onHover: (event, elements) => {
          if (event?.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        onClick: (_event, elements) => {
          if (!elements.length || !options.onSelect) return;
          options.onSelect(safe[elements[0].index]);
        }
      }
    });
    state.charts.set(id, chart);
  }

  function renderLine(id, items, options = {}) {
    destroyChart(id);
    const canvas = $(id);
    if (!canvas || !window.Chart) return;
    const safe = items || [];
    const colors = chartColors();

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: safe.map((item) => options.label ? options.label(item) : item.label),
        datasets: [{
          data: safe.map((item) => Number(item.count || item.value || 0)),
          borderColor: '#39d8ff',
          backgroundColor: 'rgba(57,216,255,.08)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: .3,
          fill: true
        }]
      },
      options: {
        ...baseChartOptions(),
        interaction: { mode: 'nearest', intersect: true },
        scales: {
          x: { grid: { color: 'transparent' }, ticks: { color: colors.text, autoSkip: true, maxTicksLimit: 12, maxRotation: 0, font: { size: 9 } } },
          y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text, callback: (v) => formatNumber(v) } }
        },
        plugins: { ...baseChartOptions().plugins, legend: { display: false } },
        onHover: (event, elements) => {
          if (event?.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        onClick: (_event, elements) => {
          if (!elements.length || !options.onSelect) return;
          options.onSelect(safe[elements[0].index]);
        }
      }
    });
    state.charts.set(id, chart);
  }

  function populateSelect(id, items, optionLabel) {
    const select = $(id);
    if (!select) return;
    const first = select.options[0]?.outerHTML || '<option value="">All</option>';
    const previous = select.value;
    select.innerHTML = first;
    for (const item of items || []) {
      if (!item?.name) continue;
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = optionLabel ? optionLabel(item) : item.name;
      select.append(option);
    }
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function populateFilters(snapshot) {
    populateSelect('segmentFilter', (snapshot.dimensions?.segments || []).filter((i) => prettySegment(i.name) !== 'Unclassified'), (i) => prettySegment(i.name));
    populateSelect('locationFilter', (snapshot.dimensions?.locations || []).filter((i) => prettyLocation(i.name) !== 'Unspecified'), (i) => `${prettyLocation(i.name)} (${formatNumber(i.count)})`);
    populateSelect('fileTypeFilter', snapshot.dimensions?.fileTypes || [], (i) => prettyFileType(i.name));
  }

  function syncFilterControls() {
    const map = { rangeFilter: 'range', segmentFilter: 'segment', locationFilter: 'location', fileTypeFilter: 'fileType' };
    for (const [id, key] of Object.entries(map)) {
      if ($(id)) $(id).value = String(state.filters[key] ?? '');
    }
  }

  function renderActiveFilters() {
    const container = $('activeFilters');
    if (!container) return;
    const active = Object.entries(state.filters).filter(([key, value]) => key === 'range' ? value !== 'all' : value !== '' && value !== null && value !== undefined);
    container.innerHTML = active.map(([key, value]) => `
      <span class="filter-chip">${escapeHtml(filterLabels[key] || key)}: ${escapeHtml(displayFilterValue(key, value))}
        <button type="button" data-remove-filter="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(filterLabels[key] || key)} filter">×</button>
      </span>
    `).join('');
  }

  function renderKpis(snapshot) {
    const k = snapshot.kpis || {};
    $('kpiEvents').textContent = formatNumber(k.events);
    $('kpiUsers').textContent = formatNumber(k.users);
    $('kpiMarkets').textContent = formatNumber(k.locations);
    $('kpiBytes').textContent = formatBytes(k.totalBytes);
    $('kpiSegment').textContent = k.topSegment ? prettySegment(k.topSegment) : '—';
    $('kpiSegmentShare').textContent = k.topSegment ? `${k.topSegmentShare}% of events` : 'No audience data';
    $('kpiFileType').textContent = k.topFileType ? prettyFileType(k.topFileType) : '—';
    $('kpiFileTypeShare').textContent = k.topFileType ? `${k.topFileTypeShare}% of events` : 'No content data';

    $('heroStatusText').textContent = snapshot.scope?.matchingRecords
      ? `Analysis ready · ${formatNumber(snapshot.scope.matchingRecords)} events in scope`
      : 'Collect more activity to begin analysis';

    const generated = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();
    $('lastUpdated').textContent = `Updated ${generated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  function renderAiStatus(snapshot) {
    const badge = $('aiStatusBadge');
    const provider = $('aiProviderLabel');
    if (!badge) return;
    const configured = Boolean(snapshot?.ai?.configured);
    badge.classList.toggle('live', configured);
    badge.classList.toggle('fallback', !configured);
    badge.innerHTML = `<span class="ai-status-dot"></span>${configured ? 'AI connected' : 'AI not connected'}`;
    if (provider) {
      provider.textContent = configured
        ? 'OpenAI reasoning + live AirGesture aggregate evidence'
        : 'Analytical fallback only · connect AI on the server for natural-language reasoning';
    }

    const send = $('aiSendBtn');
    if (send && !send.disabled) {
      send.innerHTML = configured
        ? 'Ask AI <span>↗</span>'
        : 'Analyze with Rules <span>↗</span>';
    }
  }

  function contentDecision(topFile) {
    const type = String(topFile?.name || '').toUpperCase();
    if (['PDF', 'DOCUMENT'].includes(type)) {
      return {
        title: 'Document productivity use case',
        evidence: `${prettyFileType(type)} is a leading content category in the current scope.`,
        action: 'Test PDF, document-management or productivity messaging before expanding to unrelated products.',
        question: 'Does the current PDF and document activity support a document-productivity commercial test? Which market should we use?'
      };
    }
    if (['IMAGE', 'VIDEO'].includes(type)) {
      return {
        title: 'Media / storage use case',
        evidence: `${prettyFileType(type)} is a leading content category in the current scope.`,
        action: 'Test cloud storage, backup or creative-tool messaging with a small audience first.',
        question: 'Does the current image and video activity support a cloud storage, backup or creative-software test? Which market is best?'
      };
    }
    return {
      title: 'Cross-device utility use case',
      evidence: 'The content mix is broad rather than dominated by one specialized file type.',
      action: 'Start with a broad storage or productivity experiment and measure actual response.',
      question: 'What commercial product category best fits the current AirGesture content mix and why?'
    };
  }

  function renderDecisionSnapshot(snapshot) {
    const container = $('decisionSnapshot');
    if (!container) return;
    const market = snapshot.dimensions?.locations?.find((i) => prettyLocation(i.name) !== 'Unspecified');
    const audience = snapshot.dimensions?.segments?.find((i) => prettySegment(i.name) !== 'Unclassified');
    const content = contentDecision(snapshot.dimensions?.fileTypes?.[0]);

    const cards = [
      market ? {
        label: 'MARKET TO TEST', title: prettyLocation(market.name),
        evidence: `${formatNumber(market.count)} events across ${formatNumber(market.users)} observed users.`,
        action: `Use ${prettyLocation(market.name)} as a controlled geographic test and compare it with the next market.`,
        question: `Should we test ${market.name} first? What product and audience should we use?`
      } : null,
      audience ? {
        label: 'AUDIENCE TO FOCUS', title: prettySegment(audience.name),
        evidence: `${audience.share}% of current events are associated with this audience segment.`,
        action: `Design one product-specific test for ${prettySegment(audience.name)} and compare it with the next audience.`,
        question: `What products fit the ${audience.name} audience, and which market should we test first?`
      } : null,
      { label: 'USE CASE TO EXPLORE', ...content }
    ].filter(Boolean);

    container.innerHTML = cards.map((card) => `
      <article class="decision-snapshot-card">
        <span>${escapeHtml(card.label)}</span>
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.evidence)}</p>
        <strong>${escapeHtml(card.action)}</strong>
        <button type="button" data-ai-question="${escapeHtml(card.question)}">Ask Strategy →</button>
      </article>
    `).join('');
  }

  function renderCharts(snapshot) {
    renderDoughnut('segmentChart', (snapshot.dimensions?.segments || []).filter((i) => prettySegment(i.name) !== 'Unclassified'), {
      label: (item) => prettySegment(item.name),
      onSelect: (item) => setFilter('segment', item.name)
    });

    renderBar('marketChart', (snapshot.dimensions?.locations || []).filter((i) => prettyLocation(i.name) !== 'Unspecified'), {
      valueField: state.marketMetric,
      datasetLabel: state.marketMetric === 'bytes' ? 'Recorded volume' : state.marketMetric === 'users' ? 'Users' : 'Events',
      formatValue: state.marketMetric === 'bytes' ? 'bytes' : 'number',
      label: (item) => prettyLocation(item.name),
      limit: 10,
      onSelect: (item) => setFilter('location', item.name)
    });

    renderDoughnut('fileTypeChart', snapshot.dimensions?.fileTypes || [], {
      label: (item) => prettyFileType(item.name),
      onSelect: (item) => setFilter('fileType', item.name)
    });

    renderBar('platformChart', snapshot.dimensions?.os || [], {
      valueField: 'count',
      datasetLabel: 'Events',
      label: (item) => prettyOs(item.name),
      limit: 7,
      onSelect: (item) => setFilter('os', item.name)
    });

    renderLine('timeChart', snapshot.engagement?.hours || [], {
      label: (item) => {
        const numeric = Number(item.hour);
        if (!Number.isInteger(numeric)) return item.label;
        const suffix = numeric >= 12 ? 'PM' : 'AM';
        return `${numeric % 12 || 12} ${suffix}`;
      },
      onSelect: (item) => setFilter('hour', item.hour)
    });

    renderDoughnut('usageChart', (snapshot.usage?.bands || []).map((item) => ({ name: item.name.replace(' Usage', ''), count: item.users, users: item.users, share: item.share })), {
      valueField: 'users',
      label: (item) => item.name
    });
  }

  function renderSupportingDetails(snapshot) {
    const browser = $('browserMiniStats');
    if (browser) {
      const merged = new Map();
      for (const item of snapshot.dimensions?.browsers || []) {
        const name = prettyBrowser(item.name);
        if (name === 'Unspecified') continue;
        merged.set(name, (merged.get(name) || 0) + Number(item.count || 0));
      }
      browser.innerHTML = [...merged.entries()].sort((a,b) => b[1] - a[1]).slice(0,4)
        .map(([name,count]) => `<span class="mini-stat">${escapeHtml(name)} · ${formatNumber(count)}</span>`).join('');
    }

    const peak = $('peakTiming');
    if (peak) {
      const day = snapshot.engagement?.peakDay;
      const hour = snapshot.engagement?.peakHour;
      peak.innerHTML = `
        <div><span>Peak day</span><strong>${escapeHtml(day?.name || '—')} · ${formatNumber(day?.count || 0)} events</strong></div>
        <div><span>Peak time</span><strong>${escapeHtml(prettyHourUtc(hour?.hour ?? hour?.label ?? ''))} · ${formatNumber(hour?.count || 0)} events</strong></div>
      `;
    }
  }

  function renderOpportunities(snapshot) {
    const container = $('opportunityList');
    if (!container) return;
    const items = (snapshot.opportunities || []).slice(0, 6);
    container.innerHTML = items.map((item) => `
      <article class="opportunity-row">
        <div class="opportunity-row-head"><h3>${escapeHtml(item.title)}</h3><span class="opportunity-label">${escapeHtml(opportunityLabel(item.score))}</span></div>
        <p>${escapeHtml(item.reason || 'Observed behavior supports a controlled product-message test.')}</p>
        <button type="button" data-ai-question="Should we test ${escapeHtml(item.title)}? Which audience, market and channel should we use first based on current AirGesture data?">Ask Strategy →</button>
      </article>
    `).join('');
  }

  function renderAll(snapshot) {
    state.snapshot = snapshot;
    renderKpis(snapshot);
    renderAiStatus(snapshot);
    renderDecisionSnapshot(snapshot);
    renderCharts(snapshot);
    renderSupportingDetails(snapshot);
    renderOpportunities(snapshot);
    renderActiveFilters();
  }

  async function loadSnapshot({ preserveBaseline = true } = {}) {
    const sequence = ++state.loadSequence;
    if (state.loadController) state.loadController.abort();
    state.loadController = new AbortController();
    document.body.classList.add('intelligence-loading');

    try {
      const snapshot = await fetchJson(`/api/intelligence${currentQuery()}`, { signal: state.loadController.signal });
      if (sequence !== state.loadSequence) return;

      if (!hasActiveFilters() || !state.baseline) {
        state.baseline = snapshot;
        populateFilters(snapshot);
      } else if (!preserveBaseline) {
        state.baseline = snapshot;
        populateFilters(snapshot);
      }

      renderAll(snapshot);
      syncFilterControls();
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error.status !== 401) {
        console.error(error);
        showToast(error.message || 'Could not load intelligence analytics.');
      }
    } finally {
      if (sequence === state.loadSequence) document.body.classList.remove('intelligence-loading');
    }
  }

  function setFilter(key, value) {
    if (!(key in state.filters)) return;
    state.filters[key] = value ?? '';
    syncFilterControls();
    renderActiveFilters();
    loadSnapshot();
  }

  function switchMode(mode) {
    state.currentMode = mode === 'ai' ? 'ai' : 'dashboard';
    const dashboard = $('dashboardView');
    const ai = $('aiView');
    const dashboardButton = $('dashboardModeBtn');
    const aiButton = $('aiModeBtn');

    if (state.currentMode === 'ai') {
      dashboard.hidden = true;
      ai.hidden = false;
      dashboard.classList.remove('active');
      ai.classList.add('active');
      dashboardButton.classList.remove('active');
      aiButton.classList.add('active');
      dashboardButton.setAttribute('aria-selected', 'false');
      aiButton.setAttribute('aria-selected', 'true');
      setTimeout(() => $('aiQuestionInput')?.focus(), 100);
    } else {
      dashboard.hidden = false;
      ai.hidden = true;
      dashboard.classList.add('active');
      ai.classList.remove('active');
      dashboardButton.classList.add('active');
      aiButton.classList.remove('active');
      dashboardButton.setAttribute('aria-selected', 'true');
      aiButton.setAttribute('aria-selected', 'false');
    }
  }

  function topList(items, formatter, limit = 4) {
    return (items || []).slice(0, limit).map((item) => `${formatter(item.name)} — ${formatNumber(item.count)} events`);
  }

  function insightFor(panel) {
    const s = state.snapshot;
    if (!s) return null;
    const topSegment = s.dimensions?.segments?.find((i) => prettySegment(i.name) !== 'Unclassified');
    const topMarket = s.dimensions?.locations?.find((i) => prettyLocation(i.name) !== 'Unspecified');
    const topFile = s.dimensions?.fileTypes?.[0];
    const topOs = s.dimensions?.os?.[0];
    const peakDay = s.engagement?.peakDay;
    const peakHour = s.engagement?.peakHour;
    const heavy = s.usage?.bands?.find((i) => i.key === 'HEAVY_USAGE');
    const active = s.usage?.bands?.find((i) => i.key === 'ACTIVE_USAGE');

    if (panel === 'audience') {
      return {
        title: 'Audience insight',
        stats: [['Leading audience', prettySegment(topSegment?.name)], ['Share of events', `${topSegment?.share || 0}%`]],
        evidence: topList(s.dimensions?.segments, prettySegment),
        meaning: 'Audience concentration can guide platform compatibility and product-message tests. It does not identify purchase intent.',
        action: topSegment ? `Test one product-specific message with ${prettySegment(topSegment.name)} and compare it with the next audience.` : 'Collect more audience activity.',
        question: panelPrompts.audience
      };
    }
    if (panel === 'market') {
      return {
        title: 'Market insight',
        stats: [['Leading market', prettyLocation(topMarket?.name)], ['Observed events', formatNumber(topMarket?.count || 0)]],
        evidence: topList(s.dimensions?.locations?.filter((i) => prettyLocation(i.name) !== 'Unspecified'), prettyLocation),
        meaning: 'Geographic concentration is useful for choosing a controlled test market before spending broadly.',
        action: topMarket ? `Use ${prettyLocation(topMarket.name)} as the first market test and compare it with the second-ranked market.` : 'Collect more location evidence.',
        question: panelPrompts.market
      };
    }
    if (panel === 'product') {
      const useCase = contentDecision(topFile);
      return {
        title: 'Content & product insight',
        stats: [['Leading content', prettyFileType(topFile?.name)], ['Share of events', `${topFile?.share || 0}%`]],
        evidence: topList(s.dimensions?.fileTypes, prettyFileType),
        meaning: useCase.evidence,
        action: useCase.action,
        question: panelPrompts.product
      };
    }
    if (panel === 'platform') {
      return {
        title: 'Platform insight',
        stats: [['Leading OS', prettyOs(topOs?.name)], ['Observed events', formatNumber(topOs?.count || 0)]],
        evidence: topList(s.dimensions?.os, prettyOs),
        meaning: 'Platform mix can guide product experience and ecosystem-specific campaign tests.',
        action: 'Prioritize the platform only after matching it to a product objective, then compare with the next ecosystem.',
        question: panelPrompts.platform
      };
    }
    if (panel === 'timing') {
      return {
        title: 'Engagement timing insight',
        stats: [['Peak day', peakDay?.name || '—'], ['Peak time', prettyHourUtc(peakHour?.hour ?? peakHour?.label ?? '')]],
        evidence: [`${formatNumber(peakDay?.count || 0)} events on the strongest day.`, `${formatNumber(peakHour?.count || 0)} events in the strongest hourly bucket.`],
        meaning: 'Timing can guide support coverage and controlled message tests. The timestamps are aggregated in UTC.',
        action: `Test one message near ${prettyHourUtc(peakHour?.hour ?? peakHour?.label ?? '')} and compare it with an off-peak window.`,
        question: panelPrompts.timing
      };
    }
    return {
      title: 'Usage intensity insight',
      stats: [['Active usage', `${active?.share || 0}%`], ['Heavy usage', `${heavy?.share || 0}%`]],
      evidence: [`${formatNumber(active?.users || 0)} users are in the active-usage band.`, `${formatNumber(heavy?.users || 0)} users are in the heavy-usage band.`],
      meaning: 'Higher usage can justify testing advanced features or larger limits. It does not prove willingness to pay.',
      action: 'Test one feature-tier concept with active/heavy users and measure actual opt-in or conversion later.',
      question: panelPrompts.usage
    };
  }

  function openInsight(panel) {
    const insight = insightFor(panel);
    const drawer = $('intelligenceDrawer');
    if (!insight || !drawer) return;
    $('drawerTitle').textContent = insight.title;
    $('drawerContent').innerHTML = `
      <div class="drawer-stat-grid">${insight.stats.map(([label,value]) => `<div class="drawer-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</div>
      <div class="drawer-section"><h3>Evidence</h3><ul class="drawer-list">${insight.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
      <div class="drawer-section"><h3>What it means</h3><p>${escapeHtml(insight.meaning)}</p></div>
      <div class="drawer-section"><h3>Recommended next test</h3><p>${escapeHtml(insight.action)}</p></div>
      <button class="drawer-action" type="button" data-drawer-ai="${escapeHtml(insight.question)}">Ask Strategy about this →</button>
    `;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const drawer = $('intelligenceDrawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function addConversationMessage(role, text, label = '') {
    const container = $('aiConversation');
    if (!container) return;
    const wrapper = document.createElement('div');
    wrapper.className = `ai-message ${role}`;
    if (role === 'user') {
      const bubble = document.createElement('div');
      bubble.textContent = text;
      wrapper.append(bubble);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'ai-avatar';
      avatar.textContent = '✦';
      const bubble = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = label || 'Strategy Copilot';
      const p = document.createElement('p');
      p.textContent = text;
      bubble.append(strong, p);
      wrapper.append(avatar, bubble);
    }
    container.append(wrapper);
    container.scrollTop = container.scrollHeight;
  }

  function clearConversation() {
    state.aiHistory = [];
    const container = $('aiConversation');
    if (!container) return;
    container.innerHTML = '<div class="ai-message assistant intro-message"><div class="ai-avatar">✦</div><div><strong>Strategy Copilot</strong><p>Ask a commercial question. I will separate observed evidence from the business hypothesis.</p></div></div>';
    const panel = $('aiAnswerPanel');
    if (panel) panel.innerHTML = '<div class="ai-answer-empty"><span>✦</span><strong>Your strategy answer will appear here</strong><p>Direct answer · evidence · recommendation · experiment · limitation</p></div>';
    if (state.aiChart) { state.aiChart.destroy(); state.aiChart = null; }
  }

  function renderAiChart(strategy) {
    if (state.aiChart) { state.aiChart.destroy(); state.aiChart = null; }
    const canvas = $('strategySupportingChart');
    const chart = strategy?.chart;
    if (!canvas || !window.Chart || !chart?.data?.length) return;
    const isLine = chart.type === 'line';
    const isQualitative = /score|fit|potential/i.test(String(chart.label || ''));
    const colors = chartColors();
    state.aiChart = new Chart(canvas, {
      type: isLine ? 'line' : 'bar',
      data: {
        labels: chart.data.map((item) => prettyLocation(item.label, true)),
        datasets: [{
          data: chart.data.map((item) => Number(item.value || 0)),
          backgroundColor: isLine ? 'rgba(57,216,255,.08)' : chart.data.map((_,i) => `${palette[i % palette.length]}b8`),
          borderColor: isLine ? '#39d8ff' : chart.data.map((_,i) => palette[i % palette.length]),
          borderWidth: 1,
          borderRadius: 6,
          tension: .3,
          fill: Boolean(isLine)
        }]
      },
      options: {
        ...baseChartOptions(),
        indexAxis: isLine ? 'x' : 'y',
        scales: {
          x: {
            beginAtZero: !isLine,
            suggestedMax: isQualitative && !isLine ? 100 : undefined,
            grid: { color: isQualitative && !isLine ? 'transparent' : colors.grid },
            ticks: { display: !(isQualitative && !isLine), color: colors.text }
          },
          y: { beginAtZero: true, grid: { color: isLine ? colors.grid : 'transparent' }, ticks: { color: colors.text } }
        },
        plugins: {
          ...baseChartOptions().plugins,
          legend: { display: false },
          tooltip: {
            ...baseChartOptions().plugins.tooltip,
            callbacks: isQualitative ? {
              label: (ctx) => ` ${opportunityLabel(Number(ctx.raw || 0))} commercial potential`
            } : undefined
          }
        }
      }
    });
  }

  function renderAiAnswer(data) {
    const panel = $('aiAnswerPanel');
    const strategy = data?.strategy;
    const ai = data?.ai || {};
    if (!panel || !strategy) return;

    const evidence = (strategy.evidence || []).slice(0, 5);
    const followUps = (strategy.followUps || []).slice(0, 4);
    const sourceLabel = ai.used
      ? `AI answer · ${escapeHtml(ai.model || 'OpenAI')} · grounded in AirGesture data`
      : 'Analytical fallback · generative AI is not connected';

    panel.innerHTML = `
      <div class="ai-result">
        <div class="ai-answer-source ${ai.used ? 'live' : 'fallback'}">${sourceLabel}</div>
        ${!ai.used ? '<div class="ai-source-warning"><strong>This is not a generative AI answer.</strong><span>The server is using the rule-based analytical fallback, so open-ended or conversational questions may be limited.</span></div>' : ''}
        <div class="ai-result-heading"><span>${escapeHtml(String(strategy.scenario || 'STRATEGY').replace(/-/g, ' ').toUpperCase())}</span><h3>${escapeHtml(strategy.title || 'Strategic analysis')}</h3><p>${escapeHtml(strategy.directAnswer || '')}</p></div>
        <div class="ai-section-card"><span>Evidence from AirGesture</span><ul class="ai-evidence-list">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
        ${strategy.chart?.data?.length ? '<div class="ai-chart-container"><canvas id="strategySupportingChart"></canvas></div>' : ''}
        ${strategy.interpretation ? `<div class="ai-section-card"><span>What the evidence means</span><p>${escapeHtml(strategy.interpretation)}</p></div>` : ''}
        <div class="ai-section-card decision"><span>Recommended decision</span><p>${escapeHtml(strategy.recommendation || '')}</p></div>
        <div class="ai-section-card"><span>Controlled test</span><p>${escapeHtml(strategy.experiment || '')}</p></div>
        ${strategy.channel ? `<div class="ai-section-card"><span>Channel consideration</span><p>${escapeHtml(strategy.channel)}</p></div>` : ''}
        <div class="ai-section-card risk"><span>Limitation</span><p>${escapeHtml(strategy.risk || 'Observed usage does not prove purchase intent.')}</p></div>
        <div class="follow-up-row">${followUps.map((question) => `<button type="button" data-follow-up="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('')}</div>
      </div>
    `;
    requestAnimationFrame(() => renderAiChart(strategy));
  }

  async function askStrategy(rawQuestion) {
    const question = String(rawQuestion || '').trim().slice(0, 500);
    if (!question) return;

    switchMode('ai');
    if ($('aiQuestionInput')) $('aiQuestionInput').value = question;

    const priorHistory = state.aiHistory.slice(-8);
    addConversationMessage('user', question);

    if (state.aiController) state.aiController.abort();
    state.aiController = new AbortController();
    const send = $('aiSendBtn');
    if (send) { send.disabled = true; send.textContent = 'Analyzing current data…'; }

    try {
      const data = await fetchJson('/api/intelligence/ask', {
        method: 'POST',
        signal: state.aiController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          filters: state.filters,
          history: priorHistory
        })
      });

      renderAiAnswer(data);

      const answer = data.strategy?.directAnswer || 'Analysis complete.';
      addConversationMessage(
        'assistant',
        answer,
        data.ai?.used ? 'AI Strategy Copilot' : 'Analytical Fallback'
      );

      state.aiHistory.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      );
      state.aiHistory = state.aiHistory.slice(-8);

      if ($('aiQuestionInput')) $('aiQuestionInput').value = '';

      if (!data.ai?.used) {
        showToast(
          data.ai?.configured
            ? 'Generative AI was unavailable; the analytical fallback answered this question.'
            : 'AI is not connected; this answer came from the analytical fallback.'
        );
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      addConversationMessage('assistant', error.message || 'The strategy request failed.', 'Strategy Assistant');
      showToast(error.message || 'Could not complete strategy analysis.');
    } finally {
      if (send) {
        send.disabled = false;
        send.innerHTML = state.snapshot?.ai?.configured
          ? 'Ask AI <span>↗</span>'
          : 'Analyze with Rules <span>↗</span>';
      }
    }
  }

  function bindEvents() {
    const filterMap = { rangeFilter: 'range', segmentFilter: 'segment', locationFilter: 'location', fileTypeFilter: 'fileType' };
    for (const [id, key] of Object.entries(filterMap)) {
      $(id)?.addEventListener('change', (event) => {
        state.filters[key] = event.target.value;
        renderActiveFilters();
        loadSnapshot();
      });
    }

    $('resetFiltersBtn')?.addEventListener('click', () => {
      state.filters = { range: 'all', segment: '', location: '', fileType: '', device: '', os: '', browser: '', day: '', hour: '' };
      syncFilterControls();
      renderActiveFilters();
      loadSnapshot();
      showToast('Filters reset.');
    });

    $('activeFilters')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-filter]');
      if (!button) return;
      const key = button.dataset.removeFilter;
      if (!(key in state.filters)) return;
      state.filters[key] = key === 'range' ? 'all' : '';
      syncFilterControls();
      renderActiveFilters();
      loadSnapshot();
    });

    $('marketMetricToggle')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-metric]');
      if (!button) return;
      state.marketMetric = button.dataset.metric || 'count';
      $('marketMetricToggle').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      if (state.snapshot) renderCharts(state.snapshot);
    });

    document.addEventListener('click', (event) => {
      const insightButton = event.target.closest('[data-insight]');
      if (insightButton) { openInsight(insightButton.dataset.insight); return; }

      const panelAi = event.target.closest('[data-panel-ai]');
      if (panelAi) { askStrategy(panelPrompts[panelAi.dataset.panelAi] || 'What should management do next?'); return; }

      const aiQuestion = event.target.closest('[data-ai-question]');
      if (aiQuestion) { askStrategy(aiQuestion.dataset.aiQuestion); return; }

      const close = event.target.closest('[data-close-drawer]');
      if (close) { closeDrawer(); return; }

      const drawerAi = event.target.closest('[data-drawer-ai]');
      if (drawerAi) { const q = drawerAi.dataset.drawerAi; closeDrawer(); askStrategy(q); return; }

      const follow = event.target.closest('[data-follow-up]');
      if (follow) { askStrategy(follow.dataset.followUp); }
    });

    $('suggestedPrompts')?.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button) askStrategy(button.textContent.trim());
    });

    $('aiQuestionForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      askStrategy($('aiQuestionInput')?.value || '');
    });

    $('aiQuestionInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('aiQuestionForm')?.requestSubmit();
      }
    });

    $('clearAiConversationBtn')?.addEventListener('click', clearConversation);
    $('dashboardModeBtn')?.addEventListener('click', () => switchMode('dashboard'));
    $('aiModeBtn')?.addEventListener('click', () => switchMode('ai'));
    $('refreshIntelligenceBtn')?.addEventListener('click', () => loadSnapshot());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });
  }

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.currentMode !== 'dashboard') return;
      loadSnapshot();
    }, 60000);
  }

  async function initialize() {
    if (!state.initialized) {
      state.initialized = true;
      bindEvents();
      renderActiveFilters();
      switchMode('dashboard');
      startAutoRefresh();
    }
    await loadSnapshot();
  }

  window.addEventListener('airgesture-auth-user', initialize);
  document.addEventListener('DOMContentLoaded', () => {
    if (window.AirGestureAuthUser) initialize();
    else setTimeout(() => { if (!state.initialized) initialize(); }, 700);
  });
})();
