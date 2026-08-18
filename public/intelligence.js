(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

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
    loading: false,
    initialized: false,
    refreshTimer: null,
    toastTimer: null,
    selectedContext: null
  };

  const palette = [
    '#38d9ff',
    '#5b8cff',
    '#8b6dff',
    '#33df9a',
    '#ffcf5a',
    '#ff7d8a',
    '#5de0c7',
    '#f58bff',
    '#88a8ff',
    '#a6ef78'
  ];

  const panelPrompts = {
    audience: 'Which commercial segment should we target first, what products fit that audience, and which market should we test?',
    market: 'Which market should management target first and what product should we test there?',
    product: 'Based on current file-type behavior, what products should we promote and why?',
    platform: 'Should we focus on Apple, Windows or mobile users, and what commercial products fit each audience?',
    timing: 'When should we run promotions or customer support based on current usage timing?',
    premium: 'Which usage audience looks suitable for a premium product experiment and what should we test?'
  };

  const panelTitles = {
    audience: 'Audience Intelligence',
    market: 'Market Intelligence',
    product: 'Product & Content Intelligence',
    platform: 'Platform Intelligence',
    timing: 'Engagement Timing',
    premium: 'Premium Opportunity'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value, maximumFractionDigits = 0) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits
    }).format(n);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const scaled = bytes / (1024 ** index);

    return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function shortLabel(value, max = 26) {
    const text = String(value || 'Unknown');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function showToast(message) {
    const toast = $('intelligenceToast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function currentQuery() {
    const params = new URLSearchParams();

    Object.entries(state.filters).forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined) return;
      if (key === 'range' && value === 'all') return;
      params.set(key, String(value));
    });

    const query = params.toString();
    return query ? `?${query}` : '';
  }

  function hasActiveFilters() {
    return Object.entries(state.filters).some(([key, value]) => {
      if (key === 'range') return value !== 'all';
      return value !== '' && value !== null && value !== undefined;
    });
  }

  function destroyChart(id) {
    const chart = state.charts.get(id);
    if (chart) {
      chart.destroy();
      state.charts.delete(id);
    }
  }

  function cssChartDefaults() {
    return {
      text: '#b8c8da',
      grid: 'rgba(148, 163, 184, 0.08)',
      tooltipBg: '#07111f',
      tooltipBorder: 'rgba(96, 165, 250, 0.22)'
    };
  }

  function basePlugins(title = '') {
    const colors = cssChartDefaults();

    return {
      legend: {
        labels: {
          color: colors.text,
          usePointStyle: true,
          boxWidth: 9,
          padding: 16,
          font: {
            family: 'Inter',
            size: 11,
            weight: '600'
          }
        }
      },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        titleColor: '#ffffff',
        bodyColor: '#c9d8e8',
        padding: 11,
        displayColors: true,
        titleFont: {
          family: 'Inter',
          weight: '700'
        },
        bodyFont: {
          family: 'Inter'
        },
        callbacks: title ? {
          footer: () => title
        } : undefined
      }
    };
  }

  function pointerHover(event, elements) {
    const target = event?.native?.target || event?.chart?.canvas;
    if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
  }

  function renderDoughnutChart(id, items, options = {}) {
    destroyChart(id);

    const canvas = $(id);
    if (!canvas || !window.Chart) return;

    const safeItems = (items || []).filter((item) => Number(item?.count || item?.users || 0) >= 0);
    const valueField = options.valueField || 'count';

    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: safeItems.map((item) => shortLabel(item.name, 22)),
        datasets: [{
          data: safeItems.map((item) => Number(item[valueField] || 0)),
          backgroundColor: palette.slice(0, Math.max(safeItems.length, 1)),
          borderColor: '#081321',
          borderWidth: 3,
          hoverOffset: 9,
          spacing: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        interaction: {
          mode: 'nearest',
          intersect: true
        },
        plugins: {
          ...basePlugins('Click to cross-filter'),
          legend: {
            ...basePlugins().legend,
            position: 'bottom'
          },
          tooltip: {
            ...basePlugins('Click to cross-filter').tooltip,
            callbacks: {
              label: (context) => {
                const item = safeItems[context.dataIndex];
                const metric = valueField === 'users'
                  ? `${formatNumber(item.users)} users`
                  : `${formatNumber(item.count)} events`;
                return ` ${metric} · ${item.share ?? 0}%`;
              },
              afterLabel: (context) => {
                const item = safeItems[context.dataIndex];
                return `Data volume: ${formatBytes(item.bytes)}`;
              },
              footer: () => 'Click to cross-filter'
            }
          }
        },
        onHover: pointerHover,
        onClick: (_event, elements) => {
          if (!elements.length || typeof options.onSelect !== 'function') return;
          const item = safeItems[elements[0].index];
          options.onSelect(item);
        }
      }
    });

    state.charts.set(id, chart);
  }

  function renderBarChart(id, items, options = {}) {
    destroyChart(id);

    const canvas = $(id);
    if (!canvas || !window.Chart) return;

    const valueField = options.valueField || 'count';
    const horizontal = options.horizontal !== false;
    const sorted = [...(items || [])].sort((a, b) =>
      Number(b[valueField] || 0) - Number(a[valueField] || 0)
    );
    const safeItems = options.limit ? sorted.slice(0, options.limit) : sorted;
    const colors = cssChartDefaults();

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: safeItems.map((item) => shortLabel(item.name ?? item.label, options.labelLength || 28)),
        datasets: [{
          label: options.datasetLabel || 'Events',
          data: safeItems.map((item) => Number(item[valueField] ?? item.value ?? 0)),
          backgroundColor: safeItems.map((_, index) => `${palette[index % palette.length]}bb`),
          borderColor: safeItems.map((_, index) => palette[index % palette.length]),
          borderWidth: 1,
          borderRadius: 7,
          borderSkipped: false,
          maxBarThickness: 28
        }]
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: true
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: colors.grid,
              drawBorder: false
            },
            ticks: {
              color: colors.text,
              callback: (value) => options.formatValue === 'bytes'
                ? formatBytes(value)
                : formatNumber(value)
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: horizontal ? 'transparent' : colors.grid,
              drawBorder: false
            },
            ticks: {
              color: colors.text,
              autoSkip: false,
              font: {
                family: 'Inter',
                size: 10
              }
            }
          }
        },
        plugins: {
          ...basePlugins(options.footer || 'Click to explore'),
          legend: {
            display: false
          },
          tooltip: {
            ...basePlugins(options.footer || 'Click to explore').tooltip,
            callbacks: {
              label: (context) => {
                const raw = Number(context.raw || 0);
                return options.formatValue === 'bytes'
                  ? ` ${formatBytes(raw)}`
                  : ` ${formatNumber(raw)} ${options.valueSuffix || ''}`.trimEnd();
              },
              afterLabel: (context) => {
                const item = safeItems[context.dataIndex];
                if (item?.users !== undefined && valueField !== 'users') {
                  return `${formatNumber(item.users)} users`;
                }
                return '';
              },
              footer: () => options.footer || 'Click to explore'
            }
          }
        },
        onHover: pointerHover,
        onClick: (_event, elements) => {
          if (!elements.length || typeof options.onSelect !== 'function') return;
          const item = safeItems[elements[0].index];
          options.onSelect(item);
        }
      }
    });

    state.charts.set(id, chart);
  }

  function renderLineChart(id, items, options = {}) {
    destroyChart(id);

    const canvas = $(id);
    if (!canvas || !window.Chart) return;

    const safeItems = items || [];
    const colors = cssChartDefaults();

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: safeItems.map((item) => item.label),
        datasets: [{
          label: options.datasetLabel || 'Events',
          data: safeItems.map((item) => Number(item.value ?? item.count ?? 0)),
          borderColor: '#38d9ff',
          backgroundColor: 'rgba(56, 217, 255, 0.10)',
          pointBackgroundColor: '#07111f',
          pointBorderColor: '#38d9ff',
          pointRadius: 2.5,
          pointHoverRadius: 6,
          borderWidth: 2,
          tension: 0.34,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: true
        },
        scales: {
          x: {
            grid: {
              color: 'transparent'
            },
            ticks: {
              color: colors.text,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
              font: {
                family: 'Inter',
                size: 9
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: colors.grid
            },
            ticks: {
              color: colors.text,
              callback: (value) => formatNumber(value)
            }
          }
        },
        plugins: {
          ...basePlugins(options.footer || 'Click an hour to filter'),
          legend: {
            display: false
          }
        },
        onHover: pointerHover,
        onClick: (_event, elements) => {
          if (!elements.length || typeof options.onSelect !== 'function') return;
          options.onSelect(safeItems[elements[0].index]);
        }
      }
    });

    state.charts.set(id, chart);
  }

  function populateSelect(id, items, labelGetter = (item) => item.name) {
    const select = $(id);
    if (!select) return;

    const first = select.options[0]?.outerHTML || '<option value="">All</option>';
    const previous = select.value;

    select.innerHTML = first;

    for (const item of items || []) {
      const value = item.name ?? item.value ?? '';
      if (!value) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labelGetter(item);
      select.append(option);
    }

    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  function populateFilterOptions(snapshot) {
    if (!snapshot) return;

    populateSelect('segmentFilter', snapshot.dimensions?.segments || []);
    populateSelect(
      'locationFilter',
      snapshot.dimensions?.locations || [],
      (item) => `${item.name} (${formatNumber(item.count)})`
    );
    populateSelect('fileTypeFilter', snapshot.dimensions?.fileTypes || []);
    populateSelect('deviceFilter', snapshot.dimensions?.devices || []);
  }

  function syncFilterControls() {
    const mapping = {
      rangeFilter: 'range',
      segmentFilter: 'segment',
      locationFilter: 'location',
      fileTypeFilter: 'fileType',
      deviceFilter: 'device'
    };

    Object.entries(mapping).forEach(([id, key]) => {
      const element = $(id);
      if (element) element.value = String(state.filters[key] ?? '');
    });
  }

  function renderActiveFilters() {
    const container = $('activeFilters');
    if (!container) return;

    const labels = {
      range: 'Period',
      segment: 'Segment',
      location: 'Market',
      fileType: 'File',
      device: 'Device',
      os: 'OS',
      browser: 'Browser',
      day: 'Day',
      hour: 'Hour'
    };

    const active = Object.entries(state.filters).filter(([key, value]) => {
      if (key === 'range') return value !== 'all';
      return value !== '' && value !== null && value !== undefined;
    });

    if (!active.length) {
      container.innerHTML = '<span class="filter-chip">All data · click any chart to cross-filter</span>';
      return;
    }

    container.innerHTML = active.map(([key, value]) => {
      const displayValue = key === 'hour'
        ? `${String(value).padStart(2, '0')}:00 UTC`
        : value;

      return `
        <span class="filter-chip">
          ${escapeHtml(labels[key] || key)}: ${escapeHtml(displayValue)}
          <button type="button" data-remove-filter="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(key)} filter">×</button>
        </span>
      `;
    }).join('');
  }

  function renderKpis(snapshot) {
    const kpis = snapshot.kpis || {};

    $('heroRecordCount').textContent = formatNumber(snapshot.scope?.matchingRecords || 0);
    $('kpiEvents').textContent = formatNumber(kpis.events);
    $('kpiUsers').textContent = formatNumber(kpis.users);
    $('kpiMarkets').textContent = formatNumber(kpis.locations);
    $('kpiBytes').textContent = formatBytes(kpis.totalBytes);
    $('kpiSegment').textContent = kpis.topSegment || '—';
    $('kpiSegmentShare').textContent = kpis.topSegment
      ? `${kpis.topSegmentShare}% of observed activity`
      : 'No segment available';
    $('kpiFileType').textContent = kpis.topFileType || '—';
    $('kpiFileTypeShare').textContent = kpis.topFileType
      ? `${kpis.topFileTypeShare}% of observed activity`
      : 'No content available';

    const firstAction = snapshot.strategicActions?.[0];
    $('heroTopAction').textContent = firstAction?.title || 'Collect more evidence';

    const generated = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();
    $('lastUpdated').textContent = `Updated ${generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  function renderAiStatus(snapshot) {
    const badge = $('aiStatusBadge');
    const label = $('aiProviderLabel');
    const ai = snapshot?.ai || {};

    if (!badge || !label) return;

    badge.classList.remove('live', 'fallback');

    if (ai.configured) {
      badge.classList.add('live');
      badge.innerHTML = '<span class="ai-status-dot"></span>AI Strategy Live';
      label.textContent = `AI provider: ${ai.provider || 'OpenAI'} · ${ai.model || 'configured model'}`;
    } else {
      badge.classList.add('fallback');
      badge.innerHTML = '<span class="ai-status-dot"></span>Grounded Strategy Engine';
      label.textContent = 'Grounded analytics mode · add OPENAI_API_KEY for generative AI narrative';
    }
  }

  function renderStrategicActions(snapshot) {
    const container = $('strategicActions');
    if (!container) return;

    const actions = (snapshot.strategicActions || []).slice(0, 3);

    if (!actions.length) {
      container.innerHTML = '<div class="intelligence-empty">No strategic actions are available for the current filter.</div>';
      return;
    }

    container.innerHTML = actions.map((action) => `
      <article class="strategic-action-card">
        <div class="action-priority">
          <span>PRIORITY ${escapeHtml(action.priority)}</span>
          <i>${escapeHtml(action.icon || '◈')}</i>
        </div>
        <h3>${escapeHtml(action.title)}</h3>
        <p>${escapeHtml(action.evidence)}</p>
        <strong>${escapeHtml(action.decision)}</strong>
        <div class="action-card-actions">
          <button type="button" data-action-id="${escapeHtml(action.id)}">${escapeHtml(action.actionLabel || 'Explore')}</button>
          <button type="button" data-ai-question="${escapeHtml(action.ask)}">✦ Ask AI</button>
        </div>
      </article>
    `).join('');
  }

  function renderTrends(snapshot) {
    const container = $('trendCards');
    if (!container) return;

    const trends = snapshot.trends;

    if (!trends?.available) {
      container.innerHTML = '<div class="intelligence-empty">Two complete 30-day periods are not available in the current scope.</div>';
      return;
    }

    container.innerHTML = (trends.cards || []).map((card) => {
      const direction = card.change > 0 ? 'up' : card.change < 0 ? 'down' : 'flat';
      const arrow = card.change > 0 ? '↑' : card.change < 0 ? '↓' : '→';
      let value = formatNumber(card.value, 1);
      if (card.unit === 'bytes') value = formatBytes(card.value);
      if (card.unit === '%') value = `${formatNumber(card.value, 1)}%`;
      const deltaUnit = card.changeUnit || '%';

      return `
        <div class="trend-card">
          <div>
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
          <div class="trend-delta ${direction}">
            ${arrow} ${formatNumber(Math.abs(card.change), 1)}${escapeHtml(deltaUnit)}
          </div>
        </div>
      `;
    }).join('');
  }

  function setFilter(key, value, options = {}) {
    if (!(key in state.filters)) return;

    state.filters[key] = value ?? '';
    syncFilterControls();
    renderActiveFilters();

    const selection = options.selection || null;
    if (selection) state.selectedContext = selection;

    loadSnapshot({
      openPanel: options.openPanel,
      panel: options.panel,
      mode: options.mode || 'explore',
      selection
    });
  }

  function renderCharts(snapshot) {
    renderDoughnutChart('segmentChart', snapshot.dimensions?.segments || [], {
      onSelect: (item) => setFilter('segment', item.name, {
        panel: 'audience',
        openPanel: true,
        selection: { type: 'segment', value: item.name }
      })
    });

    const marketItems = [...(snapshot.dimensions?.locations || [])];
    const metric = state.marketMetric;

    renderBarChart('marketChart', marketItems, {
      valueField: metric,
      datasetLabel: metric === 'bytes' ? 'Data Volume' : metric === 'users' ? 'Users' : 'Transfers',
      formatValue: metric === 'bytes' ? 'bytes' : 'number',
      horizontal: true,
      limit: 10,
      footer: 'Click to cross-filter this market',
      onSelect: (item) => setFilter('location', item.name, {
        panel: 'market',
        openPanel: true,
        selection: { type: 'location', value: item.name }
      })
    });

    renderDoughnutChart('fileTypeChart', snapshot.dimensions?.fileTypes || [], {
      onSelect: (item) => setFilter('fileType', item.name, {
        panel: 'product',
        openPanel: true,
        selection: { type: 'fileType', value: item.name }
      })
    });

    renderBarChart('platformChart', snapshot.dimensions?.os || [], {
      valueField: 'count',
      datasetLabel: 'Events',
      horizontal: true,
      limit: 8,
      footer: 'Click to filter by operating system',
      onSelect: (item) => setFilter('os', item.name, {
        panel: 'platform',
        openPanel: true,
        selection: { type: 'os', value: item.name }
      })
    });

    renderLineChart('timeChart', (snapshot.engagement?.hours || []).map((item) => ({
      ...item,
      value: item.count
    })), {
      datasetLabel: 'Events',
      footer: 'Click an hour to cross-filter',
      onSelect: (item) => setFilter('hour', item.hour, {
        panel: 'timing',
        openPanel: true,
        selection: { type: 'hour', value: item.label }
      })
    });

    renderDoughnutChart('usageChart', (snapshot.usage?.bands || []).map((item) => ({
      name: item.name,
      count: item.users,
      users: item.users,
      share: item.share,
      bytes: 0
    })), {
      onSelect: (item) => openPanel('premium', 'explore', {
        type: 'usageBand',
        value: item.name
      })
    });

    renderBarChart('opportunityChart', (snapshot.opportunities || []).map((item) => ({
      ...item,
      name: item.shortTitle,
      value: item.score
    })), {
      valueField: 'value',
      datasetLabel: 'Opportunity Score',
      horizontal: true,
      footer: 'Click to inspect the score and commercial test',
      valueSuffix: '/100',
      onSelect: (item) => openOpportunityDrawer(item.id)
    });

    renderBarChart('adChannelChart', [
      {
        name: 'Google Search',
        value: snapshot.adChannels?.google?.score || 0
      },
      {
        name: 'Instagram / Meta',
        value: snapshot.adChannels?.meta?.score || 0
      }
    ], {
      valueField: 'value',
      datasetLabel: 'Channel Fit',
      horizontal: false,
      footer: 'Click to ask which channel should be tested first',
      valueSuffix: '/100',
      onSelect: () => askStrategy('Should we use Google Ads or Instagram / Meta based on the current AirGesture data?')
    });
  }

  function renderSupportingDetails(snapshot) {
    const tags = $('productOpportunityTags');
    if (tags) {
      tags.innerHTML = (snapshot.opportunities || [])
        .slice(0, 4)
        .map((item) => `<span class="opportunity-tag">${escapeHtml(item.shortTitle)} · ${item.score}/100</span>`)
        .join('');
    }

    const browser = $('browserMiniStats');
    if (browser) {
      browser.innerHTML = (snapshot.dimensions?.browsers || [])
        .slice(0, 5)
        .map((item) => `<span class="mini-stat">${escapeHtml(item.name)} · ${formatNumber(item.count)}</span>`)
        .join('');
    }

    const peak = $('peakTiming');
    if (peak) {
      const peakDay = snapshot.engagement?.peakDay;
      const peakHour = snapshot.engagement?.peakHour;
      peak.innerHTML = `
        <div>
          <span>Peak day</span>
          <strong>${escapeHtml(peakDay?.name || '—')} · ${formatNumber(peakDay?.count || 0)} events</strong>
        </div>
        <div>
          <span>Peak hour</span>
          <strong>${escapeHtml(peakHour?.label || '—')} UTC · ${formatNumber(peakHour?.count || 0)} events</strong>
        </div>
      `;
    }
  }

  function renderOpportunityList(snapshot) {
    const container = $('opportunityList');
    if (!container) return;

    container.innerHTML = (snapshot.opportunities || []).map((item) => `
      <article class="opportunity-row" data-opportunity-id="${escapeHtml(item.id)}" tabindex="0">
        <span class="opportunity-row-icon">${escapeHtml(item.icon || '◈')}</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.scoreLabel)} · Best market: ${escapeHtml(item.bestMarket || 'N/A')}</small>
        </div>
        <span class="opportunity-score">${formatNumber(item.score)}/100</span>
      </article>
    `).join('');
  }

  function renderAdLab(snapshot) {
    const google = snapshot.adChannels?.google;
    const meta = snapshot.adChannels?.meta;

    if ($('googleAdCard') && google) {
      $('googleAdCard').innerHTML = `
        <div class="ad-logo-line">
          <h3>Google Search Ads</h3>
          <span class="ad-score-pill">${google.score}/100</span>
        </div>
        <p><strong>${escapeHtml(google.scoreLabel)}</strong>. Stronger hypothesis for search-intent products such as security, PDF, backup, storage and productivity software.</p>
        <div class="ad-product-list">
          ${(google.productCategories || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
        <p>Current best-fit product: <strong>${escapeHtml(google.bestProduct || '—')}</strong></p>
        <button type="button" data-ai-question="Which market and product should we use for a Google Ads test?">Ask strategy →</button>
      `;
    }

    if ($('metaAdCard') && meta) {
      $('metaAdCard').innerHTML = `
        <div class="ad-logo-line">
          <h3>Instagram / Meta Ads</h3>
          <span class="ad-score-pill">${meta.score}/100</span>
        </div>
        <p><strong>${escapeHtml(meta.scoreLabel)}</strong>. Stronger hypothesis for visual/mobile products such as photo tools, mobile storage, backup and cross-device apps.</p>
        <div class="ad-product-list">
          ${(meta.productCategories || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
        <p>Current best-fit product: <strong>${escapeHtml(meta.bestProduct || '—')}</strong></p>
        <button type="button" data-ai-question="Which market and product should we use for an Instagram or Meta Ads test?">Ask strategy →</button>
      `;
    }
  }

  function matrixStrength(score) {
    if (score >= 80) return 'strong';
    if (score >= 65) return 'moderate';
    return 'explore';
  }

  function renderMatrix(snapshot) {
    const container = $('opportunityMatrix');
    const matrix = snapshot.matrix;
    if (!container || !matrix) return;

    if (!matrix.segments?.length || !matrix.products?.length) {
      container.innerHTML = '<div class="intelligence-empty">No matrix is available for this scope.</div>';
      return;
    }

    const header = matrix.segments.map((segment) => `
      <th>${escapeHtml(segment.name)}<br><small>${segment.share}% share</small></th>
    `).join('');

    const rows = matrix.products.map((product) => `
      <tr>
        <td class="matrix-product">${escapeHtml(product.title)}<br><small>${product.overallScore}/100 overall</small></td>
        ${product.cells.map((cell) => `
          <td>
            <button
              class="matrix-cell"
              type="button"
              data-strength="${matrixStrength(cell.score)}"
              data-matrix-product="${escapeHtml(product.id)}"
              data-matrix-product-label="${escapeHtml(product.title)}"
              data-matrix-segment="${escapeHtml(cell.segment)}"
              data-matrix-score="${cell.score}"
              style="--matrix-score:${cell.score}"
            >
              <strong>${cell.score}</strong>
              <small>${escapeHtml(cell.label)}</small>
            </button>
          </td>
        `).join('')}
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="opportunity-matrix">
        <thead>
          <tr>
            <th>Product hypothesis</th>
            ${header}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="ad-disclaimer">${escapeHtml(matrix.note || '')}</div>
    `;
  }

  function renderDecisionCenter(snapshot) {
    const container = $('decisionCenter');
    if (!container) return;

    const actions = (snapshot.strategicActions || []).slice(0, 5);

    container.innerHTML = actions.map((action) => `
      <article class="decision-card">
        <div class="decision-card-head">
          <span>${escapeHtml(action.id.toUpperCase())} DECISION</span>
          <i>${escapeHtml(action.icon || '◈')}</i>
        </div>
        <h3>${escapeHtml(action.title)}</h3>
        <p>${escapeHtml(action.evidence)}</p>
        <p class="decision-highlight">${escapeHtml(action.decision)}</p>
        <button type="button" data-ai-question="${escapeHtml(action.ask)}">✦ Validate with AI Strategy</button>
      </article>
    `).join('');
  }

  function renderAll(snapshot) {
    state.snapshot = snapshot;
    renderKpis(snapshot);
    renderAiStatus(snapshot);
    renderStrategicActions(snapshot);
    renderTrends(snapshot);
    renderCharts(snapshot);
    renderSupportingDetails(snapshot);
    renderOpportunityList(snapshot);
    renderAdLab(snapshot);
    renderMatrix(snapshot);
    renderDecisionCenter(snapshot);
    renderActiveFilters();
  }

  async function loadSnapshot(options = {}) {
    if (state.loading) return;
    state.loading = true;
    document.body.classList.add('intelligence-loading');

    try {
      const snapshot = await fetchJson(`/api/intelligence${currentQuery()}`);

      if (!state.baseline && !hasActiveFilters()) {
        state.baseline = snapshot;
        populateFilterOptions(snapshot);
      } else if (!hasActiveFilters()) {
        state.baseline = snapshot;
        populateFilterOptions(snapshot);
      }

      renderAll(snapshot);
      syncFilterControls();

      if (options.openPanel) {
        openPanel(options.panel || 'audience', options.mode || 'explore', options.selection || null);
      }
    } catch (error) {
      if (error.status !== 401) {
        console.error(error);
        showToast(error.message || 'Could not load intelligence analytics.');
      }
    } finally {
      state.loading = false;
      document.body.classList.remove('intelligence-loading');
    }
  }

  function drawerOpen() {
    return $('intelligenceDrawer')?.classList.contains('open');
  }

  function openDrawer(title, kicker, html) {
    const drawer = $('intelligenceDrawer');
    if (!drawer) return;

    $('drawerTitle').textContent = title;
    $('drawerKicker').textContent = kicker || 'INTELLIGENCE EXPLORER';
    $('drawerContent').innerHTML = html;
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

  function currentSummaryHtml(snapshot) {
    return `
      <div class="drawer-summary-grid">
        <div class="drawer-stat"><span>Events</span><strong>${formatNumber(snapshot.scope?.matchingRecords || 0)}</strong></div>
        <div class="drawer-stat"><span>Users</span><strong>${formatNumber(snapshot.kpis?.users || 0)}</strong></div>
        <div class="drawer-stat"><span>Markets</span><strong>${formatNumber(snapshot.kpis?.locations || 0)}</strong></div>
        <div class="drawer-stat"><span>Data volume</span><strong>${formatBytes(snapshot.kpis?.totalBytes || 0)}</strong></div>
      </div>
    `;
  }

  function listTop(items, value = 'count', limit = 5, format = (n) => formatNumber(n)) {
    const list = [...(items || [])]
      .sort((a, b) => Number(b[value] || 0) - Number(a[value] || 0))
      .slice(0, limit);

    if (!list.length) return '<p>No data available in this scope.</p>';

    return `
      <ul>
        ${list.map((item) => `<li>${escapeHtml(item.name)} — ${escapeHtml(format(item[value] || 0))}</li>`).join('')}
      </ul>
    `;
  }

  function panelExplanation(panel, snapshot) {
    const topSegment = snapshot.dimensions?.segments?.[0];
    const topMarket = snapshot.dimensions?.locations?.[0];
    const topFile = snapshot.dimensions?.fileTypes?.[0];
    const topProduct = snapshot.opportunities?.[0];
    const peak = snapshot.engagement?.peakHour;

    if (panel === 'audience') {
      return {
        what: topSegment
          ? `${topSegment.name} is the largest observed commercial segment at ${topSegment.share}% of current activity.`
          : 'No dominant commercial segment is visible.',
        soWhat: 'Technology ecosystem concentration can guide product compatibility, integration and campaign experiments.',
        why: 'Management can test one ecosystem-focused offer before spreading resources across every platform.',
        decision: topSegment
          ? `Design one controlled product or advertising test around ${topSegment.name} and compare it with the next-ranked segment.`
          : 'Collect more audience evidence before selecting a target segment.'
      };
    }

    if (panel === 'market') {
      return {
        what: topMarket
          ? `${topMarket.name} currently leads with ${topMarket.count} events across ${topMarket.users} observed users.`
          : 'No market is currently dominant.',
        soWhat: 'Observed geographic concentration identifies reasonable test markets for a small campaign.',
        why: 'A controlled geographic test reduces risk compared with immediately launching nationally.',
        decision: topMarket
          ? `Use ${topMarket.name} as a first market test and compare it with the second-ranked location.`
          : 'Collect more location evidence.'
      };
    }

    if (panel === 'product') {
      return {
        what: topFile
          ? `${topFile.name} is the largest content category at ${topFile.share}% of current activity.`
          : 'No file-type pattern is visible.',
        soWhat: topProduct
          ? `${topProduct.title} currently ranks highest as a commercial test hypothesis at ${topProduct.score}/100.`
          : 'File behavior can inform product hypotheses.',
        why: 'Content behavior helps prioritize which adjacent software categories are worth testing with the audience.',
        decision: topProduct
          ? `Test ${topProduct.title.toLowerCase()} messaging in ${topProduct.bestMarket || 'the strongest market'} before scaling.`
          : 'Collect more product evidence.'
      };
    }

    if (panel === 'platform') {
      return {
        what: `${snapshot.kpis?.topDevice || 'The leading device'} is the strongest observed device type; ${snapshot.kpis?.topSegment || 'the top segment'} leads commercial-segment activity.`,
        soWhat: 'Platform concentration can guide UX investment and ecosystem-specific product tests.',
        why: 'Engineering and marketing budgets are more effective when tied to observed usage instead of assumptions.',
        decision: 'Choose the next platform investment based on audience size plus the product objective, then compare with a second ecosystem.'
      };
    }

    if (panel === 'timing') {
      return {
        what: peak?.count
          ? `${peak.label} UTC is the strongest hourly activity bucket with ${peak.count} events.`
          : 'No peak timing signal is available.',
        soWhat: 'Usage timing can inform support coverage, notification timing and controlled campaign windows.',
        why: 'Peak and off-peak tests can reveal whether timing changes engagement.',
        decision: peak?.count
          ? `Test a message around ${peak.label} UTC and compare with an off-peak period.`
          : 'Collect more timestamped activity.'
      };
    }

    const heavy = snapshot.usage?.bands?.find((item) => item.key === 'HEAVY_USAGE');
    const active = snapshot.usage?.bands?.find((item) => item.key === 'ACTIVE_USAGE');

    return {
      what: `${formatNumber(heavy?.users || 0)} heavy-usage and ${formatNumber(active?.users || 0)} active-usage users are visible in the current scope.`,
      soWhat: 'High usage can identify a population worth testing for premium or advanced features.',
      why: 'Frequent usage is a behavioral signal that can prioritize research, but it does not prove willingness to pay.',
      decision: 'Test a Pro concept focused on larger transfers, storage, backup or productivity with the aggregate active/heavy audience.'
    };
  }

  function panelDeepAnalysis(panel, snapshot) {
    if (panel === 'audience') {
      return `
        <div class="drawer-section"><h3>Top segments</h3>${listTop(snapshot.dimensions?.segments)}</div>
        <div class="drawer-section"><h3>Top content in this scope</h3>${listTop(snapshot.dimensions?.fileTypes)}</div>
        <div class="drawer-section"><h3>Top markets in this scope</h3>${listTop(snapshot.dimensions?.locations)}</div>
      `;
    }

    if (panel === 'market') {
      return `
        <div class="drawer-section"><h3>Market ranking</h3>${listTop(snapshot.dimensions?.locations)}</div>
        <div class="drawer-section"><h3>Audience mix</h3>${listTop(snapshot.dimensions?.segments)}</div>
        <div class="drawer-section"><h3>File mix</h3>${listTop(snapshot.dimensions?.fileTypes)}</div>
      `;
    }

    if (panel === 'product') {
      return `
        <div class="drawer-section"><h3>File types</h3>${listTop(snapshot.dimensions?.fileTypes)}</div>
        <div class="drawer-section"><h3>Product hypotheses</h3>${listTop((snapshot.opportunities || []).map((item) => ({ name: item.title, count: item.score })), 'count', 6, (value) => `${value}/100`)}</div>
        <div class="drawer-section"><h3>Data volume by file type</h3>${listTop(snapshot.dimensions?.fileTypes, 'bytes', 5, formatBytes)}</div>
      `;
    }

    if (panel === 'platform') {
      return `
        <div class="drawer-section"><h3>Operating systems</h3>${listTop(snapshot.dimensions?.os)}</div>
        <div class="drawer-section"><h3>Devices</h3>${listTop(snapshot.dimensions?.devices)}</div>
        <div class="drawer-section"><h3>Browsers</h3>${listTop(snapshot.dimensions?.browsers)}</div>
      `;
    }

    if (panel === 'timing') {
      const days = (snapshot.engagement?.days || []).map((item) => ({ name: item.name, count: item.count }));
      const hours = (snapshot.engagement?.hours || [])
        .map((item) => ({ name: `${item.label} UTC`, count: item.count }))
        .sort((a, b) => b.count - a.count);

      return `
        <div class="drawer-section"><h3>Strongest days</h3>${listTop(days)}</div>
        <div class="drawer-section"><h3>Strongest hours</h3>${listTop(hours)}</div>
      `;
    }

    return `
      <div class="drawer-section"><h3>Usage bands</h3>${listTop((snapshot.usage?.bands || []).map((item) => ({ name: item.name, users: item.users })), 'users', 5, (value) => `${value} users`)}</div>
      <div class="drawer-section"><h3>Premium interpretation</h3><p>Active and heavy usage identifies a population for a controlled premium-feature experiment, not a confirmed buyer segment.</p></div>
    `;
  }

  function openPanel(panel, mode = 'explore', selection = null) {
    const snapshot = state.snapshot;
    if (!snapshot) return;

    const explanation = panelExplanation(panel, snapshot);
    const title = selection?.value
      ? `${panelTitles[panel] || 'Intelligence'} · ${selection.value}`
      : panelTitles[panel] || 'Intelligence Explorer';

    let body = currentSummaryHtml(snapshot);

    if (mode === 'explore') {
      body += panelDeepAnalysis(panel, snapshot);
    } else if (mode === 'explain') {
      body += `
        <div class="drawer-section"><h3>WHAT?</h3><p>${escapeHtml(explanation.what)}</p></div>
        <div class="drawer-section"><h3>SO WHAT?</h3><p>${escapeHtml(explanation.soWhat)}</p></div>
        <div class="drawer-section"><h3>WHY IT MATTERS</h3><p>${escapeHtml(explanation.why)}</p></div>
      `;
    } else {
      body += `
        <div class="drawer-section"><h3>Observed evidence</h3><p>${escapeHtml(explanation.what)}</p></div>
        <div class="drawer-section"><h3>Commercial interpretation</h3><p>${escapeHtml(explanation.soWhat)}</p></div>
        <div class="drawer-section"><h3>Strategic decision</h3><p>${escapeHtml(explanation.decision)}</p></div>
        <div class="drawer-section"><h3>Decision guardrail</h3><p>Use this as a controlled test hypothesis. The AirGesture database does not contain ad conversions, revenue or individual purchase intent.</p></div>
      `;
    }

    body += `
      <div class="drawer-action-row">
        <button type="button" data-drawer-ai="${escapeHtml(panelPrompts[panel] || 'What should management do next?')}">✦ Ask AI</button>
        <button type="button" data-drawer-compare="${escapeHtml(panel)}">Compare</button>
      </div>
    `;

    openDrawer(title, `${mode.toUpperCase()} · ${selection?.value || 'CURRENT SCOPE'}`, body);
  }

  function openOpportunityDrawer(id) {
    const opportunity = state.snapshot?.opportunities?.find((item) => item.id === id);
    if (!opportunity) return;

    const breakdown = (opportunity.breakdown || []).map((item) => `
      <div class="score-breakdown-row">
        <span>${escapeHtml(item.label)} · signal ${item.signal}/100 · weight ${item.weight}%</span>
        <strong>${item.points} pts</strong>
      </div>
    `).join('');

    const markets = (opportunity.markets || []).map((item) => `
      <li>${escapeHtml(item.name)} — ${formatNumber(item.count)} relevant events</li>
    `).join('');

    const products = (opportunity.productExamples || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');

    const html = `
      <div class="drawer-summary-grid">
        <div class="drawer-stat"><span>Opportunity score</span><strong>${opportunity.score}/100</strong></div>
        <div class="drawer-stat"><span>Best test market</span><strong>${escapeHtml(opportunity.bestMarket || '—')}</strong></div>
        <div class="drawer-stat"><span>Relevant events</span><strong>${formatNumber(opportunity.relevantEvents || 0)}</strong></div>
        <div class="drawer-stat"><span>Channel hypothesis</span><strong>${escapeHtml(opportunity.channelHint || '—')}</strong></div>
      </div>
      <div class="drawer-section"><h3>Why this opportunity?</h3><p>${escapeHtml(opportunity.reason)}</p></div>
      <div class="drawer-section"><h3>Transparent score breakdown</h3><div class="drawer-score-breakdown">${breakdown}</div></div>
      <div class="drawer-section"><h3>Candidate products</h3><ul>${products}</ul></div>
      <div class="drawer-section"><h3>Candidate markets</h3><ul>${markets || '<li>No market available</li>'}</ul></div>
      <div class="drawer-section"><h3>Strategic decision</h3><p>Test one ${escapeHtml(opportunity.shortTitle.toLowerCase())} offer in ${escapeHtml(opportunity.bestMarket || 'the strongest market')} before scaling. Treat the score as prioritization evidence, not predicted revenue.</p></div>
      <div class="drawer-action-row">
        <button type="button" data-drawer-ai="Where should we promote ${escapeHtml(opportunity.title)} and which advertising channel should we test first?">✦ Ask AI</button>
        <button type="button" data-drawer-compare="product">Compare products</button>
      </div>
    `;

    openDrawer(opportunity.title, 'COMMERCIAL OPPORTUNITY', html);
  }

  function comparisonQuestion(type) {
    const base = state.baseline || state.snapshot;

    if (type === 'segment' || type === 'audience') {
      const items = base?.dimensions?.segments || [];
      if (items.length >= 2) return `Compare ${items[0].name} with ${items[1].name}. Which audience should we target for which products?`;
      return 'Compare the strongest commercial audience segments.';
    }

    if (type === 'market') {
      const items = base?.dimensions?.locations || [];
      if (items.length >= 2) return `Compare ${items[0].name} with ${items[1].name}. Which market should management test first and why?`;
      return 'Compare the strongest markets.';
    }

    if (type === 'product') {
      const items = state.snapshot?.opportunities || [];
      if (items.length >= 2) return `Compare ${items[0].title} with ${items[1].title}. Which commercial product hypothesis should we test first?`;
      return 'Compare the strongest product opportunities.';
    }

    return panelPrompts[type] || 'Compare the strongest strategic options in the current data.';
  }

  function addConversationMessage(role, text, label = '') {
    const container = $('aiConversation');
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = `ai-message ${role}`;

    if (role === 'user') {
      const content = document.createElement('div');
      content.textContent = text;
      wrapper.append(content);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'ai-avatar';
      avatar.textContent = '✦';

      const content = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = label || 'AI Strategy Copilot';
      const p = document.createElement('p');
      p.textContent = text;
      content.append(strong, p);
      wrapper.append(avatar, content);
    }

    container.append(wrapper);
    container.scrollTop = container.scrollHeight;
  }

  function renderAiChart(strategy) {
    if (state.aiChart) {
      state.aiChart.destroy();
      state.aiChart = null;
    }

    const canvas = $('strategySupportingChart');
    const chart = strategy?.chart;
    if (!canvas || !chart || !Array.isArray(chart.data) || !chart.data.length || !window.Chart) return;

    const isLine = chart.type === 'line';
    const colors = cssChartDefaults();

    state.aiChart = new Chart(canvas, {
      type: isLine ? 'line' : 'bar',
      data: {
        labels: chart.data.map((item) => shortLabel(item.label, 24)),
        datasets: [{
          label: chart.label || 'Value',
          data: chart.data.map((item) => Number(item.value || 0)),
          backgroundColor: isLine ? 'rgba(56, 217, 255, 0.10)' : chart.data.map((_, index) => `${palette[index % palette.length]}bb`),
          borderColor: isLine ? '#38d9ff' : chart.data.map((_, index) => palette[index % palette.length]),
          borderWidth: isLine ? 2 : 1,
          borderRadius: isLine ? 0 : 6,
          tension: isLine ? 0.3 : 0,
          fill: Boolean(isLine),
          pointRadius: isLine ? 2 : 0,
          pointHoverRadius: isLine ? 5 : 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isLine ? 'x' : 'y',
        scales: {
          x: {
            beginAtZero: !isLine,
            grid: { color: isLine ? 'transparent' : colors.grid },
            ticks: { color: colors.text, maxTicksLimit: 10 }
          },
          y: {
            beginAtZero: true,
            grid: { color: colors.grid },
            ticks: { color: colors.text, maxTicksLimit: 8 }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: basePlugins().tooltip
        }
      }
    });
  }

  function renderAiAnswer(data) {
    const panel = $('aiAnswerPanel');
    const strategy = data?.strategy;
    const ai = data?.ai || {};
    if (!panel || !strategy) return;

    const evidence = (strategy.evidence || []).map((item, index) => `
      <div class="ai-evidence-item">
        <span>Evidence ${index + 1}</span>
        <p>${escapeHtml(item)}</p>
      </div>
    `).join('');

    const path = (strategy.decisionPath || []).map((step) => `
      <div class="decision-path-step">
        <strong>${escapeHtml(step.stage)}</strong>
        <p>${escapeHtml(step.text)}</p>
      </div>
    `).join('');

    const followUps = (strategy.followUps || []).map((question) => `
      <button type="button" data-follow-up="${escapeHtml(question)}">${escapeHtml(question)}</button>
    `).join('');

    const narrative = ai.text ? `
      <div class="ai-narrative">
        <div class="ai-narrative-head">
          <strong>${ai.used ? 'Generative AI interpretation' : 'Grounded strategy summary'}</strong>
          <span>${escapeHtml(ai.model || ai.provider || 'AirGesture')}</span>
        </div>
        <p>${escapeHtml(ai.text)}</p>
      </div>
    ` : '';

    panel.innerHTML = `
      <div class="ai-result">
        <div class="ai-result-heading">
          <span>${escapeHtml(strategy.scenario || 'STRATEGY').toUpperCase()}</span>
          <h3>${escapeHtml(strategy.title || 'Strategic Analysis')}</h3>
          <p>${escapeHtml(strategy.directAnswer || '')}</p>
        </div>

        <div class="ai-evidence-grid">${evidence}</div>

        <div class="ai-chart-container">
          <canvas id="strategySupportingChart"></canvas>
        </div>

        <div class="ai-section-card">
          <span>Interpretation</span>
          <p>${escapeHtml(strategy.interpretation || '')}</p>
        </div>

        <div class="ai-section-card decision">
          <span>Strategic Decision</span>
          <p>${escapeHtml(strategy.recommendation || '')}</p>
        </div>

        <div class="ai-section-card">
          <span>Controlled Experiment</span>
          <p>${escapeHtml(strategy.experiment || '')}</p>
        </div>

        <div class="ai-section-card">
          <span>Advertising / Channel</span>
          <p>${escapeHtml(strategy.channel || '')}</p>
        </div>

        <div class="ai-section-card risk">
          <span>Risk / Limitation</span>
          <p>${escapeHtml(strategy.risk || '')}</p>
        </div>

        <div class="confidence-row">
          <span class="confidence-pill">Evidence: ${escapeHtml(strategy.confidence?.evidenceStrength || '—')}</span>
          <span class="confidence-pill">Commercial inference: ${escapeHtml(strategy.confidence?.commercialInference || '—')}</span>
          <span class="confidence-pill">Recommendation: ${escapeHtml(strategy.confidence?.recommendation || '—')}</span>
        </div>

        ${narrative}

        <div class="decision-path">${path}</div>

        <div class="follow-up-row">${followUps}</div>
      </div>
    `;

    requestAnimationFrame(() => renderAiChart(strategy));
  }

  async function askStrategy(rawQuestion) {
    const question = String(rawQuestion || '').trim().slice(0, 500);
    if (!question) return;

    const section = $('aiStrategySection');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const input = $('aiQuestionInput');
    if (input) input.value = question;

    addConversationMessage('user', question);

    const sendButton = $('aiSendBtn');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.textContent = 'Analyzing database…';
    }

    try {
      const data = await fetchJson('/api/intelligence/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          filters: state.filters
        })
      });

      renderAiAnswer(data);
      addConversationMessage(
        'assistant',
        data.strategy?.directAnswer || 'Analysis complete.',
        data.ai?.used ? 'AI Strategy Copilot · grounded in AirGesture data' : 'AirGesture Grounded Strategy Engine'
      );

      if (data.ai?.error) {
        showToast('Generative AI was unavailable, so the grounded strategy engine answered instead.');
      }
    } catch (error) {
      console.error(error);
      addConversationMessage('assistant', error.message || 'The strategy request failed.', 'Strategy Copilot');
      showToast(error.message || 'Could not complete strategy analysis.');
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
        sendButton.innerHTML = 'Ask Strategy Copilot <span>↗</span>';
      }
    }
  }

  function handlePanelAction(panel, action) {
    if (action === 'ai') {
      askStrategy(panelPrompts[panel] || 'What should management do next?');
      return;
    }

    openPanel(panel, action === 'decide' ? 'decide' : action === 'explain' ? 'explain' : 'explore');
  }

  function bindEvents() {
    const filterMap = {
      rangeFilter: 'range',
      segmentFilter: 'segment',
      locationFilter: 'location',
      fileTypeFilter: 'fileType',
      deviceFilter: 'device'
    };

    Object.entries(filterMap).forEach(([id, key]) => {
      $(id)?.addEventListener('change', (event) => {
        state.filters[key] = event.target.value;
        renderActiveFilters();
        loadSnapshot();
      });
    });

    $('resetFiltersBtn')?.addEventListener('click', () => {
      state.filters = {
        range: 'all',
        segment: '',
        location: '',
        fileType: '',
        device: '',
        os: '',
        browser: '',
        day: '',
        hour: ''
      };
      syncFilterControls();
      renderActiveFilters();
      loadSnapshot();
      showToast('All intelligence filters cleared.');
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

    document.querySelectorAll('.chart-card').forEach((card) => {
      const panel = card.dataset.panel;
      card.querySelectorAll('[data-chart-action]').forEach((button) => {
        button.addEventListener('click', () => handlePanelAction(panel, button.dataset.chartAction));
      });
    });

    document.querySelectorAll('[data-compare]').forEach((button) => {
      button.addEventListener('click', () => askStrategy(comparisonQuestion(button.dataset.compare)));
    });

    document.querySelectorAll('[data-toggle="marketMetric"] button').forEach((button) => {
      button.addEventListener('click', () => {
        state.marketMetric = button.dataset.metric || 'count';
        document.querySelectorAll('[data-toggle="marketMetric"] button').forEach((item) => {
          item.classList.toggle('active', item === button);
        });
        if (state.snapshot) renderCharts(state.snapshot);
      });
    });

    $('strategicActions')?.addEventListener('click', (event) => {
      const aiButton = event.target.closest('[data-ai-question]');
      if (aiButton) {
        askStrategy(aiButton.dataset.aiQuestion);
        return;
      }

      const actionButton = event.target.closest('[data-action-id]');
      if (!actionButton) return;
      const id = actionButton.dataset.actionId;
      const panel = id === 'market'
        ? 'market'
        : id === 'audience'
          ? 'audience'
          : id === 'timing'
            ? 'timing'
            : id === 'product'
              ? 'product'
              : 'audience';
      openPanel(panel, 'decide');
    });

    $('opportunityList')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-opportunity-id]');
      if (row) openOpportunityDrawer(row.dataset.opportunityId);
    });

    $('opportunityList')?.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target.closest('[data-opportunity-id]');
      if (!row) return;
      event.preventDefault();
      openOpportunityDrawer(row.dataset.opportunityId);
    });

    $('opportunityMatrix')?.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-matrix-product]');
      if (!cell) return;

      const product = cell.dataset.matrixProductLabel;
      const segment = cell.dataset.matrixSegment;
      const score = cell.dataset.matrixScore;

      const html = `
        <div class="drawer-summary-grid">
          <div class="drawer-stat"><span>Matrix score</span><strong>${escapeHtml(score)}/100</strong></div>
          <div class="drawer-stat"><span>Audience</span><strong>${escapeHtml(segment)}</strong></div>
        </div>
        <div class="drawer-section"><h3>Product hypothesis</h3><p>${escapeHtml(product)} is being evaluated against the observed ${escapeHtml(segment)} audience using a classroom fit score plus observed audience share.</p></div>
        <div class="drawer-section"><h3>Strategic interpretation</h3><p>A high score means the combination is worth testing first. It does not mean the audience will buy the product.</p></div>
        <div class="drawer-action-row">
          <button type="button" data-drawer-ai="Should we promote ${escapeHtml(product)} to the ${escapeHtml(segment)} audience? Which market and ad channel should we test first?">✦ Ask AI</button>
          <button type="button" data-drawer-compare="segment">Compare audience</button>
        </div>
      `;

      openDrawer(`${product} × ${segment}`, 'PRODUCT × AUDIENCE MATRIX', html);
    });

    document.addEventListener('click', (event) => {
      const ai = event.target.closest('[data-ai-question]');
      if (ai && !ai.closest('#strategicActions')) {
        askStrategy(ai.dataset.aiQuestion);
        return;
      }

      const close = event.target.closest('[data-close-drawer]');
      if (close) {
        closeDrawer();
        return;
      }

      const drawerAi = event.target.closest('[data-drawer-ai]');
      if (drawerAi) {
        closeDrawer();
        askStrategy(drawerAi.dataset.drawerAi);
        return;
      }

      const drawerCompare = event.target.closest('[data-drawer-compare]');
      if (drawerCompare) {
        closeDrawer();
        askStrategy(comparisonQuestion(drawerCompare.dataset.drawerCompare));
        return;
      }

      const follow = event.target.closest('[data-follow-up]');
      if (follow) {
        askStrategy(follow.dataset.followUp);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawerOpen()) closeDrawer();
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

    $('dashboardModeBtn')?.addEventListener('click', () => {
      $('analyticsGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('aiModeBtn')?.addEventListener('click', () => {
      $('aiStrategySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('aiQuestionInput')?.focus(), 500);
    });
  }

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.loading) return;
      loadSnapshot();
    }, 30000);
  }

  async function initialize() {
    if (!state.initialized) {
      state.initialized = true;
      bindEvents();
      renderActiveFilters();
      startAutoRefresh();
    }

    // The first anonymous load may occur before Google Sign-In finishes.
    // Always retry when the authenticated-user event arrives.
    await loadSnapshot();
  }

  window.addEventListener('airgesture-auth-user', () => {
    initialize();
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (window.AirGestureAuthUser) {
      initialize();
      return;
    }

    setTimeout(() => {
      if (!state.initialized) initialize();
    }, 600);
  });
})();
