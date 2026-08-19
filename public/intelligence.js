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
    audience: 'Which audience has the most events in the current AirGesture data?',
    market: 'Which market has the most users in the current AirGesture data?',
    product: 'Which file type has the most events in the current AirGesture data?',
    platform: 'Which operating system has the most events in the current AirGesture data?',
    timing: 'Which hour has the most events in the current AirGesture data?',
    usage: 'Summarize the current AirGesture data.'
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

      // AIRGESTURE_HOVER_ONLY_CHARTS_V1
      //
      // Charts remain presentation-only.
      // Mouse/touch movement is allowed ONLY so Chart.js
      // can show explanatory tooltips.
      //
      // No click event is registered here.
      events: [
        'mousemove',
        'mouseout',
        'touchstart',
        'touchmove'
      ],

      plugins: {
        legend: {
          onClick: () => {},
          onHover: () => {},
          onLeave: () => {},
          labels: {
            color: colors.text,
            usePointStyle: true,
            boxWidth: 8,
            padding: 13,
            font: { family: 'Inter', size: 10, weight: '600' }
          }
        },
        tooltip: {
          enabled: true,
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
          hoverOffset: 0
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

                const item =
                  safe[ctx.dataIndex];

                const raw =
                  Number(
                    item?.[valueField] || 0
                  );

                const total =
                  safe.reduce(
                    (sum, row) =>
                      sum +
                      Number(
                        row?.[valueField] || 0
                      ),
                    0
                  );

                const percentage =
                  total > 0
                    ? (
                        Math.round(
                          (raw / total) *
                          1000
                        ) / 10
                      )
                    : 0;

                const metric =
                  valueField === 'users'
                    ? `${formatNumber(raw)} users`
                    : `${formatNumber(raw)} events`;

                return ` ${metric} · ${percentage}%`;
              },

              afterLabel: (ctx) => {

                const item =
                  safe[ctx.dataIndex];

                return item?.bytes
                  ? `Recorded volume: ${formatBytes(item.bytes)}`
                  : '';
              }
            }
          }
        },
        // Presentation-only chart: no hover or click action.
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
              label: (ctx) => {

                const raw =
                  Number(ctx.raw || 0);

                if (
                  options.formatValue ===
                  'bytes'
                ) {
                  return ` ${formatBytes(raw)}`;
                }

                return ` ${formatNumber(raw)} ${options.valueSuffix || ''}`.trimEnd();
              },

              afterLabel: (ctx) => {

                const item =
                  safe[ctx.dataIndex];

                const lines = [];

                if (
                  item?.users !== undefined &&
                  valueField !== 'users'
                ) {

                  lines.push(
                    `${formatNumber(item.users)} users`
                  );
                }

                const total =
                  safe.reduce(
                    (sum, row) =>
                      sum +
                      Number(
                        row?.[valueField] || 0
                      ),
                    0
                  );

                const raw =
                  Number(
                    item?.[valueField] || 0
                  );

                if (
                  total > 0 &&
                  options.formatValue !== 'bytes'
                ) {

                  const share =
                    Math.round(
                      (raw / total) *
                      1000
                    ) / 10;

                  lines.push(
                    `${share}% of displayed total`
                  );
                }

                return lines;
              }
            }
          }
        },
        // Presentation-only chart: no hover or click action.
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
          pointHoverRadius: 2,
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
        plugins: {
          ...baseChartOptions().plugins,

          legend: {
            display: false
          },

          tooltip: {
            ...baseChartOptions().plugins.tooltip,

            callbacks: {

              title: (items) =>
                items?.[0]?.label
                  ? `Activity · ${items[0].label}`
                  : 'Activity',

              label: (ctx) =>
                ` ${formatNumber(ctx.raw)} events`
            }
          }
        },

        // Hover explains the data.
        // There is deliberately NO click action.
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

  function renderAiStatus(_snapshot) {
    const badge = $('aiStatusBadge');
    const provider = $('aiProviderLabel');
    const aiModeButton = $('aiModeBtn');
    const send = $('aiSendBtn');

    document.body.classList.remove('ai-agent-pending', 'ai-agent-disabled');

    if (badge) {
      badge.hidden = false;
      badge.classList.add('live');
      badge.classList.remove('fallback');
      badge.innerHTML = '<span class="ai-status-dot"></span>Data Assistant ready';
    }
    if (aiModeButton) aiModeButton.hidden = false;
    if (provider) provider.textContent = '$0 external API · current PostgreSQL aggregates';
    if (send && !send.disabled) send.innerHTML = 'Ask Data Assistant <span>↗</span>';
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

  function v6Valid(items, pretty){return (items||[]).filter(i=>{const x=pretty(i?.name);return x&&!/unspecified|unclassified|unknown/i.test(x);});}
  function v6Norm(v,m){return m>0?Math.max(0,Math.min(1,Number(v||0)/m)):0;}
  function v6Audience(snapshot){const a=v6Valid(snapshot?.dimensions?.segments,prettySegment);if(!a.length)return[];const mu=Math.max(...a.map(i=>Number(i.users||0)),1),me=Math.max(...a.map(i=>Number(i.count||0)),1);return a.map(i=>{const users=Number(i.users||0),events=Number(i.count||0),score=Math.round((v6Norm(users,mu)*.6+v6Norm(events,me)*.4)*100);return{...i,users,events,score,label:score>=80?'Very Strong':score>=65?'Strong':score>=50?'Moderate':'Explore'};}).sort((a,b)=>b.score-a.score);}
  function v6Markets(snapshot){const a=v6Valid(snapshot?.dimensions?.locations,prettyLocation);if(!a.length)return[];const mu=Math.max(...a.map(i=>Number(i.users||0)),1),mg=Math.max(...a.map(i=>Number(i.count||0)/Math.max(1,Number(i.users||0))),1),mb=Math.max(...a.map(i=>Number(i.bytes||0)),1);return a.map(i=>{const users=Number(i.users||0),events=Number(i.count||0),bytes=Number(i.bytes||0),engagement=users?events/users:0,quality=Math.round((v6Norm(users,mu)*.45+v6Norm(engagement,mg)*.30+v6Norm(bytes,mb)*.25)*100);return{...i,users,events,bytes,engagement,quality};}).sort((a,b)=>b.quality-a.quality);}
  function v6Product(snapshot){const t=String(snapshot?.dimensions?.fileTypes?.[0]?.name||'').toUpperCase();if(['PDF','DOCUMENT'].includes(t))return'PDF / productivity tools';if(['IMAGE','VIDEO'].includes(t))return'Storage / creative tools';return'Cross-device productivity';}
  function renderDecisionCockpitV6(snapshot){if(!$('decisionCockpitV6'))return;const a=v6Audience(snapshot),m=v6Markets(snapshot),A=a[0],M=m[0],P=v6Product(snapshot);$('cockpitWho').textContent=A?prettySegment(A.name):'Need more evidence';$('cockpitWhoMeta').textContent=A?`${formatNumber(A.users)} users · ${formatNumber(A.events)} events · ${A.label}`:'No qualified audience data.';$('cockpitWhere').textContent=M?prettyLocation(M.name):'Need more evidence';$('cockpitWhereMeta').textContent=M?`${formatNumber(M.users)} users · ${formatNumber(M.engagement,1)} events/user`:'No qualified market data.';$('cockpitWhat').textContent=P;$('cockpitWhatMeta').textContent='Mapped from the leading observed content type.';const ab=$('audienceRankingV6');if(ab)ab.innerHTML=a.slice(0,6).map((i,n)=>`<div class="audience-rank-row-v6"><span class="rank-index-v6">${n+1}</span><div class="rank-main-v6"><strong>${escapeHtml(prettySegment(i.name))}</strong><small>${formatNumber(i.events)} observed events</small></div><span class="strength-pill-v6">${i.label}</span><span class="rank-users-v6">${formatNumber(i.users)} users</span></div>`).join('');const mb=$('marketQualityV6');if(mb)mb.innerHTML=m.slice(0,6).map(i=>`<div class="market-quality-row-v6"><strong>${escapeHtml(prettyLocation(i.name))}</strong><div class="metric-v6"><span>Reach</span><b>${formatNumber(i.users)}</b></div><div class="metric-v6"><span>Engagement</span><b>${formatNumber(i.engagement,1)}</b></div><div class="metric-v6"><span>Volume</span><b>${formatBytes(i.bytes)}</b></div></div>`).join('');$('decisionObservedV6').textContent=A&&M?`${prettySegment(A.name)} is the leading observed audience; ${prettyLocation(M.name)} has the strongest combined market evidence.`:'More evidence is needed.';$('decisionWhyV6').textContent=M?`Market quality separates reach (${formatNumber(M.users)} users) from engagement (${formatNumber(M.engagement,1)} events/user) and volume.`:'Market size alone should not drive a decision.';$('decisionTestV6').textContent=M?`Run a small ${P.toLowerCase()} test in ${prettyLocation(M.name)}.`:`Run a small ${P.toLowerCase()} test after more evidence is available.`;$('decisionValidateV6').textContent=M&&m[1]?`Compare ${prettyLocation(M.name)} with ${prettyLocation(m[1].name)} using the same product, message and response metric.`:'Use a second market as a controlled comparison.';const u=Number(snapshot?.kpis?.users||0);$('decisionEvidenceV6').textContent=`Evidence: ${u>=25?'STRONG':u>=10?'MODERATE':'LIMITED'}`;$('decisionSampleV6').textContent=`${formatNumber(u)} observed users · ${formatNumber(snapshot?.scope?.matchingRecords||0)} records in scope`;$('decisionSampleV6').classList.toggle('warning',u<10);const opts='<option value="">Select market</option>'+m.map(i=>`<option value="${escapeHtml(i.name)}">${escapeHtml(prettyLocation(i.name))}</option>`).join('');for(const id of ['compareMarketA','compareMarketB']){const el=$(id);if(el)el.innerHTML=opts;}if(m[0])$('compareMarketA').value=m[0].name;if(m[1])$('compareMarketB').value=m[1].name;}
  function renderMarketComparisonV6(){const s=state.snapshot,box=$('compareResultsV6'),an=$('compareMarketA')?.value,bn=$('compareMarketB')?.value;if(!s||!box||!an||!bn)return showToast('Select two markets to compare.');const arr=s.dimensions?.locations||[],a=arr.find(x=>x.name===an),b=arr.find(x=>x.name===bn);if(!a||!b)return;const card=i=>{const u=Number(i.users||0),e=Number(i.count||0);return`<article class="compare-result-card-v6"><h4>${escapeHtml(prettyLocation(i.name))}</h4><div class="compare-metrics-v6"><div><span>Reach</span><strong>${formatNumber(u)} users</strong></div><div><span>Engagement</span><strong>${formatNumber(u?e/u:0,1)} events/user</strong></div><div><span>Volume</span><strong>${formatBytes(i.bytes||0)}</strong></div></div></article>`};box.hidden=false;box.innerHTML=`<div class="compare-result-grid-v6">${card(a)}${card(b)}</div><button class="text-action" type="button" data-ai-question="Compare ${escapeHtml(a.name)} and ${escapeHtml(b.name)} by users, events and data volume. Which should we test first?">Ask Data Assistant about this →</button>`;}

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
        <button type="button" data-ai-question="${escapeHtml(card.question)}">Ask Assistant →</button>
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

  const PRODUCT_CATALOG_V1 = {"Antivirus & Security Software": [["Endpoint Security Suite", "best"], ["Password Manager", "best"], ["Business VPN", "best"], ["Ransomware Protection", "best"], ["Identity Monitoring", "best"], ["Phishing Protection", "best"], ["DNS / Web Filtering", "emerging"], ["Security Awareness Training", "emerging"], ["Hardware Security Key", "emerging"], ["Encrypted USB Drive", "emerging"], ["Privacy Screen Filter", "emerging"], ["Secure Browser", "emerging"], ["Family Cyber-Safety Bundle", "unexpected"], ["Digital Legacy Vault", "unexpected"], ["Personal Data Removal Service", "unexpected"], ["Travel Cybersecurity Kit", "unexpected"], ["Webcam Privacy Hardware", "unexpected"], ["Home Network Security Appliance", "unexpected"], ["Cyber Insurance Starter Plan", "unexpected"], ["Secure Smart-Home Gateway", "unexpected"]], "Business Productivity Software": [["Microsoft 365", "best"], ["Google Workspace", "best"], ["Project Management Platform", "best"], ["Team Chat Platform", "best"], ["Video Meeting Platform", "best"], ["Digital Notes Workspace", "best"], ["Workflow Automation", "emerging"], ["Calendar Scheduling", "emerging"], ["CRM Platform", "emerging"], ["Expense Management", "emerging"], ["AI Meeting Notes", "emerging"], ["Knowledge Base Platform", "emerging"], ["Portable Monitor", "unexpected"], ["Ergonomic Keyboard", "unexpected"], ["Smart Desk Dock", "unexpected"], ["E-Ink Work Notebook", "unexpected"], ["NFC Digital Business Card", "unexpected"], ["Desk Booking Software", "unexpected"], ["Digital Receptionist", "unexpected"], ["Focus / Acoustic Privacy Device", "unexpected"]], "PDF & Document Productivity": [["Adobe Acrobat", "best"], ["Foxit PDF", "best"], ["Nitro PDF", "best"], ["E-Signature Platform", "best"], ["OCR Software", "best"], ["Portable Document Scanner", "best"], ["Secure File Sharing", "emerging"], ["Document Redaction", "emerging"], ["Contract Management", "emerging"], ["Form Automation", "emerging"], ["Document Comparison", "emerging"], ["Invoice Automation", "emerging"], ["Portable Document Camera", "unexpected"], ["Smart Pen", "unexpected"], ["E-Ink Annotation Tablet", "unexpected"], ["Digital Notary Service", "unexpected"], ["Legal Document Automation", "unexpected"], ["Document Archival Service", "unexpected"], ["Tamper-Evident Document Vault", "unexpected"], ["Smart Label / QR Filing Kit", "unexpected"]], "Cloud Storage": [["Google Drive", "best"], ["Microsoft OneDrive", "best"], ["Dropbox", "best"], ["iCloud+", "best"], ["Encrypted Cloud Storage", "best"], ["Business File Sharing", "best"], ["Large-File Transfer Service", "emerging"], ["Photo Cloud Backup", "emerging"], ["Archive Storage", "emerging"], ["Private Cloud Appliance", "emerging"], ["Home NAS", "emerging"], ["Portable SSD", "emerging"], ["Family Digital Vault", "unexpected"], ["Creator Media Vault", "unexpected"], ["Travel Backup Hub", "unexpected"], ["Wi-Fi Storage Hub", "unexpected"], ["Smartphone Backup Dock", "unexpected"], ["Digital Estate Storage", "unexpected"], ["Cold Storage Membership", "unexpected"], ["Decentralized Storage Service", "unexpected"]], "Photo & Creative Software": [["Adobe Photoshop", "best"], ["Adobe Lightroom", "best"], ["Canva", "best"], ["Video Editor", "best"], ["AI Photo Editor", "best"], ["Stock Media Subscription", "best"], ["Photo Printing Service", "emerging"], ["Photo Book Service", "emerging"], ["Portable SSD", "emerging"], ["Phone Gimbal", "emerging"], ["Creator Microphone", "emerging"], ["Mobile Camera Lens", "emerging"], ["Digital Photo Frame", "unexpected"], ["Instant Photo Printer", "unexpected"], ["Creator Lighting Kit", "unexpected"], ["Portable Projector", "unexpected"], ["Smart Photo Organizer", "unexpected"], ["AI Background Studio", "unexpected"], ["Digital Art Display", "unexpected"], ["Photo Restoration Service", "unexpected"]], "Backup & Recovery": [["Cloud Backup", "best"], ["Ransomware Recovery", "best"], ["External SSD", "best"], ["External HDD", "best"], ["NAS Backup", "best"], ["Business Disaster Recovery", "best"], ["Mobile Phone Backup", "emerging"], ["Photo Backup", "emerging"], ["Encrypted Offline Backup", "emerging"], ["Data Recovery Service", "emerging"], ["Backup Power + Storage Bundle", "emerging"], ["Automated Backup Dock", "emerging"], ["Fireproof Backup Drive Safe", "unexpected"], ["Water-Resistant Media Vault", "unexpected"], ["Family Backup Subscription", "unexpected"], ["Travel Backup Kit", "unexpected"], ["Digital Legacy Backup", "unexpected"], ["Cold Archive Service", "unexpected"], ["Creator Disaster-Recovery Kit", "unexpected"], ["Home Cyber-Recovery Appliance", "unexpected"]]};

  let productExplorerCategoryV1 = '';
  let productExplorerTierV1 = 'all';
  function catalogForOpportunityV1(title) {
    if (PRODUCT_CATALOG_V1[title]) return PRODUCT_CATALOG_V1[title];
    const t=String(title||'').toLowerCase();
    if(t.includes('security')||t.includes('antivirus')) return PRODUCT_CATALOG_V1['Antivirus & Security Software'];
    if(t.includes('pdf')||t.includes('document')) return PRODUCT_CATALOG_V1['PDF & Document Productivity'];
    if(t.includes('cloud')||t.includes('storage')) return PRODUCT_CATALOG_V1['Cloud Storage'];
    if(t.includes('photo')||t.includes('creative')) return PRODUCT_CATALOG_V1['Photo & Creative Software'];
    if(t.includes('backup')||t.includes('recovery')) return PRODUCT_CATALOG_V1['Backup & Recovery'];
    return PRODUCT_CATALOG_V1['Business Productivity Software'];
  }
  function productExplorerContextV1(snapshot){
    const audience=(snapshot?.dimensions?.segments||[]).find(i=>prettySegment(i.name)!=='Unclassified');
    const market=(snapshot?.dimensions?.locations||[]).find(i=>prettyLocation(i.name)!=='Unspecified');
    const file=snapshot?.dimensions?.fileTypes?.[0]; const users=Number(snapshot?.kpis?.users||market?.users||0);
    return {audience:prettySegment(audience?.name||'Current audience mix'),market:prettyLocation(market?.name||'Current market scope'),signal:file?`${prettyFileType(file.name)} leads observed content`:'Current aggregate usage pattern',evidence:users>=25?'Strong sample':users>=10?'Moderate sample':'Limited sample'};
  }
  function renderProductExplorerGridV1(){
    const grid=$('productExplorerGridV1'); if(!grid||!productExplorerCategoryV1)return;
    const c=productExplorerContextV1(state.snapshot); const tierText=t=>t==='best'?'Best Fit':t==='emerging'?'Emerging':'Unexpected';
    const products=catalogForOpportunityV1(productExplorerCategoryV1).filter(p=>productExplorerTierV1==='all'||p[1]===productExplorerTierV1);
    grid.innerHTML=products.map((p,index)=>{const why=p[1]==='best'?`Directly related to the observed ${c.audience} / ${c.market} usage pattern.`:p[1]==='emerging'?`Adjacent to observed technology behavior and suitable for a controlled test in ${c.market}.`:`An unconventional hypothesis to test—not a claim that users intend to buy it.`; return `<article class="product-card-v1"><div class="product-card-top-v1"><span class="product-number-v1">${String(index+1).padStart(2,'0')}</span><span class="product-tier-v1 ${escapeHtml(p[1])}">${escapeHtml(tierText(p[1]))}</span></div><h3>${escapeHtml(p[0])}</h3><p>${escapeHtml(why)}</p><div class="product-test-v1"><strong>HOW TO TEST:</strong> Run a small ${escapeHtml(c.market)} campaign and compare response with another product in the same category.</div></article>`;}).join('');
  }
  function openProductExplorerV1(category,reason){
    const el=$('productExplorerV1'); if(!el)return; productExplorerCategoryV1=category; productExplorerTierV1='all'; const c=productExplorerContextV1(state.snapshot);
    $('productExplorerTitleV1').textContent=category; $('productExplorerSubtitleV1').textContent=`20 product opportunities—from obvious fits to unconventional experiments. ${reason||''}`.trim(); $('productExplorerAudienceV1').textContent=c.audience; $('productExplorerMarketV1').textContent=c.market; $('productExplorerSignalV1').textContent=c.signal; $('productExplorerEvidenceV1').textContent=c.evidence;
    document.querySelectorAll('[data-product-tier]').forEach(b=>b.classList.toggle('active',b.dataset.productTier==='all')); renderProductExplorerGridV1(); el.hidden=false; el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
  }
  function closeProductExplorerV1(){const el=$('productExplorerV1');if(!el)return;el.hidden=true;el.setAttribute('aria-hidden','true');document.body.style.overflow='';}
  function bindProductExplorerV1(){
    if(document.documentElement.dataset.productExplorerBoundV1==='1')return; document.documentElement.dataset.productExplorerBoundV1='1';
    document.addEventListener('click',event=>{
      const openBtn=event.target.closest('[data-product-category]'); if(openBtn){openProductExplorerV1(openBtn.dataset.productCategory,openBtn.dataset.productReason);return;}
      if(event.target.closest('[data-close-product-explorer]')){closeProductExplorerV1();return;}
      const tierBtn=event.target.closest('[data-product-tier]'); if(tierBtn){productExplorerTierV1=tierBtn.dataset.productTier||'all';document.querySelectorAll('[data-product-tier]').forEach(b=>b.classList.toggle('active',b===tierBtn));renderProductExplorerGridV1();return;}
      if(event.target.closest('#productExplorerAskV1')){const c=productExplorerContextV1(state.snapshot);closeProductExplorerV1();askStrategy(`For ${productExplorerCategoryV1}, analyze ${c.market} and ${c.audience}. Which product ideas should we test first and what limitation should management remember?`);}
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('productExplorerV1')?.hidden)closeProductExplorerV1();});
  }

  function renderOpportunities(snapshot) {
    const container = $('opportunityList');
    if (!container) return;
    const items = (snapshot.opportunities || []).slice(0, 6);
    container.innerHTML = items.map((item) => {
      const available = catalogForOpportunityV1(item.title).length;
      return `
        <article class="opportunity-row">
          <div class="opportunity-row-head"><h3>${escapeHtml(item.title)}</h3><span class="opportunity-label">${escapeHtml(opportunityLabel(item.score))}</span></div>
          <p>${escapeHtml(item.reason || 'Observed behavior supports a controlled product-message test.')}</p>
          <button class="product-explore-btn-v1" type="button" data-product-category="${escapeHtml(item.title)}" data-product-reason="${escapeHtml(item.reason || '')}">Explore ${available} products →</button>
        </article>`;
    }).join('');
  }

  function renderAll(snapshot) {
    state.snapshot = snapshot;
    renderKpis(snapshot);
    renderAiStatus(snapshot);
    renderDecisionSnapshot(snapshot);
    renderDecisionCockpitV6(snapshot);
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
      strong.textContent = label || 'AirGesture Data Assistant';
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
    container.innerHTML = '<div class="ai-message assistant intro-message"><div class="ai-avatar">✦</div><div><strong>AirGesture Data Assistant</strong><p>Ask a data or business-test question. I calculate the answer from the current AirGesture aggregates without an external AI API.</p></div></div>';
    const panel = $('aiAnswerPanel');
    if (panel) panel.innerHTML = '<div class="ai-answer-empty"><span>✦</span><strong>Your data answer will appear here</strong><p>Direct answer · evidence · recommendation · experiment · limitation</p></div>';
    if (state.aiChart) { state.aiChart.destroy(); state.aiChart = null; }
  }

  function formatAgentChartLabel(value, dimension) {
    if (dimension === 'location') return prettyLocation(value, true);
    if (dimension === 'segment') return prettySegment(value);
    if (dimension === 'file_type') return prettyFileType(value);
    if (dimension === 'os') return prettyOs(value);
    if (dimension === 'browser') return prettyBrowser(value);
    return String(value || 'Unknown');
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
        labels: chart.data.map((item) => formatAgentChartLabel(item.label, chart.dimension)),
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
    const assistant = data?.assistant || {};
    if (!panel || !strategy) return;

    const evidence = (strategy.evidence || []).slice(0, 6);
    const followUps = (strategy.followUps || []).slice(0, 4);
    const rowsAnalyzed = Number(assistant.rowsAnalyzed || 0);
    const sourceLabel = `Current database answer · ${rowsAnalyzed ? `${formatNumber(rowsAnalyzed)} events analyzed · ` : ''}$0 external AI API`;

    panel.innerHTML = `
      <div class="ai-result">
        <div class="ai-answer-source live">${sourceLabel}</div>
        <div class="ai-result-heading"><span>${escapeHtml(String(strategy.scenario || 'DATA ANALYSIS').replace(/-/g, ' ').toUpperCase())}</span><h3>${escapeHtml(strategy.title || 'AirGesture analysis')}</h3><p>${escapeHtml(strategy.directAnswer || '')}</p></div>
        <div class="ai-section-card"><span>Evidence from current AirGesture data</span><ul class="ai-evidence-list">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
        ${strategy.chart?.data?.length ? '<div class="ai-chart-container"><canvas id="strategySupportingChart"></canvas></div>' : ''}
        ${strategy.interpretation ? `<div class="ai-section-card"><span>What it means</span><p>${escapeHtml(strategy.interpretation)}</p></div>` : ''}
        ${strategy.recommendation ? `<div class="ai-section-card decision"><span>Recommended decision</span><p>${escapeHtml(strategy.recommendation)}</p></div>` : ''}
        ${strategy.experiment ? `<div class="ai-section-card"><span>How to validate it</span><p>${escapeHtml(strategy.experiment)}</p></div>` : ''}
        ${strategy.channel ? `<div class="ai-section-card"><span>Channel consideration</span><p>${escapeHtml(strategy.channel)}</p></div>` : ''}
        <div class="ai-section-card risk"><span>Limitation</span><p>${escapeHtml(strategy.limitation || strategy.risk || 'The available AirGesture data does not measure purchase intent or campaign conversion.')}</p></div>
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
    if (send) { send.disabled = true; send.textContent = 'Calculating from current data…'; }

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
      addConversationMessage('assistant', answer, 'AirGesture Data Assistant');

      state.aiHistory.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      );
      state.aiHistory = state.aiHistory.slice(-8);
      if ($('aiQuestionInput')) $('aiQuestionInput').value = '';
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      addConversationMessage('assistant', error.message || 'The data request failed.', 'AirGesture Data Assistant');
      showToast(error.message || 'Could not complete data analysis.');
    } finally {
      if (send) {
        send.disabled = false;
        send.innerHTML = 'Ask Data Assistant <span>↗</span>';
      }
    }
  }

  function bindDecisionCockpitV6(){document.addEventListener('click',(event)=>{if(event.target.closest('#compareMarketsBtn')){renderMarketComparisonV6();return;}if(event.target.closest('#cockpitAskBtn')){askStrategy(`Analyze ${$('cockpitWho')?.textContent||'the leading audience'} in ${$('cockpitWhere')?.textContent||'the leading market'} for a ${$('cockpitWhat')?.textContent||'product'} test. Explain the evidence, limitation and validation step.`);}});}

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
      bindProductExplorerV1();
      bindDecisionCockpitV6();
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


  // AIRGESTURE_MARKETPLACE_V2_OVERRIDE

  const PRODUCT_BRANDS_V2 = {
    'Microsoft 365': ['microsoft.com','Microsoft'],
    'Google Workspace': ['workspace.google.com','Google'],
    'Google Drive': ['drive.google.com','Google Drive'],
    'Microsoft OneDrive': ['onedrive.com','OneDrive'],
    'Dropbox': ['dropbox.com','Dropbox'],
    'iCloud+': ['icloud.com','Apple'],
    'Adobe Acrobat': ['adobe.com','Adobe'],
    'Adobe Photoshop': ['adobe.com','Adobe'],
    'Adobe Lightroom': ['adobe.com','Adobe'],
    'Canva': ['canva.com','Canva'],
    'Foxit PDF': ['foxit.com','Foxit'],
    'Nitro PDF': ['gonitro.com','Nitro']
  };

  let productExplorerKindV2 = 'all';
  let productExplorerSearchV2 = '';

  const productCompareV2 = new Map();

  function productBrandV2(name) {
    const b = PRODUCT_BRANDS_V2[name];

    return b ? {
      domain: b[0],
      label: b[1]
    } : null;
  }

  function productKindV2(name) {

    const n = String(name).toLowerCase();

    if (
      /ssd|hdd|nas|monitor|keyboard|usb|screen|webcam|camera|pen|tablet|gimbal|microphone|lens|frame|printer|projector|hub|dock|appliance|gateway|vault/.test(n)
    ) return 'hardware';

    if (
      /service|insurance|training|notary|restoration|subscription|membership|archive/.test(n)
    ) return 'service';

    return 'software';
  }

  function productFitV2(tier) {

    if (tier === 'best') return 88;
    if (tier === 'emerging') return 68;

    return 44;
  }

  function productLogoV2(name) {

    const brand = productBrandV2(name);

    if (brand) {

      const src =
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(brand.domain)}&sz=128`;

      return `
        <div class="product-logo-wrap-v2">
          <img class="product-logo-v2"
               src="${src}"
               alt="${escapeHtml(brand.label)} logo"
               loading="lazy">
        </div>
      `;
    }

    const initials = String(name)
      .split(/\s+/)
      .slice(0,2)
      .map(x => x[0] || '')
      .join('')
      .toUpperCase();

    return `
      <div class="product-logo-wrap-v2">
        <div class="product-logo-fallback-v2">
          ${escapeHtml(initials || 'P')}
        </div>
      </div>
    `;
  }

  function marketplaceContextV2() {

    const s = state.snapshot;

    const audience =
      (s?.dimensions?.segments || [])
      .find(i => prettySegment(i.name) !== 'Unclassified');

    const market =
      (s?.dimensions?.locations || [])
      .find(i => prettyLocation(i.name) !== 'Unspecified');

    return {
      audience:
        prettySegment(audience?.name || 'Current audience'),
      market:
        prettyLocation(market?.name || 'Current market')
    };
  }

  function updateCompareV2() {

    const tray = $('productCompareTrayV2');
    const items = $('productCompareItemsV2');
    const count = $('productCompareCountV2');

    if (!tray || !items || !count) return;

    const products = [...productCompareV2.values()];

    tray.hidden = products.length === 0;

    count.textContent =
      `${products.length} selected`;

    items.innerHTML =
      products
      .map(p =>
        `<span class="product-compare-chip-v2">
          ${escapeHtml(p.name)}
        </span>`
      )
      .join('');

    document
      .querySelectorAll('[data-compare-product]')
      .forEach(button => {

        const selected =
          productCompareV2.has(
            button.dataset.compareProduct
          );

        button.classList.toggle(
          'selected',
          selected
        );

        button.textContent =
          selected
          ? '✓ Selected'
          : '+ Compare';
      });
  }


  function showProductComparisonV2() {

    const selected =
      [...productCompareV2.values()];

    if (selected.length < 2) {

      showToast(
        'Select at least two products to compare.'
      );

      return;
    }

    const box =
      $('productComparisonV2');

    const grid =
      $('productComparisonGridV2');

    const context =
      marketplaceContextV2();

    grid.innerHTML =
      selected.map(product => `

        <article class="product-compare-card-v2">

          <h4>${escapeHtml(product.name)}</h4>

          <p>
            <strong>Opportunity:</strong>
            ${escapeHtml(product.tier)}
          </p>

          <p>
            <strong>Product type:</strong>
            ${escapeHtml(product.kind)}
          </p>

          <p>
            <strong>Audience:</strong>
            ${escapeHtml(context.audience)}
          </p>

          <p>
            <strong>Market:</strong>
            ${escapeHtml(context.market)}
          </p>

          <p>
            <strong>Validation:</strong>
            Run the same small campaign and compare
            actual response before scaling.
          </p>

        </article>

      `).join('');

    box.hidden = false;

    box.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }


  renderProductExplorerGridV1 = function() {

    const grid =
      $('productExplorerGridV1');

    if (
      !grid ||
      !productExplorerCategoryV1
    ) return;

    const context =
      marketplaceContextV2();

    const tierText =
      tier =>
        tier === 'best'
        ? 'Best Fit'
        : tier === 'emerging'
        ? 'Emerging'
        : 'Unexpected';

    let products =
      catalogForOpportunityV1(
        productExplorerCategoryV1
      )
      .map(p => ({
        name: p[0],
        tier: p[1],
        kind: productKindV2(p[0])
      }));

    products =
      products.filter(p =>
        productExplorerTierV1 === 'all' ||
        p.tier === productExplorerTierV1
      );

    products =
      products.filter(p =>
        productExplorerKindV2 === 'all' ||
        p.kind === productExplorerKindV2
      );

    products =
      products.filter(p =>
        !productExplorerSearchV2 ||
        p.name
        .toLowerCase()
        .includes(productExplorerSearchV2)
      );


    grid.innerHTML =
      products.map((p,index) => {

        const score =
          productFitV2(p.tier);

        const brand =
          productBrandV2(p.name);

        const why =
          p.tier === 'best'
          ? `Directly connected to the observed ${context.audience} / ${context.market} behavior.`
          :
          p.tier === 'emerging'
          ? `An adjacent commercial hypothesis worth testing in ${context.market}.`
          :
          `An unconventional opportunity to test — not evidence of purchase intent.`;

        return `

          <article
            class="product-card-v1"
            data-product-card="${escapeHtml(p.name)}">

            <div class="product-card-top-v1">

              <span class="product-number-v1">
                ${String(index + 1).padStart(2,'0')}
              </span>

              <span class="product-tier-v1 ${escapeHtml(p.tier)}">
                ${escapeHtml(tierText(p.tier))}
              </span>

            </div>

            ${productLogoV2(p.name)}

            <h3>
              ${escapeHtml(p.name)}
            </h3>

            <p>
              ${escapeHtml(why)}
            </p>

            <div class="product-fit-meter-v2">

              <div>
                <i style="width:${score}%"></i>
              </div>

              <span>
                Test priority:
                ${score}/100 · hypothesis score
              </span>

            </div>

            <div class="product-test-v1">

              <strong>HOW TO TEST:</strong>

              Run a small
              ${escapeHtml(context.market)}
              campaign and compare actual response.

            </div>

            <div class="product-card-actions-v2">

              <button
                data-compare-product="${escapeHtml(p.name)}"
                data-tier="${escapeHtml(tierText(p.tier))}"
                data-kind="${escapeHtml(p.kind)}"
                type="button">

                + Compare

              </button>

              ${
                brand
                ? `
                  <a
                    href="https://${escapeHtml(brand.domain)}"
                    target="_blank"
                    rel="noopener noreferrer">
                    Official Site ↗
                  </a>
                `
                : ''
              }

            </div>

          </article>

        `;

      }).join('');


    updateCompareV2();
  };


  $('productSearchV2')
    ?.addEventListener(
      'input',
      event => {

        productExplorerSearchV2 =
          String(event.target.value || '')
          .trim()
          .toLowerCase();

        renderProductExplorerGridV1();
      }
    );


  document.addEventListener(
    'click',
    event => {

      const typeButton =
        event.target.closest(
          '[data-product-kind]'
        );

      if (typeButton) {

        productExplorerKindV2 =
          typeButton.dataset.productKind;

        document
          .querySelectorAll(
            '[data-product-kind]'
          )
          .forEach(button =>
            button.classList.toggle(
              'active',
              button === typeButton
            )
          );

        renderProductExplorerGridV1();

        return;
      }


      const compareButton =
        event.target.closest(
          '[data-compare-product]'
        );

      if (compareButton) {

        const name =
          compareButton.dataset.compareProduct;

        if (
          productCompareV2.has(name)
        ) {

          productCompareV2.delete(name);

        } else {

          if (
            productCompareV2.size >= 3
          ) {

            showToast(
              'You can compare up to three products.'
            );

            return;
          }

          productCompareV2.set(
            name,
            {
              name,
              tier:
                compareButton.dataset.tier,
              kind:
                compareButton.dataset.kind
            }
          );
        }

        updateCompareV2();

        return;
      }


      if (
        event.target.closest(
          '#compareProductsV2'
        )
      ) {

        showProductComparisonV2();

        return;
      }


      if (
        event.target.closest(
          '#clearCompareV2'
        )
      ) {

        productCompareV2.clear();

        updateCompareV2();

        $('productComparisonV2').hidden =
          true;

        return;
      }


      if (
        event.target.closest(
          '#closeComparisonV2'
        )
      ) {

        $('productComparisonV2').hidden =
          true;

        return;
      }


      if (
        event.target.closest(
          '#surpriseProductV2'
        )
      ) {

        productExplorerTierV1 =
          'unexpected';

        document
          .querySelectorAll(
            '[data-product-tier]'
          )
          .forEach(button =>
            button.classList.toggle(
              'active',
              button.dataset.productTier ===
              'unexpected'
            )
          );

        renderProductExplorerGridV1();

        const cards =
          [...document.querySelectorAll(
            '[data-product-card]'
          )];

        if (cards.length) {

          const card =
            cards[
              Math.floor(
                Math.random() *
                cards.length
              )
            ];

          card.classList.add(
            'flash-v2'
          );

          card.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });

          setTimeout(
            () =>
              card.classList.remove(
                'flash-v2'
              ),
            1600
          );
        }
      }
    }
  );



  // AIRGESTURE_BRANDED_PRODUCTS_V3

  const BRANDED_PRODUCT_CATALOG_V3 = {
    'Antivirus & Security Software': [
      ['Norton 360 Deluxe','best'],
      ['Bitdefender Total Security','best'],
      ['McAfee+ Premium','best'],
      ['ESET HOME Security Premium','best'],
      ['Malwarebytes Premium Security','best'],
      ['Avast Premium Security','best'],

      ['Trend Micro Maximum Security','emerging'],
      ['AVG Internet Security','emerging'],
      ['Microsoft Defender','emerging'],
      ['1Password','emerging'],
      ['Bitwarden Premium','emerging'],
      ['Dashlane Premium','emerging'],

      ['YubiKey 5 NFC','unexpected'],
      ['Cloudflare Zero Trust','unexpected'],
      ['Cisco Umbrella','unexpected'],
      ['Proton VPN Plus','unexpected'],
      ['NordVPN','unexpected'],
      ['Keeper Security','unexpected'],
      ['Aura Identity Protection','unexpected'],
      ['NordPass','unexpected']
    ]
  };


  const PRODUCT_BRANDS_V3 = {

    'Norton 360 Deluxe': {
      company: 'Norton',
      domain: 'norton.com'
    },

    'Bitdefender Total Security': {
      company: 'Bitdefender',
      domain: 'bitdefender.com'
    },

    'McAfee+ Premium': {
      company: 'McAfee',
      domain: 'mcafee.com'
    },

    'ESET HOME Security Premium': {
      company: 'ESET',
      domain: 'eset.com'
    },

    'Malwarebytes Premium Security': {
      company: 'Malwarebytes',
      domain: 'malwarebytes.com'
    },

    'Avast Premium Security': {
      company: 'Avast',
      domain: 'avast.com'
    },

    'Trend Micro Maximum Security': {
      company: 'Trend Micro',
      domain: 'trendmicro.com'
    },

    'AVG Internet Security': {
      company: 'AVG',
      domain: 'avg.com'
    },

    'Microsoft Defender': {
      company: 'Microsoft',
      domain: 'microsoft.com'
    },

    '1Password': {
      company: '1Password',
      domain: '1password.com'
    },

    'Bitwarden Premium': {
      company: 'Bitwarden',
      domain: 'bitwarden.com'
    },

    'Dashlane Premium': {
      company: 'Dashlane',
      domain: 'dashlane.com'
    },

    'YubiKey 5 NFC': {
      company: 'Yubico',
      domain: 'yubico.com'
    },

    'Cloudflare Zero Trust': {
      company: 'Cloudflare',
      domain: 'cloudflare.com'
    },

    'Cisco Umbrella': {
      company: 'Cisco',
      domain: 'cisco.com'
    },

    'Proton VPN Plus': {
      company: 'Proton',
      domain: 'proton.me'
    },

    'NordVPN': {
      company: 'Nord Security',
      domain: 'nordvpn.com'
    },

    'Keeper Security': {
      company: 'Keeper',
      domain: 'keepersecurity.com'
    },

    'Aura Identity Protection': {
      company: 'Aura',
      domain: 'aura.com'
    },

    'NordPass': {
      company: 'Nord Security',
      domain: 'nordpass.com'
    }
  };


  const originalCatalogForOpportunityV3 =
    catalogForOpportunityV1;


  catalogForOpportunityV1 = function(title) {

    if (
      BRANDED_PRODUCT_CATALOG_V3[title]
    ) {

      return BRANDED_PRODUCT_CATALOG_V3[
        title
      ];
    }

    return originalCatalogForOpportunityV3(
      title
    );
  };


  productBrandV2 = function(name) {

    const v3 =
      PRODUCT_BRANDS_V3[name];

    if (v3) {

      return {
        domain: v3.domain,
        label: v3.company,
        company: v3.company
      };
    }

    const old =
      PRODUCT_BRANDS_V2?.[name];

    if (old) {

      return {
        domain: old[0],
        label: old[1],
        company: old[1]
      };
    }

    return null;
  };


  function companyNameV3(name) {

    return (
      PRODUCT_BRANDS_V3[name]?.company ||
      productBrandV2(name)?.company ||
      'Product Brand'
    );
  }


  renderProductExplorerGridV1 = function() {

    const grid =
      $('productExplorerGridV1');

    if (
      !grid ||
      !productExplorerCategoryV1
    ) return;


    const context =
      marketplaceContextV2();


    const tierText =
      tier =>
        tier === 'best'
          ? 'Best Fit'
          : tier === 'emerging'
            ? 'Emerging'
            : 'Unexpected';


    let products =
      catalogForOpportunityV1(
        productExplorerCategoryV1
      )
      .map(p => ({
        name: p[0],
        tier: p[1],
        kind: productKindV2(p[0])
      }));


    products =
      products.filter(p =>
        productExplorerTierV1 === 'all' ||
        p.tier === productExplorerTierV1
      );


    products =
      products.filter(p =>
        productExplorerKindV2 === 'all' ||
        p.kind === productExplorerKindV2
      );


    products =
      products.filter(p =>
        !productExplorerSearchV2 ||
        p.name
          .toLowerCase()
          .includes(productExplorerSearchV2)
      );


    grid.innerHTML =
      products.map((p,index) => {

        const score =
          productFitV2(p.tier);

        const brand =
          productBrandV2(p.name);

        const company =
          companyNameV3(p.name);

        const why =
          p.tier === 'best'
            ? `Strong commercial test candidate for the observed ${context.audience} audience in ${context.market}.`
            : p.tier === 'emerging'
              ? `Adjacent branded product worth testing against the stronger candidates in ${context.market}.`
              : `An unconventional branded opportunity to test—not evidence of purchase intent.`;


        const logo =
          brand
            ? `
              <div class="product-logo-wrap-v2">
                <img
                  class="product-logo-v2 product-logo-large-v3"
                  src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(brand.domain)}&sz=128"
                  alt="${escapeHtml(company)} logo"
                  loading="lazy">
              </div>
            `
            : productLogoV2(p.name);


        return `

          <article
            class="product-card-v1 branded-product-card-v3"
            data-product-card="${escapeHtml(p.name)}">

            <div class="product-card-top-v1">

              <span class="product-number-v1">
                ${String(index + 1).padStart(2,'0')}
              </span>

              <span
                class="product-tier-v1 ${escapeHtml(p.tier)}">

                ${escapeHtml(
                  tierText(p.tier)
                )}

              </span>

            </div>


            ${logo}


            <div class="product-company-v3">
              ${escapeHtml(company)}
            </div>


            <h3 class="product-name-v3">
              ${escapeHtml(p.name)}
            </h3>


            <p>
              ${escapeHtml(why)}
            </p>


            <div class="product-fit-meter-v2">

              <div>
                <i style="width:${score}%"></i>
              </div>

              <span>
                Test priority:
                ${score}/100 · hypothesis score
              </span>

            </div>


            <div class="product-test-v1">

              <strong>HOW TO TEST:</strong>

              Run a small
              ${escapeHtml(context.market)}
              campaign and compare actual
              response with another branded
              product in this category.

            </div>


            <div class="product-card-actions-v2">

              <button
                data-compare-product="${escapeHtml(p.name)}"
                data-tier="${escapeHtml(tierText(p.tier))}"
                data-kind="${escapeHtml(p.kind)}"
                type="button">

                + Compare

              </button>


              ${
                brand
                  ? `
                    <a
                      href="https://${escapeHtml(brand.domain)}"
                      target="_blank"
                      rel="noopener noreferrer">

                      Visit ${escapeHtml(company)} ↗

                    </a>
                  `
                  : ''
              }

            </div>

          </article>

        `;

      }).join('');


    updateCompareV2();
  };



  // AIRGESTURE_PRODUCT_DESCRIPTIONS_V4

  const PRODUCT_DESCRIPTIONS_V4 = {

    'Norton 360 Deluxe':
      'All-in-one consumer security suite combining antivirus, ransomware protection, VPN, password tools and online privacy features.',

    'Bitdefender Total Security':
      'Multi-device cybersecurity software designed to protect computers and mobile devices from malware, ransomware, phishing and online threats.',

    'McAfee+ Premium':
      'Personal security suite combining antivirus, identity monitoring, privacy protection and secure browsing tools across multiple devices.',

    'ESET HOME Security Premium':
      'Advanced endpoint security for home users with malware protection, secure browsing, password management and privacy-focused security features.',

    'Malwarebytes Premium Security':
      'Security software focused on detecting malware, ransomware, malicious websites and other threats that traditional antivirus may miss.',

    'Avast Premium Security':
      'Multi-device antivirus and privacy software that protects against malware, unsafe websites, ransomware and suspicious applications.',

    'Trend Micro Maximum Security':
      'Consumer cybersecurity suite providing malware protection, web-threat blocking, privacy controls and ransomware defense across devices.',

    'AVG Internet Security':
      'Security software that protects computers from viruses, ransomware, phishing, unsafe downloads and suspicious websites.',

    'Microsoft Defender':
      'Microsoft security platform providing built-in malware protection, threat detection and security monitoring for Windows and Microsoft users.',

    '1Password':
      'Password manager that securely stores passwords, passkeys and sensitive account information while helping users sign in safely across devices.',

    'Bitwarden Premium':
      'Encrypted password-management platform that stores credentials, generates strong passwords and synchronizes secure vaults across devices.',

    'Dashlane Premium':
      'Password and identity-security service that manages credentials, monitors compromised accounts and helps users improve online security.',

    'YubiKey 5 NFC':
      'Physical hardware security key from Yubico that adds strong multi-factor authentication to online accounts using USB and NFC.',

    'Cloudflare Zero Trust':
      'Cloud security platform that helps organizations control access to applications, users and internet traffic without relying on a traditional network perimeter.',

    'Cisco Umbrella':
      'Cloud-delivered security service that blocks malicious domains, phishing sites and risky internet traffic before users connect to them.',

    'Proton VPN Plus':
      'Privacy-focused VPN service that encrypts internet traffic and helps protect users when browsing on public or untrusted networks.',

    'NordVPN':
      'VPN service that encrypts internet connections, protects online privacy and provides additional tools for safer browsing across devices.',

    'Keeper Security':
      'Password-management and privileged-access platform that protects credentials, secrets and sensitive account information.',

    'Aura Identity Protection':
      'Digital identity-protection service combining identity monitoring, fraud alerts, online privacy tools and personal cybersecurity features.',

    'NordPass':
      'Password manager from Nord Security that securely stores credentials, passkeys and sensitive information across multiple devices.'
  };


  const originalRenderProductExplorerGridV4 =
    renderProductExplorerGridV1;


  function productDescriptionV4(name) {

    return PRODUCT_DESCRIPTIONS_V4[name]
      || 'A commercial product or service related to the observed technology behavior. This recommendation is intended as a market-test hypothesis.';
  }


  renderProductExplorerGridV1 = function() {

    const grid =
      $('productExplorerGridV1');

    if (
      !grid ||
      !productExplorerCategoryV1
    ) return;


    const context =
      marketplaceContextV2();


    const tierText =
      tier =>
        tier === 'best'
          ? 'Best Fit'
          : tier === 'emerging'
            ? 'Emerging'
            : 'Unexpected';


    let products =
      catalogForOpportunityV1(
        productExplorerCategoryV1
      )
      .map(p => ({
        name: p[0],
        tier: p[1],
        kind: productKindV2(p[0])
      }));


    products =
      products.filter(p =>
        productExplorerTierV1 === 'all' ||
        p.tier === productExplorerTierV1
      );


    products =
      products.filter(p =>
        productExplorerKindV2 === 'all' ||
        p.kind === productExplorerKindV2
      );


    products =
      products.filter(p =>
        !productExplorerSearchV2 ||
        p.name
          .toLowerCase()
          .includes(productExplorerSearchV2)
      );


    grid.innerHTML =
      products.map((p,index) => {

        const score =
          productFitV2(p.tier);

        const brand =
          productBrandV2(p.name);

        const company =
          companyNameV3(p.name);

        const description =
          productDescriptionV4(p.name);


        const why =
          p.tier === 'best'
            ? `Strong commercial test candidate for the observed ${context.audience} audience in ${context.market}.`
            : p.tier === 'emerging'
              ? `Adjacent branded product worth testing against stronger candidates in ${context.market}.`
              : `An unconventional branded opportunity to test—not evidence of purchase intent.`;


        const logo =
          brand
            ? `
              <a
                class="product-logo-link-v4"
                href="https://${escapeHtml(brand.domain)}"
                target="_blank"
                rel="noopener noreferrer"
                title="Visit ${escapeHtml(company)}">

                <div class="product-logo-wrap-v2">

                  <img
                    class="product-logo-v2 product-logo-large-v3"
                    src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(brand.domain)}&sz=128"
                    alt="${escapeHtml(company)} logo"
                    loading="lazy">

                </div>

              </a>
            `
            : productLogoV2(p.name);


        return `

          <article
            class="product-card-v1 branded-product-card-v3"
            data-product-card="${escapeHtml(p.name)}">

            <div class="product-card-top-v1">

              <span class="product-number-v1">
                ${String(index + 1).padStart(2,'0')}
              </span>

              <span
                class="product-tier-v1 ${escapeHtml(p.tier)}">

                ${escapeHtml(
                  tierText(p.tier)
                )}

              </span>

            </div>


            ${logo}


            <div class="product-company-v3">
              ${escapeHtml(company)}
            </div>


            <h3 class="product-name-v3">
              ${escapeHtml(p.name)}
            </h3>


            <div class="product-about-v4">

              <span>WHAT IT DOES</span>

              <p>
                ${escapeHtml(description)}
              </p>

            </div>


            <div class="product-market-fit-v4">

              <span>WHY IT MAY FIT THIS MARKET</span>

              <p>
                ${escapeHtml(why)}
              </p>

            </div>


            <div class="product-fit-meter-v2">

              <div>
                <i style="width:${score}%"></i>
              </div>

              <span>
                Test priority:
                ${score}/100 · hypothesis score
              </span>

            </div>


            <div class="product-test-v1">

              <strong>HOW TO TEST:</strong>

              Run a small
              ${escapeHtml(context.market)}
              campaign and compare actual
              response with another product
              in the same category.

            </div>


            <div class="product-card-actions-v2">

              <button
                data-compare-product="${escapeHtml(p.name)}"
                data-tier="${escapeHtml(tierText(p.tier))}"
                data-kind="${escapeHtml(p.kind)}"
                type="button">

                + Compare

              </button>


              ${
                brand
                  ? `
                    <a
                      href="https://${escapeHtml(brand.domain)}"
                      target="_blank"
                      rel="noopener noreferrer">

                      Visit ${escapeHtml(company)} ↗

                    </a>
                  `
                  : ''
              }

            </div>

          </article>

        `;

      }).join('');


    updateCompareV2();
  };



  // AIRGESTURE_ALL_BRANDED_PRODUCTS_V5

  const BRANDED_MARKETPLACE_V5 = {

    'Business Productivity Software': [

      {
        name:'Microsoft 365',
        company:'Microsoft',
        domain:'microsoft.com',
        tier:'best',
        description:'Business productivity suite combining Word, Excel, PowerPoint, Outlook, Teams and cloud collaboration tools.'
      },

      {
        name:'Google Workspace',
        company:'Google',
        domain:'workspace.google.com',
        tier:'best',
        description:'Cloud productivity platform providing Gmail, Drive, Docs, Sheets, Meet and collaborative business applications.'
      },

      {
        name:'Slack',
        company:'Salesforce',
        domain:'slack.com',
        tier:'best',
        description:'Business messaging and collaboration platform for team communication, workflows, integrations and shared workspaces.'
      },

      {
        name:'Zoom Workplace',
        company:'Zoom',
        domain:'zoom.com',
        tier:'best',
        description:'Collaboration platform combining video meetings, chat, phone, scheduling and workplace productivity tools.'
      },

      {
        name:'Notion',
        company:'Notion',
        domain:'notion.so',
        tier:'best',
        description:'Connected workspace for notes, documents, knowledge bases, project planning and team collaboration.'
      },

      {
        name:'Asana',
        company:'Asana',
        domain:'asana.com',
        tier:'best',
        description:'Work-management platform for organizing projects, assigning tasks, tracking deadlines and coordinating teams.'
      },

      {
        name:'monday.com Work Management',
        company:'monday.com',
        domain:'monday.com',
        tier:'emerging',
        description:'Visual work-management platform for planning projects, automating workflows and tracking team operations.'
      },

      {
        name:'Trello',
        company:'Atlassian',
        domain:'trello.com',
        tier:'emerging',
        description:'Visual Kanban-style project tool for organizing tasks, workflows and collaborative team activities.'
      },

      {
        name:'ClickUp',
        company:'ClickUp',
        domain:'clickup.com',
        tier:'emerging',
        description:'All-in-one productivity platform combining tasks, documents, goals, dashboards and team collaboration.'
      },

      {
        name:'Dropbox Business',
        company:'Dropbox',
        domain:'dropbox.com',
        tier:'emerging',
        description:'Business cloud-storage and collaboration platform for sharing, organizing, securing and managing team files.'
      },

      {
        name:'DocuSign',
        company:'DocuSign',
        domain:'docusign.com',
        tier:'emerging',
        description:'Electronic-signature and agreement platform for securely sending, signing and managing digital documents.'
      },

      {
        name:'HubSpot CRM',
        company:'HubSpot',
        domain:'hubspot.com',
        tier:'emerging',
        description:'Customer relationship management platform for organizing sales activity, contacts, marketing and customer interactions.'
      },

      {
        name:'Salesforce Starter',
        company:'Salesforce',
        domain:'salesforce.com',
        tier:'unexpected',
        description:'Cloud CRM product designed to help growing businesses manage customers, sales activities and service workflows.'
      },

      {
        name:'Calendly',
        company:'Calendly',
        domain:'calendly.com',
        tier:'unexpected',
        description:'Automated scheduling platform that helps individuals and businesses coordinate meetings without email back-and-forth.'
      },

      {
        name:'Miro',
        company:'Miro',
        domain:'miro.com',
        tier:'unexpected',
        description:'Collaborative visual workspace used for brainstorming, planning, workshops, diagrams and remote teamwork.'
      },

      {
        name:'Airtable',
        company:'Airtable',
        domain:'airtable.com',
        tier:'unexpected',
        description:'Flexible database and workflow platform that combines spreadsheet simplicity with structured business applications.'
      },

      {
        name:'Evernote',
        company:'Evernote',
        domain:'evernote.com',
        tier:'unexpected',
        description:'Digital note-taking and information-management platform for organizing notes, documents and personal knowledge.'
      },

      {
        name:'Todoist',
        company:'Doist',
        domain:'todoist.com',
        tier:'unexpected',
        description:'Task-management application for organizing personal and team work, deadlines, projects and recurring responsibilities.'
      },

      {
        name:'Loom',
        company:'Atlassian',
        domain:'loom.com',
        tier:'unexpected',
        description:'Asynchronous video-messaging platform for recording screens, demonstrations, explanations and workplace updates.'
      },

      {
        name:'Grammarly Business',
        company:'Grammarly',
        domain:'grammarly.com',
        tier:'unexpected',
        description:'Business writing assistant that helps teams improve clarity, grammar, tone and consistency across workplace communication.'
      }
    ],


    'PDF & Document Productivity': [

      {
        name:'Adobe Acrobat Pro',
        company:'Adobe',
        domain:'adobe.com',
        tier:'best',
        description:'Professional PDF platform for creating, editing, converting, signing, protecting and organizing PDF documents.'
      },

      {
        name:'Foxit PDF Editor',
        company:'Foxit',
        domain:'foxit.com',
        tier:'best',
        description:'PDF editing platform for creating, modifying, signing, converting and securely sharing business documents.'
      },

      {
        name:'Nitro PDF Pro',
        company:'Nitro',
        domain:'gonitro.com',
        tier:'best',
        description:'Professional PDF productivity software for editing, converting, signing and collaborating on digital documents.'
      },

      {
        name:'Smallpdf Pro',
        company:'Smallpdf',
        domain:'smallpdf.com',
        tier:'best',
        description:'Web-based PDF toolkit for compressing, converting, editing, signing and managing documents.'
      },

      {
        name:'iLovePDF Premium',
        company:'iLovePDF',
        domain:'ilovepdf.com',
        tier:'best',
        description:'Online PDF productivity suite for merging, splitting, compressing, converting and editing PDF files.'
      },

      {
        name:'ABBYY FineReader PDF',
        company:'ABBYY',
        domain:'abbyy.com',
        tier:'best',
        description:'OCR and PDF software for converting scanned documents into searchable and editable digital content.'
      },

      {
        name:'Wondershare PDFelement',
        company:'Wondershare',
        domain:'wondershare.com',
        tier:'emerging',
        description:'PDF editing and document-management software offering conversion, forms, OCR, annotation and e-signature tools.'
      },

      {
        name:'PDF-XChange Editor',
        company:'Tracker Software',
        domain:'pdf-xchange.com',
        tier:'emerging',
        description:'Desktop PDF editor focused on annotation, editing, OCR, document conversion and advanced PDF workflows.'
      },

      {
        name:'Soda PDF',
        company:'LULU Software',
        domain:'sodapdf.com',
        tier:'emerging',
        description:'PDF productivity application for editing, converting, merging, signing and managing electronic documents.'
      },

      {
        name:'PDF Expert',
        company:'Readdle',
        domain:'pdfexpert.com',
        tier:'emerging',
        description:'PDF reader and editor designed for Apple devices with annotation, editing, form and signing capabilities.'
      },

      {
        name:'UPDF',
        company:'Superace',
        domain:'updf.com',
        tier:'emerging',
        description:'Cross-platform PDF editor offering annotation, document editing, conversion and AI-assisted PDF workflows.'
      },

      {
        name:'PandaDoc',
        company:'PandaDoc',
        domain:'pandadoc.com',
        tier:'emerging',
        description:'Document automation platform for creating proposals, contracts, approvals and electronic-signature workflows.'
      },

      {
        name:'Dropbox Sign',
        company:'Dropbox',
        domain:'dropbox.com',
        tier:'unexpected',
        description:'Electronic-signature service for requesting signatures and completing digital agreements securely online.'
      },

      {
        name:'signNow',
        company:'airSlate',
        domain:'signnow.com',
        tier:'unexpected',
        description:'Electronic-signature platform for preparing, sending, signing and automating document approval workflows.'
      },

      {
        name:'CamScanner',
        company:'INTSIG',
        domain:'camscanner.com',
        tier:'unexpected',
        description:'Mobile document-scanning application that converts photographed pages into digital PDF and image documents.'
      },

      {
        name:'Adobe Scan',
        company:'Adobe',
        domain:'adobe.com',
        tier:'unexpected',
        description:'Mobile scanning application that converts documents, receipts and forms into searchable digital PDFs.'
      },

      {
        name:'ScanSnap iX1600',
        company:'Ricoh',
        domain:'ricoh.com',
        tier:'unexpected',
        description:'Desktop document scanner designed to digitize paper records quickly into searchable electronic files.'
      },

      {
        name:'reMarkable Paper Pro',
        company:'reMarkable',
        domain:'remarkable.com',
        tier:'unexpected',
        description:'Digital paper tablet designed for reading, handwriting, document annotation and distraction-free knowledge work.'
      },

      {
        name:'Rocketbook Core',
        company:'Rocketbook',
        domain:'getrocketbook.com',
        tier:'unexpected',
        description:'Reusable notebook system that connects handwritten notes with cloud-based digital storage and organization.'
      },

      {
        name:'Livescribe Symphony',
        company:'Livescribe',
        domain:'livescribe.com',
        tier:'unexpected',
        description:'Smartpen system that digitizes handwritten notes and synchronizes them with compatible mobile applications.'
      }
    ],


    'Cloud Storage': [

      {
        name:'Google Drive',
        company:'Google',
        domain:'drive.google.com',
        tier:'best',
        description:'Cloud file-storage and synchronization service for storing, sharing and collaborating on files across devices.'
      },

      {
        name:'Microsoft OneDrive',
        company:'Microsoft',
        domain:'onedrive.com',
        tier:'best',
        description:'Microsoft cloud-storage service for synchronizing, backing up and sharing files across Windows and other devices.'
      },

      {
        name:'Dropbox',
        company:'Dropbox',
        domain:'dropbox.com',
        tier:'best',
        description:'Cloud storage and file-sharing platform that synchronizes documents, photos and other content across devices.'
      },

      {
        name:'iCloud+',
        company:'Apple',
        domain:'icloud.com',
        tier:'best',
        description:'Apple cloud service for synchronizing photos, files, backups and other data across Apple devices.'
      },

      {
        name:'Box',
        company:'Box',
        domain:'box.com',
        tier:'best',
        description:'Enterprise cloud-content platform for securely storing, sharing and collaborating on business files.'
      },

      {
        name:'IDrive',
        company:'IDrive',
        domain:'idrive.com',
        tier:'best',
        description:'Cloud storage and backup service designed to protect files from multiple computers and mobile devices.'
      },

      {
        name:'pCloud',
        company:'pCloud',
        domain:'pcloud.com',
        tier:'emerging',
        description:'Cloud storage platform offering file synchronization, sharing and optional encrypted private storage.'
      },

      {
        name:'Sync.com',
        company:'Sync',
        domain:'sync.com',
        tier:'emerging',
        description:'Privacy-focused cloud-storage service using encrypted file sharing and collaboration across devices.'
      },

      {
        name:'MEGA',
        company:'MEGA',
        domain:'mega.io',
        tier:'emerging',
        description:'Encrypted cloud-storage and file-sharing platform with synchronization and collaboration capabilities.'
      },

      {
        name:'Proton Drive',
        company:'Proton',
        domain:'proton.me',
        tier:'emerging',
        description:'Privacy-focused encrypted cloud-storage service from Proton for securely storing and sharing files.'
      },

      {
        name:'Internxt Drive',
        company:'Internxt',
        domain:'internxt.com',
        tier:'emerging',
        description:'Encrypted cloud-storage platform designed around privacy, secure file synchronization and protected sharing.'
      },

      {
        name:'Tresorit',
        company:'Tresorit',
        domain:'tresorit.com',
        tier:'emerging',
        description:'End-to-end encrypted cloud collaboration platform for securely storing and sharing sensitive business files.'
      },

      {
        name:'Egnyte',
        company:'Egnyte',
        domain:'egnyte.com',
        tier:'unexpected',
        description:'Enterprise content-management platform combining secure cloud file access, governance and collaboration.'
      },

      {
        name:'Zoho WorkDrive',
        company:'Zoho',
        domain:'zoho.com',
        tier:'unexpected',
        description:'Team cloud-storage platform designed for business file collaboration, organization and controlled sharing.'
      },

      {
        name:'Icedrive',
        company:'Icedrive',
        domain:'icedrive.net',
        tier:'unexpected',
        description:'Cloud-storage service offering file synchronization, sharing and encrypted storage options.'
      },

      {
        name:'Koofr',
        company:'Koofr',
        domain:'koofr.eu',
        tier:'unexpected',
        description:'Cloud-storage platform that can connect multiple online storage services into one organized interface.'
      },

      {
        name:'Filen',
        company:'Filen',
        domain:'filen.io',
        tier:'unexpected',
        description:'End-to-end encrypted cloud-storage service focused on private file synchronization and sharing.'
      },

      {
        name:'Synology BeeStation',
        company:'Synology',
        domain:'synology.com',
        tier:'unexpected',
        description:'Personal cloud-storage appliance designed to keep files locally while making them accessible across devices.'
      },

      {
        name:'QNAP myQNAPcloud',
        company:'QNAP',
        domain:'qnap.com',
        tier:'unexpected',
        description:'Private-cloud ecosystem that connects QNAP network storage with secure remote file access and sharing.'
      },

      {
        name:'Western Digital My Cloud',
        company:'Western Digital',
        domain:'westerndigital.com',
        tier:'unexpected',
        description:'Personal network-storage concept designed to centralize files and provide private-cloud-style access.'
      }
    ],


    'Photo & Creative Software': [

      {
        name:'Adobe Photoshop',
        company:'Adobe',
        domain:'adobe.com',
        tier:'best',
        description:'Professional image-editing software for photography, graphic design, digital compositing and creative production.'
      },

      {
        name:'Adobe Lightroom',
        company:'Adobe',
        domain:'adobe.com',
        tier:'best',
        description:'Photography application for organizing, editing, enhancing and synchronizing photo libraries across devices.'
      },

      {
        name:'Canva Pro',
        company:'Canva',
        domain:'canva.com',
        tier:'best',
        description:'Visual-design platform for creating social graphics, presentations, videos, marketing materials and branded content.'
      },

      {
        name:'Affinity Photo',
        company:'Canva',
        domain:'affinity.serif.com',
        tier:'best',
        description:'Professional photo-editing application for retouching, compositing, RAW processing and digital artwork.'
      },

      {
        name:'Capture One Pro',
        company:'Capture One',
        domain:'captureone.com',
        tier:'best',
        description:'Professional photography workflow software for RAW processing, image organization, color editing and tethered capture.'
      },

      {
        name:'DaVinci Resolve Studio',
        company:'Blackmagic Design',
        domain:'blackmagicdesign.com',
        tier:'best',
        description:'Professional video-production suite combining editing, color correction, visual effects, motion graphics and audio.'
      },

      {
        name:'Final Cut Pro',
        company:'Apple',
        domain:'apple.com',
        tier:'emerging',
        description:'Professional video-editing software for Mac used for editing, organizing and producing high-quality video content.'
      },

      {
        name:'CapCut Pro',
        company:'CapCut',
        domain:'capcut.com',
        tier:'emerging',
        description:'Video-editing platform providing templates, effects, captions and AI-assisted tools for social and creator content.'
      },

      {
        name:'Luminar Neo',
        company:'Skylum',
        domain:'skylum.com',
        tier:'emerging',
        description:'AI-assisted photo editor designed for automated image enhancement, creative effects and photography workflows.'
      },

      {
        name:'Picsart Gold',
        company:'Picsart',
        domain:'picsart.com',
        tier:'emerging',
        description:'Creative editing platform for photos, graphics, video and social-media content across mobile and web devices.'
      },

      {
        name:'Adobe Express Premium',
        company:'Adobe',
        domain:'adobe.com',
        tier:'emerging',
        description:'Browser and mobile design application for quickly creating social posts, videos, graphics and marketing content.'
      },

      {
        name:'Corel PaintShop Pro',
        company:'Alludo',
        domain:'paintshoppro.com',
        tier:'emerging',
        description:'Windows photo-editing and graphic-design software offering image correction, compositing and creative tools.'
      },

      {
        name:'ON1 Photo RAW',
        company:'ON1',
        domain:'on1.com',
        tier:'unexpected',
        description:'Photography workflow application combining RAW processing, organization, effects and AI-powered image enhancement.'
      },

      {
        name:'DxO PhotoLab',
        company:'DxO',
        domain:'dxo.com',
        tier:'unexpected',
        description:'Professional RAW photo-processing software known for optical correction, noise reduction and image-quality enhancement.'
      },

      {
        name:'CyberLink PhotoDirector',
        company:'CyberLink',
        domain:'cyberlink.com',
        tier:'unexpected',
        description:'Photo-editing software combining traditional image tools with AI effects, retouching and creative generation features.'
      },

      {
        name:'Descript',
        company:'Descript',
        domain:'descript.com',
        tier:'unexpected',
        description:'Audio and video editing platform that lets creators edit recordings using text-based transcription workflows.'
      },

      {
        name:'Figma Professional',
        company:'Figma',
        domain:'figma.com',
        tier:'unexpected',
        description:'Collaborative design platform for interface design, prototypes, visual systems and digital product development.'
      },

      {
        name:'Procreate',
        company:'Savage Interactive',
        domain:'procreate.com',
        tier:'unexpected',
        description:'Digital illustration and painting application for iPad used by artists, designers and creative professionals.'
      },

      {
        name:'Loupedeck Live',
        company:'Logitech',
        domain:'loupedeck.com',
        tier:'unexpected',
        description:'Physical creative-control console designed to speed up editing workflows in photo, video and streaming applications.'
      },

      {
        name:'Aura Digital Frame',
        company:'Aura',
        domain:'auraframes.com',
        tier:'unexpected',
        description:'Connected digital photo frame that lets users display and remotely share personal photo collections.'
      }
    ],


    'Backup & Recovery': [

      {
        name:'Backblaze Computer Backup',
        company:'Backblaze',
        domain:'backblaze.com',
        tier:'best',
        description:'Automatic cloud-backup service designed to continuously protect computer files with minimal user configuration.'
      },

      {
        name:'IDrive Personal',
        company:'IDrive',
        domain:'idrive.com',
        tier:'best',
        description:'Multi-device cloud-backup service for protecting computers, phones and important files under one account.'
      },

      {
        name:'Acronis Cyber Protect Home Office',
        company:'Acronis',
        domain:'acronis.com',
        tier:'best',
        description:'Backup and cybersecurity suite combining full-system backup, ransomware protection and disaster recovery capabilities.'
      },

      {
        name:'Carbonite Safe',
        company:'Carbonite',
        domain:'carbonite.com',
        tier:'best',
        description:'Cloud-backup service focused on automatically protecting personal and small-business computer files.'
      },

      {
        name:'CrashPlan',
        company:'CrashPlan',
        domain:'crashplan.com',
        tier:'best',
        description:'Continuous cloud-backup platform designed for protecting business endpoint data and recovering lost files.'
      },

      {
        name:'Dropbox Backup',
        company:'Dropbox',
        domain:'dropbox.com',
        tier:'best',
        description:'Cloud backup capability for protecting important computer folders and restoring files after device loss or failure.'
      },

      {
        name:'EaseUS Todo Backup',
        company:'EaseUS',
        domain:'easeus.com',
        tier:'emerging',
        description:'Backup software for protecting files, disks and complete computer systems with scheduled recovery options.'
      },

      {
        name:'AOMEI Backupper',
        company:'AOMEI',
        domain:'aomeitech.com',
        tier:'emerging',
        description:'Windows backup and cloning software for file backup, system imaging, disk migration and disaster recovery.'
      },

      {
        name:'Macrium Reflect',
        company:'Macrium',
        domain:'macrium.com',
        tier:'emerging',
        description:'Disk imaging and backup software designed for reliable system recovery, cloning and data protection.'
      },

      {
        name:'Paragon Backup & Recovery',
        company:'Paragon Software',
        domain:'paragon-software.com',
        tier:'emerging',
        description:'Backup and recovery software for protecting files, partitions and complete Windows systems.'
      },

      {
        name:'Veeam Data Cloud',
        company:'Veeam',
        domain:'veeam.com',
        tier:'emerging',
        description:'Cloud-based backup and recovery platform for protecting business workloads, applications and organizational data.'
      },

      {
        name:'Stellar Data Recovery',
        company:'Stellar',
        domain:'stellarinfo.com',
        tier:'emerging',
        description:'Data-recovery software designed to restore deleted, corrupted or inaccessible files from storage devices.'
      },

      {
        name:'Disk Drill',
        company:'CleverFiles',
        domain:'cleverfiles.com',
        tier:'unexpected',
        description:'File-recovery application for restoring deleted or lost data from computers, drives and removable storage.'
      },

      {
        name:'Synology Active Backup',
        company:'Synology',
        domain:'synology.com',
        tier:'unexpected',
        description:'Centralized backup solution for protecting PCs, servers, virtual machines and business data on Synology NAS.'
      },

      {
        name:'QNAP Hybrid Backup Sync',
        company:'QNAP',
        domain:'qnap.com',
        tier:'unexpected',
        description:'NAS backup and synchronization application for copying data between local storage, remote servers and cloud services.'
      },

      {
        name:'Samsung T9 Portable SSD',
        company:'Samsung',
        domain:'samsung.com',
        tier:'unexpected',
        description:'High-speed portable solid-state drive suitable for local backups, large media files and mobile work.'
      },

      {
        name:'SanDisk Extreme Portable SSD',
        company:'SanDisk',
        domain:'sandisk.com',
        tier:'unexpected',
        description:'Portable solid-state storage device designed for fast file transfer, local backup and mobile content workflows.'
      },

      {
        name:'WD My Passport',
        company:'Western Digital',
        domain:'westerndigital.com',
        tier:'unexpected',
        description:'Portable external hard drive commonly used for offline file storage, computer backups and archival copies.'
      },

      {
        name:'ioSafe Solo G3',
        company:'ioSafe',
        domain:'iosafe.com',
        tier:'unexpected',
        description:'Fire-resistant and water-resistant external storage device designed to protect physical backup copies during disasters.'
      },

      {
        name:'Synology BeeDrive',
        company:'Synology',
        domain:'synology.com',
        tier:'unexpected',
        description:'Compact personal backup device designed to simplify computer and mobile file protection and synchronization.'
      }
    ]
  };


  const previousCatalogV5 =
    catalogForOpportunityV1;


  catalogForOpportunityV1 =
    function(title) {

      const catalog =
        BRANDED_MARKETPLACE_V5[title];

      if (catalog) {

        return catalog.map(item => [
          item.name,
          item.tier
        ]);
      }

      return previousCatalogV5(title);
    };


  const previousBrandLookupV5 =
    productBrandV2;


  productBrandV2 =
    function(name) {

      for (
        const catalog
        of Object.values(
          BRANDED_MARKETPLACE_V5
        )
      ) {

        const item =
          catalog.find(
            p => p.name === name
          );

        if (item) {

          return {
            domain: item.domain,
            label: item.company,
            company: item.company
          };
        }
      }

      return previousBrandLookupV5(name);
    };


  const previousDescriptionV5 =
    productDescriptionV4;


  productDescriptionV4 =
    function(name) {

      for (
        const catalog
        of Object.values(
          BRANDED_MARKETPLACE_V5
        )
      ) {

        const item =
          catalog.find(
            p => p.name === name
          );

        if (item) {
          return item.description;
        }
      }

      return previousDescriptionV5(name);
    };


  const previousCompanyNameV5 =
    companyNameV3;


  companyNameV3 =
    function(name) {

      for (
        const catalog
        of Object.values(
          BRANDED_MARKETPLACE_V5
        )
      ) {

        const item =
          catalog.find(
            p => p.name === name
          );

        if (item) {
          return item.company;
        }
      }

      return previousCompanyNameV5(name);
    };



  // AIRGESTURE_SCENARIO_PRODUCTS_V1

  function selectedAudienceScenarioV1() {
    const el = $('segmentFilter');

    if (!el || !el.value) {
      return 'All audiences';
    }

    const option =
      el.options[
        el.selectedIndex
      ];

    return (
      option?.textContent?.trim()
      || el.value
    );
  }


  function selectedMarketScenarioV1() {
    const el = $('locationFilter');

    if (!el || !el.value) {
      return 'All markets';
    }

    const option =
      el.options[
        el.selectedIndex
      ];

    if (!option) return el.value;

    return option.textContent
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();
  }


  function scenarioSeedV1(text) {
    let h = 2166136261;

    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return Math.abs(h >>> 0);
  }


  function scenarioKeywordsV1(
    audience,
    category
  ) {

    const a =
      audience.toLowerCase();

    const map = [];


    if (a.includes('windows')) {
      map.push(
        'microsoft',
        'security',
        'backup',
        'pdf',
        'document',
        'business',
        'endpoint',
        'drive'
      );
    }


    if (
      a.includes('apple desktop')
      || a.includes('mac')
    ) {
      map.push(
        'adobe',
        'creative',
        'photo',
        'icloud',
        'dropbox',
        'pdf',
        'design',
        'backup'
      );
    }


    if (
      a.includes('apple mobile')
      || a.includes('iphone')
    ) {
      map.push(
        'icloud',
        'photo',
        'creative',
        'mobile',
        'video',
        'storage',
        'password',
        'vpn'
      );
    }


    if (a.includes('android')) {
      map.push(
        'google',
        'drive',
        'photo',
        'mobile',
        'backup',
        'security',
        'vpn',
        'password'
      );
    }


    if (a.includes('linux')) {
      map.push(
        'cloud',
        'security',
        'vpn',
        'backup',
        'encrypted',
        'password',
        'zero trust'
      );
    }


    if (a.includes('tablet')) {
      map.push(
        'document',
        'pdf',
        'photo',
        'creative',
        'cloud',
        'note',
        'sign'
      );
    }


    const c =
      String(category || '')
      .toLowerCase();


    if (c.includes('security')) {
      map.push(
        'security',
        'vpn',
        'password',
        'identity',
        'defender',
        'protection'
      );
    }


    if (c.includes('cloud')) {
      map.push(
        'drive',
        'cloud',
        'storage',
        'dropbox',
        'onedrive',
        'icloud'
      );
    }


    if (c.includes('photo')) {
      map.push(
        'photo',
        'adobe',
        'creative',
        'video',
        'design',
        'canva'
      );
    }


    if (c.includes('pdf')) {
      map.push(
        'pdf',
        'acrobat',
        'document',
        'scan',
        'sign'
      );
    }


    if (c.includes('backup')) {
      map.push(
        'backup',
        'recovery',
        'drive',
        'storage',
        'ssd'
      );
    }


    if (c.includes('business')) {
      map.push(
        'microsoft',
        'google',
        'workspace',
        'slack',
        'project',
        'crm'
      );
    }


    return [...new Set(map)];
  }



  // =======================================================
  // AIRGESTURE_PLATFORM_PRODUCT_COMPATIBILITY_V2
  //
  // PRODUCT RANKING PRIORITY:
  //
  // 1. PLATFORM COMPATIBILITY
  // 2. CATEGORY / PRODUCT FIT
  // 3. OBSERVED AIRGESTURE SIGNAL
  // 4. GEOGRAPHY AS SMALL TIE-BREAKER ONLY
  //
  // Geography must never make an incompatible platform
  // product become a top recommendation.
  // =======================================================


  function normalizedAudiencePlatformV2(
    audience
  ) {

    const value =
      String(audience || '')
        .toLowerCase()
        .trim();


    if (
      value.includes('windows')
    ) {
      return 'windows';
    }


    if (
      value.includes('apple desktop')
      ||
      value.includes('mac')
    ) {
      return 'mac';
    }


    if (
      value.includes('apple mobile')
      ||
      value.includes('iphone')
      ||
      value.includes('ipad')
    ) {
      return 'ios';
    }


    if (
      value.includes('android')
    ) {
      return 'android';
    }


    if (
      value.includes('linux')
    ) {
      return 'linux';
    }


    if (
      value.includes('tablet')
    ) {
      return 'tablet';
    }


    if (
      value.includes('general desktop')
    ) {
      return 'desktop';
    }


    return 'all';
  }


  function productIdentityTextV2(
    productName
  ) {

    const name =
      String(productName || '');

    let company = '';
    let description = '';


    try {
      company =
        String(
          companyNameV3(name) || ''
        );
    } catch {}


    try {
      description =
        String(
          productDescriptionV4(name) || ''
        );
    } catch {}


    return (
      `${name} ${company} ${description}`
    )
      .toLowerCase();
  }


  /*
    Hard incompatibility means:
    do not recommend this product for that selected platform.

    We intentionally keep this conservative.
    Cross-platform products remain eligible.
  */

  function productHardIncompatibleV2(
    productName,
    platform
  ) {

    if (
      !platform ||
      platform === 'all' ||
      platform === 'tablet' ||
      platform === 'desktop'
    ) {
      return false;
    }


    const text =
      productIdentityTextV2(
        productName
      );


    const isAppleExclusive =
      (
        text.includes('final cut pro')
        ||
        text.includes('procreate')
        ||
        text.includes('pdf expert')
        ||
        text.includes('icloud+')
        ||
        text.includes('icloud ')
        ||
        text.includes('apple cloud service')
      );


    const isWindowsExclusive =
      (
        text.includes('macrium reflect')
        ||
        text.includes('pdf-xchange editor')
        ||
        text.includes('paintshop pro')
      );


    /*
      Android should never be presented with
      Apple ecosystem-only products.
    */

    if (
      platform === 'android' &&
      isAppleExclusive
    ) {
      return true;
    }


    /*
      Linux should not receive products that are clearly
      tied to Apple-only or Windows-only desktop software.
    */

    if (
      platform === 'linux' &&
      (
        isAppleExclusive ||
        isWindowsExclusive
      )
    ) {
      return true;
    }


    /*
      iPhone/iPad should not receive Windows-only
      desktop applications as product recommendations.
    */

    if (
      platform === 'ios' &&
      isWindowsExclusive
    ) {
      return true;
    }


    /*
      macOS should not receive clearly Windows-only tools.
    */

    if (
      platform === 'mac' &&
      isWindowsExclusive
    ) {
      return true;
    }


    /*
      Windows should not receive products that require
      Apple's native ecosystem.
    */

    if (
      platform === 'windows' &&
      (
        text.includes('final cut pro')
        ||
        text.includes('procreate')
        ||
        text.includes('pdf expert')
      )
    ) {
      return true;
    }


    return false;
  }


  /*
    Strong positive compatibility.

    This does NOT claim purchasing intent.
    It simply prevents obviously mismatched platform
    suggestions and prioritizes products that technically
    fit the selected device ecosystem.
  */

  function productPlatformCompatibilityV2(
    productName,
    platform
  ) {

    if (
      platform === 'all'
    ) {
      return 0;
    }


    const text =
      productIdentityTextV2(
        productName
      );


    let score = 0;


    // -----------------------------------------------------
    // WINDOWS
    // -----------------------------------------------------

    if (
      platform === 'windows'
    ) {

      if (
        /microsoft|windows|onedrive|office|365|defender|edge/.test(
          text
        )
      ) {
        score += 90;
      }


      if (
        /adobe|dropbox|google|box|idrive|backblaze|acronis|norton|bitdefender|malwarebytes|avast|eset|foxit|nitro|canva|zoom|slack/.test(
          text
        )
      ) {
        score += 45;
      }


      if (
        /mac|iphone|ipad|apple-only|ios-only/.test(
          text
        )
      ) {
        score -= 35;
      }
    }


    // -----------------------------------------------------
    // macOS / APPLE DESKTOP
    // -----------------------------------------------------

    if (
      platform === 'mac'
    ) {

      if (
        /apple|icloud|mac|final cut|affinity|capture one|adobe|lightroom|photoshop/.test(
          text
        )
      ) {
        score += 90;
      }


      if (
        /dropbox|google drive|box|idrive|backblaze|proton|canva|zoom|slack|notion/.test(
          text
        )
      ) {
        score += 45;
      }


      if (
        /windows-only|pc-only/.test(
          text
        )
      ) {
        score -= 70;
      }
    }


    // -----------------------------------------------------
    // iOS / APPLE MOBILE
    // -----------------------------------------------------

    if (
      platform === 'ios'
    ) {

      if (
        /apple|icloud|iphone|ipad|ios|procreate|pdf expert|adobe scan|camscanner|lightroom|photoshop|canva/.test(
          text
        )
      ) {
        score += 100;
      }


      if (
        /google drive|dropbox|onedrive|box|idrive|proton|nordvpn|1password|bitwarden|malwarebytes/.test(
          text
        )
      ) {
        score += 50;
      }
    }


    // -----------------------------------------------------
    // ANDROID
    // -----------------------------------------------------

    if (
      platform === 'android'
    ) {

      if (
        /google|android|drive|photos|workspace|chrome/.test(
          text
        )
      ) {
        score += 110;
      }


      if (
        /onedrive|dropbox|box|idrive|proton|mega|sync\.com|canva|adobe|camscanner|nordvpn|bitwarden|1password|malwarebytes|avast|bitdefender|eset/.test(
          text
        )
      ) {
        score += 55;
      }


      if (
        /apple|icloud|iphone|ipad|final cut|procreate|pdf expert/.test(
          text
        )
      ) {
        score -= 150;
      }
    }


    // -----------------------------------------------------
    // LINUX
    // -----------------------------------------------------

    if (
      platform === 'linux'
    ) {

      if (
        /linux|proton|bitwarden|cloudflare|zero trust|vpn|encrypted|mega|sync\.com|tresorit|filen|dropbox|google drive/.test(
          text
        )
      ) {
        score += 90;
      }


      if (
        /apple|icloud|final cut|procreate|windows-only/.test(
          text
        )
      ) {
        score -= 120;
      }
    }


    // -----------------------------------------------------
    // GENERIC TABLET
    // -----------------------------------------------------

    if (
      platform === 'tablet'
    ) {

      if (
        /mobile|tablet|document|pdf|scan|note|photo|creative|cloud|drive|dropbox|canva|adobe/.test(
          text
        )
      ) {
        score += 65;
      }
    }


    // -----------------------------------------------------
    // GENERAL DESKTOP
    // -----------------------------------------------------

    if (
      platform === 'desktop'
    ) {

      if (
        /desktop|business|productivity|cloud|backup|security|pdf|document|adobe|microsoft|google|dropbox/.test(
          text
        )
      ) {
        score += 45;
      }
    }


    return score;
  }


  /*
    Category-specific compatibility can further improve
    recommendations without inventing demographic data.
  */

  function categoryPlatformBonusV2(
    productName,
    category,
    platform
  ) {

    const text =
      productIdentityTextV2(
        productName
      );

    const c =
      String(category || '')
        .toLowerCase();


    let score = 0;


    if (
      c.includes('cloud')
    ) {

      if (
        platform === 'android' &&
        /google drive|google|dropbox|onedrive|idrive|box|proton drive|mega|sync\.com/.test(
          text
        )
      ) {
        score += 70;
      }


      if (
        platform === 'ios' &&
        /icloud|apple|dropbox|google drive|onedrive|idrive|box/.test(
          text
        )
      ) {
        score += 70;
      }


      if (
        platform === 'windows' &&
        /onedrive|microsoft|google drive|dropbox|idrive|box/.test(
          text
        )
      ) {
        score += 70;
      }


      if (
        platform === 'mac' &&
        /icloud|dropbox|google drive|idrive|box|proton drive/.test(
          text
        )
      ) {
        score += 70;
      }
    }


    if (
      c.includes('security')
    ) {

      if (
        /bitdefender|malwarebytes|avast|eset|norton|mcafee|proton vpn|nordvpn|1password|bitwarden/.test(
          text
        )
      ) {
        score += 35;
      }


      if (
        platform === 'windows' &&
        /microsoft defender/.test(
          text
        )
      ) {
        score += 80;
      }
    }


    if (
      c.includes('business')
    ) {

      if (
        platform === 'windows' &&
        /microsoft 365|onedrive|teams|office/.test(
          text
        )
      ) {
        score += 65;
      }


      if (
        platform === 'android' &&
        /google workspace|google|notion|slack|zoom|trello|asana|monday|clickup/.test(
          text
        )
      ) {
        score += 55;
      }


      if (
        platform === 'mac' ||
        platform === 'ios'
      ) {

        if (
          /notion|slack|zoom|google workspace|microsoft 365|dropbox|canva/.test(
            text
          )
        ) {
          score += 45;
        }
      }
    }


    if (
      c.includes('pdf')
    ) {

      if (
        platform === 'ios' &&
        /pdf expert|adobe acrobat|adobe scan|camscanner|pdfelement/.test(
          text
        )
      ) {
        score += 70;
      }


      if (
        platform === 'android' &&
        /adobe acrobat|adobe scan|camscanner|pdfelement|smallpdf|ilovepdf/.test(
          text
        )
      ) {
        score += 65;
      }


      if (
        platform === 'windows' &&
        /adobe acrobat|foxit|nitro|pdf-xchange|pdfelement/.test(
          text
        )
      ) {
        score += 65;
      }
    }


    if (
      c.includes('photo')
    ) {

      if (
        platform === 'ios' &&
        /lightroom|photoshop|canva|procreate|adobe express|picsart/.test(
          text
        )
      ) {
        score += 70;
      }


      if (
        platform === 'android' &&
        /lightroom|photoshop|canva|adobe express|picsart|capcut/.test(
          text
        )
      ) {
        score += 65;
      }


      if (
        platform === 'mac' &&
        /final cut|photoshop|lightroom|capture one|affinity|davinci/.test(
          text
        )
      ) {
        score += 70;
      }
    }


    if (
      c.includes('backup')
    ) {

      if (
        /backblaze|idrive|acronis|dropbox backup|carbonite|crashplan|synology/.test(
          text
        )
      ) {
        score += 45;
      }


      if (
        platform === 'windows' &&
        /macrium|easeus|aomei/.test(
          text
        )
      ) {
        score += 55;
      }
    }


    return score;
  }


  /*
    Geography only resolves close calls among products
    that already fit the selected platform.

    It must NEVER overpower platform compatibility.
  */

  function geoTieBreakV2(
    market,
    audience,
    productName
  ) {

    if (
      !market ||
      market === 'All markets'
    ) {
      return 0;
    }


    return (
      scenarioSeedV1(
        `${market}|${audience}|${productName}`
      ) % 7
    );
  }


  function scenarioProductScoreV1(
    product,
    index,
    category
  ) {

    const audience =
      selectedAudienceScenarioV1();

    const market =
      selectedMarketScenarioV1();


    const name =
      String(product[0] || '');

    const tier =
      String(product[1] || '');


    const platform =
      normalizedAudiencePlatformV2(
        audience
      );


    /*
      PLATFORM FIT dominates everything.
    */

    let score =
      productPlatformCompatibilityV2(
        name,
        platform
      );


    /*
      Existing catalog tier remains meaningful,
      but it can no longer override incompatibility.
    */

    score +=
      tier === 'best'
        ? 55
        : tier === 'emerging'
          ? 32
          : 18;


    /*
      Product/category relevance.
    */

    score +=
      categoryPlatformBonusV2(
        name,
        category,
        platform
      );


    /*
      Existing scenario keywords still contribute,
      but at a smaller weight.
    */

    const keywords =
      scenarioKeywordsV1(
        audience,
        category
      );


    const lower =
      name.toLowerCase();


    for (
      const keyword
      of keywords
    ) {

      if (
        lower.includes(
          keyword.toLowerCase()
        )
      ) {
        score += 6;
      }
    }


    /*
      Geography is intentionally tiny.
    */

    score +=
      geoTieBreakV2(
        market,
        audience,
        name
      );


    /*
      Stable ordering only.
    */

    score +=
      Math.max(
        0,
        3 - (index % 4)
      );


    return score;
  }

  const previousCatalogScenarioV1 =
    catalogForOpportunityV1;


  catalogForOpportunityV1 =
    function(category) {

      const base =
        previousCatalogScenarioV1(
          category
        );


      if (!Array.isArray(base)) {
        return base;
      }


      const audience =
        selectedAudienceScenarioV1();

      const platform =
        normalizedAudiencePlatformV2(
          audience
        );


      return base

        /*
          Remove only clearly incompatible products.
          Cross-platform products remain available.
        */
        .filter(
          product =>
            !productHardIncompatibleV2(
              product?.[0],
              platform
            )
        )

        .map(
          (product,index) => ({
            product,
            score:
              scenarioProductScoreV1(
                product,
                index,
                category
              )
          })
        )

        .sort(
          (a,b) =>
            b.score - a.score
        )

        .map(
          item => item.product
        );
    };


  function updateCommercialScenarioV1() {

    const title =
      $('commercialScenarioTitleV1');

    const text =
      $('commercialScenarioTextV1');


    if (!title || !text) return;


    const audience =
      selectedAudienceScenarioV1();

    const market =
      selectedMarketScenarioV1();


    title.textContent =
      `${audience} · ${market}`;


    if (
      audience === 'All audiences'
      && market === 'All markets'
    ) {

      text.textContent =
        'Select an Audience and Market above. Product opportunities will automatically reorganize around that specific scenario.';

      return;
    }


    if (
      audience !== 'All audiences'
      && market !== 'All markets'
    ) {

      text.textContent =
        `Showing a different product priority for ${audience} activity observed in ${market}. This is a testable business hypothesis, not a prediction that users will purchase.`;

      return;
    }


    if (
      audience !== 'All audiences'
    ) {

      text.textContent =
        `Products are prioritized for the selected ${audience} technology segment. Choose a Market to make the scenario more specific.`;

      return;
    }


    text.textContent =
      `Products are reorganized for the selected ${market} market scenario. Choose an Audience to make the recommendation more specific.`;
  }


  function refreshMarketplaceScenarioV1() {

    updateCommercialScenarioV1();


    /*
      If marketplace is open, redraw it using
      the newly selected scenario.
    */

    if (
      typeof renderProductExplorerGridV1
      === 'function'
      && productExplorerCategoryV1
    ) {

      try {
        renderProductExplorerGridV1();
      }
      catch (e) {
        console.warn(
          'Scenario marketplace refresh skipped:',
          e
        );
      }
    }
  }


  document.addEventListener(
    'change',
    event => {

      if (
        event.target?.id
          === 'segmentFilter'
        ||
        event.target?.id
          === 'locationFilter'
      ) {

        setTimeout(
          refreshMarketplaceScenarioV1,
          80
        );
      }
    }
  );


  /*
    Also refresh when dashboard itself rerenders.
  */

  const previousRenderAllScenarioV1 =
    renderAll;


  renderAll =
    function(snapshot) {

      previousRenderAllScenarioV1(
        snapshot
      );

      updateCommercialScenarioV1();
    };


  updateCommercialScenarioV1();



  // AIRGESTURE_REALTIME_OPPORTUNITY_V1

  window.airgestureRealtimeOpportunityV1 =
    null;

  let realtimeOpportunityTimerV1 =
    null;

  let realtimeOpportunityRequestV1 =
    0;


  function ensureRealtimeOpportunityPanelV1() {

    let panel =
      $('realtimeOpportunityV1');

    if (panel) {
      return panel;
    }

    const scenario =
      $('commercialScenarioV1');

    if (!scenario) {
      return null;
    }

    panel =
      document.createElement(
        'div'
      );

    panel.id =
      'realtimeOpportunityV1';

    panel.className =
      'realtime-opportunity-v1';

    panel.innerHTML = `

      <div class="realtime-opportunity-head-v1">

        <div>

          <span class="section-kicker">
            REAL-TIME PRODUCT OPPORTUNITY
          </span>

          <h3>
            Live market signal
          </h3>

          <p>
            Waiting for the latest AirGesture records…
          </p>

        </div>

        <span
          class="realtime-live-badge-v1">
          LIVE
        </span>

      </div>

      <div
        id="realtimeOpportunityBodyV1"
        class="realtime-opportunity-body-v1">

        <div class="realtime-loading-v1">
          Calculating recent market momentum…
        </div>

      </div>

    `;

    scenario.insertAdjacentElement(
      'afterend',
      panel
    );

    return panel;
  }


  function realtimeScopeLabelV1(
    data
  ) {

    const location =
      data?.scope?.location ||
      'All markets';

    let segment =
      data?.scope?.segment ||
      'All audiences';

    try {
      if (
        data?.scope?.segment &&
        typeof prettySegment ===
          'function'
      ) {
        segment =
          prettySegment(
            data.scope.segment
          );
      }
    } catch {}

    return `${segment} · ${location}`;
  }


  function growthDisplayV1(
    growth
  ) {

    if (!growth) {
      return '—';
    }

    return (
      growth.label ||
      (
        Number.isFinite(
          growth.percent
        )
          ? `${growth.percent}%`
          : '—'
      )
    );
  }


  function renderRealtimeOpportunityV1(
    data
  ) {

    ensureRealtimeOpportunityPanelV1();

    const body =
      $('realtimeOpportunityBodyV1');

    if (!body) {
      return;
    }

    const categories =
      Array.isArray(
        data?.categoryScores
      )
        ? data.categoryScores
            .slice(0, 3)
        : [];

    const emerging =
      Array.isArray(
        data?.emergingMarkets
      )
        ? data.emergingMarkets
            .slice(0, 3)
        : [];


    body.innerHTML = `

      <div class="realtime-scope-v1">

        <div>
          <span>CURRENT SCENARIO</span>

          <strong>
            ${escapeHtml(
              realtimeScopeLabelV1(
                data
              )
            )}
          </strong>
        </div>

        <div>
          <span>CONFIDENCE</span>

          <strong>
            ${escapeHtml(
              data?.confidence ||
              'EXPLORE'
            )}
          </strong>
        </div>

      </div>


      <div class="realtime-metrics-v1">

        <article>
          <span>LAST 7 DAYS</span>

          <strong>
            ${formatNumber(
              data?.recentEvents ||
              0
            )}
          </strong>

          <small>
            observed events
          </small>
        </article>


        <article>
          <span>RECENT USERS</span>

          <strong>
            ${formatNumber(
              data?.recentUsers ||
              0
            )}
          </strong>

          <small>
            unique users
          </small>
        </article>


        <article>
          <span>MOMENTUM</span>

          <strong>
            ${escapeHtml(
              growthDisplayV1(
                data?.growth
              )
            )}
          </strong>

          <small>
            vs previous 7 days
          </small>
        </article>


        <article>
          <span>USAGE INTENSITY</span>

          <strong>
            ${escapeHtml(
              String(
                data?.eventsPerUser ||
                0
              )
            )}
          </strong>

          <small>
            events per user
          </small>
        </article>

      </div>


      <div class="realtime-explanation-v1">

        <div>

          <span>WHAT CHANGED</span>

          <strong>
            ${
              data?.leadingContent
                ? `${escapeHtml(
                    data.leadingContent
                  )} is the leading recent content signal.`
                : 'More data is needed to identify a recent content signal.'
            }
          </strong>

        </div>

        <div>

          <span>WHAT IT MEANS</span>

          <strong>
            Product priorities below are recalculated from recent activity, audience mix and content behavior.
          </strong>

        </div>

      </div>


      <div class="realtime-category-v1">

        <div class="realtime-subhead-v1">

          <div>
            <span>PRODUCT CATEGORIES TO TEST NOW</span>

            <small>
              Live hypothesis ranking
            </small>
          </div>

        </div>


        <div class="realtime-category-grid-v1">

          ${
            categories.length

              ? categories.map(
                  (item, index) => `

                    <article>

                      <span>
                        ${String(
                          index + 1
                        ).padStart(
                          2,
                          '0'
                        )}
                      </span>

                      <div>

                        <strong>
                          ${escapeHtml(
                            item.title
                          )}
                        </strong>

                        <small>
                          Opportunity score
                          ${escapeHtml(
                            String(
                              item.score
                            )
                          )}/100
                        </small>

                      </div>

                    </article>

                  `
                ).join('')

              : `
                  <p class="plain-note">
                    More recent records are needed for a confident product ranking.
                  </p>
                `
          }

        </div>

      </div>


      <div class="realtime-emerging-v1">

        <div class="realtime-subhead-v1">

          <div>
            <span>EMERGING MARKETS</span>

            <small>
              Recent momentum can surface smaller markets
            </small>
          </div>

        </div>


        <div class="realtime-emerging-grid-v1">

          ${
            emerging.length

              ? emerging.map(
                  market => `

                    <article>

                      <div>

                        <strong>
                          ${escapeHtml(
                            market.location
                          )}
                        </strong>

                        <small>
                          ${formatNumber(
                            market.recentUsers
                          )} recent users ·
                          ${formatNumber(
                            market.recentEvents
                          )} events
                        </small>

                      </div>

                      <span>
                        ${escapeHtml(
                          growthDisplayV1(
                            market.growth
                          )
                        )}
                      </span>

                    </article>

                  `
                ).join('')

              : `
                  <p class="plain-note">
                    No market currently has enough recent activity to qualify as emerging.
                  </p>
                `
          }

        </div>

      </div>


      <p class="realtime-disclaimer-v1">

        This is an AirGesture observed-demand signal.
        It reflects activity inside this dataset and is
        a business-test hypothesis—not proof of external
        consumer purchase demand.

      </p>

    `;
  }


  async function loadRealtimeOpportunityV1() {

    const requestId =
      ++realtimeOpportunityRequestV1;

    const params =
      new URLSearchParams();

    const market =
      $('locationFilter')
        ?.value || '';

    const segment =
      $('segmentFilter')
        ?.value || '';

    if (market) {
      params.set(
        'location',
        market
      );
    }

    if (segment) {
      params.set(
        'segment',
        segment
      );
    }

    try {

      const response =
        await fetch(
          `/api/intelligence/opportunity?${params.toString()}`,
          {
            credentials:
              'same-origin',
            cache:
              'no-store'
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      if (
        requestId !==
        realtimeOpportunityRequestV1
      ) {
        return;
      }

      window
        .airgestureRealtimeOpportunityV1 =
        data;

      renderRealtimeOpportunityV1(
        data
      );


      /*
        If the Product Opportunity Marketplace
        is currently open, redraw it using the
        latest backend signal.
      */

      if (
        typeof renderProductExplorerGridV1
          === 'function' &&
        typeof productExplorerCategoryV1
          !== 'undefined' &&
        productExplorerCategoryV1
      ) {

        try {
          renderProductExplorerGridV1();
        } catch {}
      }

    } catch (error) {

      console.warn(
        'Real-time opportunity refresh failed:',
        error
      );

      const body =
        $('realtimeOpportunityBodyV1');

      if (body) {

        body.innerHTML = `
          <p class="plain-note">
            Real-time opportunity data is temporarily unavailable.
            The existing dashboard remains available.
          </p>
        `;
      }
    }
  }


  function scheduleRealtimeOpportunityV1() {

    clearInterval(
      realtimeOpportunityTimerV1
    );

    realtimeOpportunityTimerV1 =
      setInterval(
        loadRealtimeOpportunityV1,
        20000
      );
  }


  /*
    Add the backend opportunity score to the
    existing product ordering without replacing
    the existing marketplace logic.
  */

  if (
    typeof scenarioProductScoreV1
      === 'function'
  ) {

    const previousRealtimeScoreV1 =
      scenarioProductScoreV1;


    scenarioProductScoreV1 =
      function(
        product,
        index,
        category
      ) {

        let score =
          previousRealtimeScoreV1(
            product,
            index,
            category
          );


        const data =
          window
            .airgestureRealtimeOpportunityV1;


        if (!data) {
          return score;
        }


        const categorySignal =
          (
            data.categoryScores ||
            []
          ).find(
            item =>
              item.title ===
              category
          );


        if (categorySignal) {

          score +=
            Number(
              categorySignal.score ||
              0
            ) * 0.18;
        }


        const name =
          String(
            product?.[0] ||
            ''
          ).toLowerCase();


        for (
          const keyword
          of (
            data.keywords ||
            []
          )
        ) {

          if (
            name.includes(
              String(
                keyword
              ).toLowerCase()
            )
          ) {
            score += 11;
          }
        }


        return score;
      };
  }


  document.addEventListener(
    'change',
    event => {

      if (
        event.target?.id
          === 'segmentFilter' ||
        event.target?.id
          === 'locationFilter'
      ) {

        setTimeout(
          loadRealtimeOpportunityV1,
          150
        );
      }
    }
  );


  ensureRealtimeOpportunityPanelV1();

  setTimeout(
    loadRealtimeOpportunityV1,
    700
  );

  scheduleRealtimeOpportunityV1();



  // AIRGESTURE_COMMERCIAL_LOCAL_FILTERS_V1

  let commercialAudienceV1 = '';
  let commercialMarketV1 = '';


  function populateCommercialStrategyFiltersV1() {

    const audienceSelect =
      $('commercialAudienceFilterV1');

    const marketSelect =
      $('commercialMarketFilterV1');

    if (
      !audienceSelect ||
      !marketSelect ||
      !state.snapshot
    ) {
      return;
    }


    const audiences =
      state.snapshot
        ?.dimensions
        ?.segments || [];


    const markets =
      state.snapshot
        ?.dimensions
        ?.locations || [];


    const currentAudience =
      commercialAudienceV1;

    const currentMarket =
      commercialMarketV1;


    audienceSelect.innerHTML =
      `
        <option value="">
          All audiences
        </option>
      `
      +
      audiences
        .filter(
          item =>
            item.name &&
            item.name !==
              'NOT_OPTED_IN'
        )
        .map(
          item => `

            <option
              value="${escapeHtml(
                item.name
              )}">

              ${escapeHtml(
                typeof prettySegment
                  === 'function'
                    ? prettySegment(
                        item.name
                      )
                    : item.name
              )}

            </option>

          `
        )
        .join('');


    marketSelect.innerHTML =
      `
        <option value="">
          All markets
        </option>
      `
      +
      markets
        .filter(
          item =>
            item.name &&
            !String(
              item.name
            )
              .toLowerCase()
              .includes(
                'unavailable'
              )
        )
        .map(
          item => `

            <option
              value="${escapeHtml(
                item.name
              )}">

              ${escapeHtml(
                typeof prettyLocation
                  === 'function'
                    ? prettyLocation(
                        item.name
                      )
                    : item.name
              )}
              (${formatNumber(
                item.count || 0
              )})

            </option>

          `
        )
        .join('');


    audienceSelect.value =
      currentAudience;

    marketSelect.value =
      currentMarket;
  }


  function selectedCommercialAudienceV1() {

    return (
      commercialAudienceV1 ||
      ''
    );
  }


  function selectedCommercialMarketV1() {

    return (
      commercialMarketV1 ||
      ''
    );
  }


  function commercialAudienceLabelV1() {

    if (
      !commercialAudienceV1
    ) {
      return 'All audiences';
    }

    try {

      return (
        prettySegment(
          commercialAudienceV1
        )
        ||
        commercialAudienceV1
      );

    } catch {

      return commercialAudienceV1;
    }
  }


  function commercialMarketLabelV1() {

    if (
      !commercialMarketV1
    ) {
      return 'All markets';
    }

    try {

      return (
        prettyLocation(
          commercialMarketV1
        )
        ||
        commercialMarketV1
      );

    } catch {

      return commercialMarketV1;
    }
  }


  /*
    Override only the Commercial Strategy scenario
    selection. The main dashboard filters remain
    independent.
  */

  selectedAudienceScenarioV1 =
    function() {

      return (
        commercialAudienceLabelV1()
      );
    };


  selectedMarketScenarioV1 =
    function() {

      return (
        commercialMarketLabelV1()
      );
    };


  async function loadCommercialStrategyOpportunityV1() {

    const params =
      new URLSearchParams();


    if (
      commercialAudienceV1
    ) {

      params.set(
        'segment',
        commercialAudienceV1
      );
    }


    if (
      commercialMarketV1
    ) {

      params.set(
        'location',
        commercialMarketV1
      );
    }


    try {

      const response =
        await fetch(
          `/api/intelligence/opportunity?${params.toString()}`,
          {
            credentials:
              'same-origin',

            cache:
              'no-store'
          }
        );


      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );
      }


      const data =
        await response.json();


      window
        .airgestureRealtimeOpportunityV1 =
        data;


      if (
        typeof renderRealtimeOpportunityV1
          === 'function'
      ) {

        renderRealtimeOpportunityV1(
          data
        );
      }


      if (
        typeof updateCommercialScenarioV1
          === 'function'
      ) {

        updateCommercialScenarioV1();
      }


      if (
        typeof renderProductExplorerGridV1
          === 'function' &&
        typeof productExplorerCategoryV1
          !== 'undefined' &&
        productExplorerCategoryV1
      ) {

        try {

          renderProductExplorerGridV1();

        } catch {}
      }

    } catch (error) {

      console.warn(
        'Commercial strategy scenario refresh failed:',
        error
      );
    }
  }


  function commercialScenarioChangedV1() {

    commercialAudienceV1 =
      $('commercialAudienceFilterV1')
        ?.value || '';


    commercialMarketV1 =
      $('commercialMarketFilterV1')
        ?.value || '';


    loadCommercialStrategyOpportunityV1();
  }


  document.addEventListener(
    'change',
    event => {

      if (
        event.target?.id ===
          'commercialAudienceFilterV1'
        ||
        event.target?.id ===
          'commercialMarketFilterV1'
      ) {

        commercialScenarioChangedV1();
      }
    }
  );


  document.addEventListener(
    'click',
    event => {

      if (
        event.target.closest(
          '#commercialResetV1'
        )
      ) {

        commercialAudienceV1 = '';
        commercialMarketV1 = '';


        const audience =
          $('commercialAudienceFilterV1');

        const market =
          $('commercialMarketFilterV1');


        if (audience) {
          audience.value = '';
        }

        if (market) {
          market.value = '';
        }


        loadCommercialStrategyOpportunityV1();
      }
    }
  );


  /*
    Preserve existing dashboard rendering and only
    repopulate these two local dropdowns afterward.
  */

  const previousRenderAllCommercialFiltersV1 =
    renderAll;


  renderAll =
    function(snapshot) {

      previousRenderAllCommercialFiltersV1(
        snapshot
      );

      populateCommercialStrategyFiltersV1();
    };


  /*
    Make the 20-second real-time refresh respect
    the Commercial Strategy dropdowns.
  */

  if (
    typeof loadRealtimeOpportunityV1
      === 'function'
  ) {

    loadRealtimeOpportunityV1 =
      loadCommercialStrategyOpportunityV1;
  }


  setTimeout(
    () => {

      populateCommercialStrategyFiltersV1();

      loadCommercialStrategyOpportunityV1();

    },
    900
  );


  // =======================================================
  // AIRGESTURE_EXACT_COMMERCIAL_CONTEXT_V3
  //
  // Audience + Market selected in Commercial Strategy
  // are the authoritative scenario for ALL 6 categories.
  // =======================================================

  function exactCommercialContextV3() {

    const audienceSelect =
      $('commercialAudienceFilterV1');

    const marketSelect =
      $('commercialMarketFilterV1');


    /*
      Always read directly from the visible dropdown.
      Never use first market/audience from state.snapshot.
    */

    const audienceValue =
      audienceSelect?.value || '';

    const marketValue =
      marketSelect?.value || '';


    let audience =
      'All audiences';

    let market =
      'All markets';


    if (audienceValue) {

      const selected =
        audienceSelect.options[
          audienceSelect.selectedIndex
        ];

      audience =
        selected?.textContent?.trim()
        ||
        (
          typeof prettySegment === 'function'
            ? prettySegment(audienceValue)
            : audienceValue
        );
    }


    if (marketValue) {

      const selected =
        marketSelect.options[
          marketSelect.selectedIndex
        ];

      market =
        (
          selected?.textContent?.trim()
          ||
          (
            typeof prettyLocation === 'function'
              ? prettyLocation(marketValue)
              : marketValue
          )
        )
        .replace(
          /\s*\([\d,]+\)\s*$/,
          ''
        )
        .trim();
    }


    return {
      audienceValue,
      marketValue,
      audience,
      market
    };
  }


  /*
    CRITICAL FIX.

    The old marketplaceContextV2() used the first audience
    and first market from state.snapshot.

    That is why selecting Phoenix could still display
    New York inside the product marketplace.

    From here forward the marketplace receives ONLY the
    selected Commercial Strategy dropdown values.
  */

  marketplaceContextV2 =
    function() {

      const scenario =
        exactCommercialContextV3();

      return {
        audience:
          scenario.audience,

        market:
          scenario.market
      };
    };


  function synchronizeCommercialMarketplaceV3() {

    const scenario =
      exactCommercialContextV3();


    /*
      Keep internal scenario variables synchronized too.
    */

    commercialAudienceV1 =
      scenario.audienceValue;

    commercialMarketV1 =
      scenario.marketValue;


    /*
      Product Explorer header.
    */

    const explorerAudience =
      $('productExplorerAudienceV1');

    const explorerMarket =
      $('productExplorerMarketV1');


    if (explorerAudience) {

      explorerAudience.textContent =
        scenario.audience;
    }


    if (explorerMarket) {

      explorerMarket.textContent =
        scenario.market;
    }


    /*
      Re-render products.

      catalogForOpportunityV1() already ranks products
      through scenarioProductScoreV1(), so refreshing here
      applies Audience + Market ordering to EVERY category.
    */

    if (
      typeof renderProductExplorerGridV1 === 'function'
      &&
      typeof productExplorerCategoryV1 !== 'undefined'
      &&
      productExplorerCategoryV1
    ) {

      try {

        renderProductExplorerGridV1();

      } catch (error) {

        console.warn(
          'Commercial marketplace redraw failed:',
          error
        );
      }
    }
  }


  async function commercialSelectionChangedV3() {

    const scenario =
      exactCommercialContextV3();


    commercialAudienceV1 =
      scenario.audienceValue;

    commercialMarketV1 =
      scenario.marketValue;


    /*
      Refresh backend opportunity score for this exact
      audience + market.
    */

    if (
      typeof loadCommercialStrategyOpportunityV1 ===
        'function'
    ) {

      await loadCommercialStrategyOpportunityV1();
    }


    synchronizeCommercialMarketplaceV3();
  }


  /*
    Handle BOTH Commercial Strategy dropdowns.
  */

  document.addEventListener(
    'change',
    event => {

      if (
        event.target?.id ===
          'commercialAudienceFilterV1'
        ||
        event.target?.id ===
          'commercialMarketFilterV1'
      ) {

        commercialSelectionChangedV3();
      }
    }
  );


  /*
    Every "Explore 20 products" action must inherit the
    currently visible Audience + Market.

    Applies to:
      Antivirus & Security
      Business Productivity
      PDF & Document Productivity
      Cloud Storage
      Photo & Creative
      Backup & Recovery
  */

  document.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest('button');

      if (!button) return;


      if (
        String(
          button.textContent || ''
        )
        .toLowerCase()
        .includes('explore 20 products')
      ) {

        /*
          The existing handler opens the product explorer.
          Synchronize immediately after it renders.
        */

        requestAnimationFrame(
          () => {

            synchronizeCommercialMarketplaceV3();

            requestAnimationFrame(
              synchronizeCommercialMarketplaceV3
            );
          }
        );
      }
    }
  );


  /*
    Also guard against later render functions overwriting
    the displayed market with an old snapshot value.
  */

  const exactCommercialObserverV3 =
    new MutationObserver(
      () => {

        const explorer =
          $('productExplorerV1');

        if (
          !explorer ||
          explorer.hidden
        ) {
          return;
        }


        const scenario =
          exactCommercialContextV3();

        const audience =
          $('productExplorerAudienceV1');

        const market =
          $('productExplorerMarketV1');


        if (
          audience &&
          audience.textContent.trim() !==
            scenario.audience
        ) {

          audience.textContent =
            scenario.audience;
        }


        if (
          market &&
          market.textContent.trim() !==
            scenario.market
        ) {

          market.textContent =
            scenario.market;
        }
      }
    );


  exactCommercialObserverV3.observe(
    document.body,
    {
      subtree: true,
      childList: true
    }
  );


  /*
    Reset behavior.
  */

  document.addEventListener(
    'click',
    event => {

      if (
        !event.target.closest(
          '#commercialResetV1'
        )
      ) {
        return;
      }


      requestAnimationFrame(
        () => {

          commercialAudienceV1 = '';
          commercialMarketV1 = '';

          synchronizeCommercialMarketplaceV3();
        }
      );
    }
  );


})();


// AIRGESTURE_VISUAL_ANALYTICS_V2
(function () {
  if (window.__AIRGESTURE_VISUAL_ANALYTICS_V2__) {
    return;
  }
  window.__AIRGESTURE_VISUAL_ANALYTICS_V2__ = true;

  const AIRV2_COLORS = [
    '#4ddcff',
    '#7d88ff',
    '#40c4ff',
    '#14e2c3',
    '#ffd166',
    '#ff8fab',
    '#8dd3c7',
    '#72f1b8'
  ];

  function airv2ById(id) {
    return document.getElementById(id);
  }

  function airv2SafeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function airv2Number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function airv2FormatNumber(value) {
    const n = airv2Number(value);
    return n.toLocaleString();
  }

  function airv2FormatPct(value) {
    const n = airv2Number(value);
    return `${n.toFixed(1)}%`;
  }

  function airv2FormatBytes(bytes) {
    const n = airv2Number(bytes);
    if (!n) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let idx = 0;
    let size = n;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[idx]}`;
  }

  function airv2Escape(value) {
    return String(value ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;");
  }

  function airv2PrettySegment(value) {
    try {
      if (typeof prettySegment === 'function') {
        return prettySegment(value);
      }
    } catch {}
    return String(value ?? '');
  }

  function airv2PrettyLocation(value) {
    try {
      if (typeof prettyLocation === 'function') {
        return prettyLocation(value);
      }
    } catch {}
    return String(value ?? '');
  }

  function airv2GetSnapshot() {
    try {
      return state?.snapshot || null;
    } catch {
      return null;
    }
  }

  function airv2FindDimensionCandidates(snapshot, keys) {
    const dims = snapshot?.dimensions || {};
    for (const key of keys) {
      const candidate = dims?.[key];
      if (Array.isArray(candidate) && candidate.length) {
        return candidate;
      }
    }
    return [];
  }

  function airv2NormalizeItem(item) {
    return {
      name:
        item?.name ??
        item?.label ??
        item?.segment ??
        item?.location ??
        item?.os ??
        item?.browser ??
        item?.fileType ??
        'Unknown',
      count:
        airv2Number(
          item?.count ??
          item?.value ??
          item?.events ??
          item?.total
        ),
      users:
        airv2Number(item?.users ?? item?.userCount),
      volume:
        airv2Number(item?.volume ?? item?.bytes ?? item?.fileSizeBytes),
      engagement:
        airv2Number(item?.engagement ?? item?.eventsPerUser ?? item?.avg)
    };
  }

  function airv2Top(items, n) {
    return airv2SafeArray(items)
      .map(airv2NormalizeItem)
      .filter(item => item.count > 0 || item.users > 0 || item.volume > 0)
      .sort((a, b) => (b.count || b.users || b.volume) - (a.count || a.users || a.volume))
      .slice(0, n);
  }

  function airv2DonutSVG(items, total) {
    const radius = 78;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    const segments = items.map((item, index) => {
      const share = total ? item.count / total : 0;
      const length = circumference * share;
      const dashArray = `${length} ${circumference - length}`;
      const rotate = (offset / circumference) * 360 - 90;
      offset += length;
      return `
        <circle
          cx="100"
          cy="100"
          r="${radius}"
          fill="none"
          stroke="${AIRV2_COLORS[index % AIRV2_COLORS.length]}"
          stroke-width="18"
          stroke-linecap="round"
          stroke-dasharray="${dashArray}"
          transform="rotate(${rotate} 100 100)"
        ></circle>
      `;
    }).join('');

    return `
      <svg viewBox="0 0 200 200" width="200" height="200" aria-hidden="true">
        <circle cx="100" cy="100" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="18"></circle>
        ${segments}
      </svg>
    `;
  }

  function airv2RenderLegend(items, total, prettyFn) {
    if (!items.length) {
      return `<div class="airv2-empty">No data available for this view.</div>`;
    }
    return `
      <div class="airv2-legend">
        ${items.map((item, index) => {
          const pct = total ? (item.count / total) * 100 : 0;
          return `
            <div class="airv2-legend-item">
              <span class="airv2-dot" style="background:${AIRV2_COLORS[index % AIRV2_COLORS.length]}"></span>
              <span class="airv2-legend-name">${airv2Escape(prettyFn ? prettyFn(item.name) : item.name)}</span>
              <span class="airv2-legend-count">${airv2FormatNumber(item.count)}</span>
              <span class="airv2-legend-pct">${airv2FormatPct(pct)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function airv2RenderBars(items, maxValue, labelMode) {
    if (!items.length) {
      return `<div class="airv2-empty">No data available for this view.</div>`;
    }

    return `
      <div class="airv2-bars">
        ${items.map(item => {
          const value = labelMode === 'volume'
            ? item.volume
            : labelMode === 'users'
            ? item.users
            : item.count;
          const width = maxValue ? Math.max(8, (value / maxValue) * 100) : 0;
          const right = labelMode === 'volume'
            ? airv2FormatBytes(value)
            : labelMode === 'engagement'
            ? value.toFixed(1)
            : airv2FormatNumber(value);

          return `
            <div class="airv2-bar-item">
              <div class="airv2-bar-top">
                <span>${airv2Escape(item.name)}</span>
                <span>${airv2Escape(right)}</span>
              </div>
              <div class="airv2-bar-track">
                <div class="airv2-bar-fill" style="width:${width}%"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function airv2EnsureStudio() {
    if (airv2ById('airv2VisualStudio')) {
      return airv2ById('airv2VisualStudio');
    }

    const commercialAnchor =
      document.getElementById('commercialStrategyControlsV1')?.closest('section, .intelligence-card, .panel, div') ||
      [...document.querySelectorAll('h2,h3')].find(el =>
        String(el.textContent || '').toLowerCase().includes('product opportunity marketplace')
      )?.closest('section, .intelligence-card, .panel, div');

    if (!commercialAnchor || !commercialAnchor.parentNode) {
      return null;
    }

    const wrapper = document.createElement('section');
    wrapper.id = 'airv2VisualStudio';
    wrapper.className = 'airv2-visual-studio';
    wrapper.innerHTML = `
      <div class="airv2-headline">
        <div class="airv2-headline-copy">
          <small>DATA STORYTELLING STUDIO</small>
          <h2>See the database before you decide the strategy</h2>
          <p>
            This section turns the loaded data into visual insight first—so students can immediately
            understand audience behavior, market concentration, content patterns, platforms and business direction.
          </p>
        </div>
        <div class="airv2-badge" id="airv2LiveBadge">Analysis loading…</div>
      </div>

      <div class="airv2-kpis" id="airv2Kpis"></div>

      <div class="airv2-grid">
        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Audience visual</small>
              <h3>Audience mix</h3>
              <p>Who is most active right now?</p>
            </div>
            <span class="airv2-chip">Donut</span>
          </div>
          <div class="airv2-donut-wrap">
            <div class="airv2-donut-box" id="airv2AudienceDonut"></div>
            <div id="airv2AudienceLegend"></div>
          </div>
        </div>

        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Content visual</small>
              <h3>Content mix</h3>
              <p>Which file behaviors are shaping product hypotheses?</p>
            </div>
            <span class="airv2-chip">Donut</span>
          </div>
          <div class="airv2-donut-wrap">
            <div class="airv2-donut-box" id="airv2ContentDonut"></div>
            <div id="airv2ContentLegend"></div>
          </div>
        </div>

        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Decision highlights</small>
              <h3>Insight spotlight</h3>
              <p>Best quick-take summaries for the audience.</p>
            </div>
            <span class="airv2-chip">Explain</span>
          </div>
          <div class="airv2-mini-list" id="airv2SpotlightList"></div>
        </div>
      </div>

      <div class="airv2-grid">
        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Market visual</small>
              <h3>Top markets</h3>
              <p>Where is observed activity strongest?</p>
            </div>
            <span class="airv2-chip">Bars</span>
          </div>
          <div id="airv2MarketBars"></div>
        </div>

        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Platform visual</small>
              <h3>Platform mix</h3>
              <p>Which operating environments dominate usage?</p>
            </div>
            <span class="airv2-chip">Bars</span>
          </div>
          <div id="airv2PlatformBars"></div>
        </div>

        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Volume visual</small>
              <h3>Market volume</h3>
              <p>Which markets carry the most data volume?</p>
            </div>
            <span class="airv2-chip">Bars</span>
          </div>
          <div id="airv2VolumeBars"></div>
        </div>
      </div>

      <div class="airv2-spotlights" id="airv2Spotlights"></div>

      <div class="airv2-mosaic">
        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Market intelligence</small>
              <h3>Reach · Engagement · Volume</h3>
              <p>Top market cards without boring tables.</p>
            </div>
            <span class="airv2-chip">Cards</span>
          </div>
          <div class="airv2-mini-list" id="airv2MarketCards"></div>
        </div>

        <div class="airv2-card">
          <div class="airv2-card-head">
            <div>
              <small>Audience intelligence</small>
              <h3>Observed audience leaders</h3>
              <p>Best audience candidates to explain in class.</p>
            </div>
            <span class="airv2-chip">Cards</span>
          </div>
          <div class="airv2-mini-list" id="airv2AudienceCards"></div>
        </div>
      </div>
    `;

    commercialAnchor.parentNode.insertBefore(wrapper, commercialAnchor);
    return wrapper;
  }

  function airv2HideLegacyBlocks() {
    const phrases = [
      'Filter analysis',
      'Audience ranking',
      'Reach · Engagement · Volume',
      'Market quality',
      'Executive decision',
      'Decision snapshot',
      'Core analytics',
      'Behavior'
    ];

    const nodes = [...document.querySelectorAll('h1,h2,h3,h4')];
    nodes.forEach(node => {
      const text = String(node.textContent || '').trim().toLowerCase();
      if (!phrases.some(phrase => text.includes(phrase.toLowerCase()))) {
        return;
      }
      const block = node.closest('section, .intelligence-card, .panel, article, .card, div');
      if (block && !block.id?.startsWith('airv2') && !block.closest('#airv2VisualStudio')) {
        block.classList.add('airv2-hidden');
      }
    });
  }

  function airv2Render(snapshot) {
    const studio = airv2EnsureStudio();
    if (!studio || !snapshot) {
      return;
    }

    airv2HideLegacyBlocks();

    const segments = airv2Top(
      airv2FindDimensionCandidates(snapshot, ['segments', 'audiences', 'segmentMix']),
      6
    );

    const locations = airv2Top(
      airv2FindDimensionCandidates(snapshot, ['locations', 'markets', 'topMarkets']),
      6
    );

    const fileTypes = airv2Top(
      airv2FindDimensionCandidates(snapshot, ['fileTypes', 'contentTypes', 'content']),
      6
    );

    const platforms = airv2Top(
      airv2FindDimensionCandidates(snapshot, ['os', 'platforms', 'operatingSystems', 'browsers']),
      6
    );

    const metrics = snapshot?.metrics || snapshot?.summary || {};
    const totalEvents =
      airv2Number(metrics?.eventCount ?? metrics?.events ?? snapshot?.recordCount ?? 0) ||
      segments.reduce((sum, item) => sum + item.count, 0) ||
      fileTypes.reduce((sum, item) => sum + item.count, 0);

    const uniqueUsers =
      airv2Number(metrics?.userCount ?? metrics?.users ?? snapshot?.uniqueUsers ?? 0) ||
      Math.max(...segments.map(item => item.users || 0), 0);

    const totalVolume =
      airv2Number(metrics?.volumeBytes ?? metrics?.fileSizeBytes ?? metrics?.totalVolume ?? 0) ||
      locations.reduce((sum, item) => sum + item.volume, 0);

    const topAudience = segments[0] || null;
    const topMarket = locations[0] || null;
    const topContent = fileTypes[0] || null;
    const topPlatform = platforms[0] || null;

    const badge = airv2ById('airv2LiveBadge');
    if (badge) {
      badge.textContent = `LIVE VISUAL ANALYTICS · ${airv2FormatNumber(totalEvents)} events`;
    }

    const kpis = [
      {
        label: 'Recorded events',
        value: airv2FormatNumber(totalEvents),
        note: 'Total observed activity in current analysis'
      },
      {
        label: 'Observed users',
        value: airv2FormatNumber(uniqueUsers),
        note: 'Unique visible users represented'
      },
      {
        label: 'Markets',
        value: airv2FormatNumber(locations.length),
        note: 'Cities / locations with visible demand'
      },
      {
        label: 'Volume',
        value: airv2FormatBytes(totalVolume),
        note: 'Total recorded transfer volume'
      },
      {
        label: 'Leading audience',
        value: topAudience ? airv2PrettySegment(topAudience.name) : '—',
        note: topAudience ? `${airv2FormatNumber(topAudience.count)} observed events` : 'No audience signal'
      },
      {
        label: 'Leading content',
        value: topContent ? topContent.name : '—',
        note: topContent ? `${airv2FormatPct((topContent.count / (totalEvents || 1)) * 100)} of observed activity` : 'No content signal'
      }
    ];

    const kpisNode = airv2ById('airv2Kpis');
    if (kpisNode) {
      kpisNode.innerHTML = kpis.map(item => `
        <div class="airv2-kpi">
          <div class="airv2-kpi-label">${airv2Escape(item.label)}</div>
          <div class="airv2-kpi-value">${airv2Escape(item.value)}</div>
          <div class="airv2-kpi-note">${airv2Escape(item.note)}</div>
        </div>
      `).join('');
    }

    const audienceTotal = segments.reduce((sum, item) => sum + item.count, 0);
    const contentTotal = fileTypes.reduce((sum, item) => sum + item.count, 0);

    const audienceDonut = airv2ById('airv2AudienceDonut');
    if (audienceDonut) {
      audienceDonut.innerHTML = `
        <div class="airv2-donut">
          ${airv2DonutSVG(segments, audienceTotal)}
          <div class="airv2-donut-center">
            <strong>${airv2FormatNumber(audienceTotal)}</strong>
            <span>audience events</span>
          </div>
        </div>
      `;
    }

    const contentDonut = airv2ById('airv2ContentDonut');
    if (contentDonut) {
      contentDonut.innerHTML = `
        <div class="airv2-donut">
          ${airv2DonutSVG(fileTypes, contentTotal)}
          <div class="airv2-donut-center">
            <strong>${airv2FormatNumber(contentTotal)}</strong>
            <span>content events</span>
          </div>
        </div>
      `;
    }

    const audienceLegend = airv2ById('airv2AudienceLegend');
    if (audienceLegend) {
      audienceLegend.innerHTML = airv2RenderLegend(
        segments,
        audienceTotal,
        airv2PrettySegment
      );
    }

    const contentLegend = airv2ById('airv2ContentLegend');
    if (contentLegend) {
      contentLegend.innerHTML = airv2RenderLegend(
        fileTypes,
        contentTotal,
        value => value
      );
    }

    const spotlightList = airv2ById('airv2SpotlightList');
    if (spotlightList) {
      const items = [
        {
          left: 'Best market now',
          right: topMarket ? airv2PrettyLocation(topMarket.name) : 'No signal'
        },
        {
          left: 'Best audience now',
          right: topAudience ? airv2PrettySegment(topAudience.name) : 'No signal'
        },
        {
          left: 'Best content signal',
          right: topContent ? topContent.name : 'No signal'
        },
        {
          left: 'Platform leader',
          right: topPlatform ? topPlatform.name : 'No signal'
        },
        {
          left: 'Users per top market',
          right: topMarket ? `${airv2FormatNumber(topMarket.users)} users` : '—'
        },
        {
          left: 'Top market volume',
          right: topMarket ? airv2FormatBytes(topMarket.volume) : '—'
        }
      ];
      spotlightList.innerHTML = items.map(item => `
        <div class="airv2-mini-row">
          <span class="airv2-mini-left">${airv2Escape(item.left)}</span>
          <span class="airv2-mini-right">${airv2Escape(item.right)}</span>
        </div>
      `).join('');
    }

    const marketBars = airv2ById('airv2MarketBars');
    if (marketBars) {
      const maxCount = Math.max(...locations.map(item => item.count), 1);
      marketBars.innerHTML = airv2RenderBars(
        locations.map(item => ({...item, name: airv2PrettyLocation(item.name)})),
        maxCount,
        'count'
      );
    }

    const platformBars = airv2ById('airv2PlatformBars');
    if (platformBars) {
      const maxCount = Math.max(...platforms.map(item => item.count), 1);
      platformBars.innerHTML = airv2RenderBars(
        platforms,
        maxCount,
        'count'
      );
    }

    const volumeBars = airv2ById('airv2VolumeBars');
    if (volumeBars) {
      const maxVolume = Math.max(...locations.map(item => item.volume), 1);
      volumeBars.innerHTML = airv2RenderBars(
        locations.map(item => ({...item, name: airv2PrettyLocation(item.name)})),
        maxVolume,
        'volume'
      );
    }

    const spotlights = airv2ById('airv2Spotlights');
    if (spotlights) {
      const cards = [
        {
          title: topAudience ? airv2PrettySegment(topAudience.name) : 'No audience signal',
          label: 'Audience leader',
          text: topAudience
            ? `${airv2FormatNumber(topAudience.count)} observed events suggest this is the easiest audience to explain first in class.`
            : 'No audience signal available.'
        },
        {
          title: topMarket ? airv2PrettyLocation(topMarket.name) : 'No market signal',
          label: 'Market leader',
          text: topMarket
            ? `${airv2FormatNumber(topMarket.users)} users and ${airv2FormatBytes(topMarket.volume)} of volume make this the clearest market story.`
            : 'No market signal available.'
        },
        {
          title: topContent ? topContent.name : 'No content signal',
          label: 'Content behavior',
          text: topContent
            ? `Observed content behavior currently leans toward ${topContent.name.toLowerCase()}, which helps explain product-fit hypotheses.`
            : 'No content signal available.'
        }
      ];

      spotlights.innerHTML = cards.map(card => `
        <div class="airv2-spotlight">
          <small>${airv2Escape(card.label)}</small>
          <h4>${airv2Escape(card.title)}</h4>
          <p>${airv2Escape(card.text)}</p>
        </div>
      `).join('');
    }

    const marketCards = airv2ById('airv2MarketCards');
    if (marketCards) {
      marketCards.innerHTML = locations.map(item => `
        <div class="airv2-mini-row">
          <div>
            <div class="airv2-mini-left">${airv2Escape(airv2PrettyLocation(item.name))}</div>
            <div style="color:#8ea6bc;font-size:12px;margin-top:4px;">
              Reach ${airv2FormatNumber(item.users)} · Engagement ${item.engagement ? item.engagement.toFixed(1) : '—'} · Volume ${airv2FormatBytes(item.volume)}
            </div>
          </div>
          <span class="airv2-mini-right">${airv2FormatNumber(item.count)} events</span>
        </div>
      `).join('');
    }

    const audienceCards = airv2ById('airv2AudienceCards');
    if (audienceCards) {
      audienceCards.innerHTML = segments.map(item => `
        <div class="airv2-mini-row">
          <div>
            <div class="airv2-mini-left">${airv2Escape(airv2PrettySegment(item.name))}</div>
            <div style="color:#8ea6bc;font-size:12px;margin-top:4px;">
              ${airv2FormatNumber(item.users)} users represented
            </div>
          </div>
          <span class="airv2-mini-right">${airv2FormatNumber(item.count)} events</span>
        </div>
      `).join('');
    }
  }

  function airv2RenderFromState() {
    const snapshot = airv2GetSnapshot();
    if (snapshot) {
      airv2Render(snapshot);
    }
  }

  const __oldRenderAllAirV2 =
    typeof renderAll === 'function'
      ? renderAll
      : null;

  if (__oldRenderAllAirV2) {
    renderAll = function (snapshot) {
      __oldRenderAllAirV2(snapshot);
      try {
        airv2Render(snapshot || airv2GetSnapshot());
      } catch (error) {
        console.warn('AIRV2 render error:', error);
      }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(airv2RenderFromState, 700);
    setTimeout(airv2RenderFromState, 1600);
  });

  window.addEventListener('load', () => {
    setTimeout(airv2RenderFromState, 1200);
  });
})();


// AIRGESTURE_VISUAL_ANALYTICS_PHASE2
(function () {

  if (
    window.__AIRGESTURE_VISUAL_ANALYTICS_PHASE2__
  ) {
    return;
  }

  window
    .__AIRGESTURE_VISUAL_ANALYTICS_PHASE2__ =
    true;


  function p2ById(id) {
    return document.getElementById(id);
  }


  function p2Escape(value) {
    return String(
      value ?? ''
    )
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;");
  }


  function p2Tooltip() {

    let tip =
      p2ById(
        'airv2Tooltip'
      );

    if (tip) {
      return tip;
    }

    tip =
      document.createElement(
        'div'
      );

    tip.id =
      'airv2Tooltip';

    tip.className =
      'airv2-tooltip';

    tip.hidden = true;

    document.body
      .appendChild(tip);

    return tip;
  }


  function p2ShowTooltip(
    event,
    title,
    body
  ) {

    const tip =
      p2Tooltip();

    tip.innerHTML = `
      <strong>
        ${p2Escape(title)}
      </strong>
      ${p2Escape(body)}
    `;

    tip.hidden = false;

    const x =
      event.clientX + 16;

    const y =
      event.clientY + 16;

    tip.style.left =
      `${x}px`;

    tip.style.top =
      `${y}px`;
  }


  function p2HideTooltip() {
    const tip =
      p2ById(
        'airv2Tooltip'
      );

    if (tip) {
      tip.hidden = true;
    }
  }


  function p2Snapshot() {
    try {
      return state?.snapshot || null;
    } catch {
      return null;
    }
  }


  function p2TopMarkets() {

    const snapshot =
      p2Snapshot();

    const values =
      snapshot
        ?.dimensions
        ?.locations || [];

    return values
      .filter(
        item =>
          item?.name &&
          Number(
            item?.count || 0
          ) > 0
      )
      .sort(
        (a,b) =>
          Number(
            b.count || 0
          ) -
          Number(
            a.count || 0
          )
      )
      .slice(0,6);
  }


  function p2PrettyLocation(
    value
  ) {
    try {
      return prettyLocation(
        value
      );
    } catch {
      return value;
    }
  }


  function p2FormatBytes(
    value
  ) {

    const bytes =
      Number(value || 0);

    if (!bytes) {
      return '0 B';
    }

    const units =
      [
        'B',
        'KB',
        'MB',
        'GB',
        'TB'
      ];

    let size =
      bytes;

    let index = 0;

    while (
      size >= 1024 &&
      index <
        units.length - 1
    ) {
      size /= 1024;
      index++;
    }

    return (
      `${size.toFixed(
        size >= 10 ? 1 : 2
      )} ${units[index]}`
    );
  }


  function p2EnsureHeatSection() {

    if (
      p2ById(
        'airv2MarketHeat'
      )
    ) {
      return;
    }

    const studio =
      p2ById(
        'airv2VisualStudio'
      );

    if (!studio) {
      return;
    }

    const section =
      document.createElement(
        'div'
      );

    section.className =
      'airv2-card';

    section.innerHTML = `

      <div class="airv2-card-head">

        <div>
          <small>
            MARKET HEAT
          </small>

          <h3>
            Geographic opportunity pulse
          </h3>

          <p>
            Stronger observed markets receive greater visual intensity.
          </p>
        </div>

        <span class="airv2-chip">
          Heat View
        </span>

      </div>

      <div
        id="airv2MarketHeat"
        class="airv2-market-heat">
      </div>

    `;

    const mosaic =
      studio.querySelector(
        '.airv2-mosaic'
      );

    if (mosaic) {
      studio.insertBefore(
        section,
        mosaic
      );
    }
    else {
      studio.appendChild(
        section
      );
    }
  }


  function p2RenderHeat() {

    p2EnsureHeatSection();

    const target =
      p2ById(
        'airv2MarketHeat'
      );

    if (!target) {
      return;
    }

    const markets =
      p2TopMarkets();

    if (!markets.length) {

      target.innerHTML =
        '<div class="airv2-empty">No market data available.</div>';

      return;
    }

    const max =
      Math.max(
        ...markets.map(
          item =>
            Number(
              item.count || 0
            )
        ),
        1
      );

    target.innerHTML =
      markets
        .map(
          (item,index) => {

            const count =
              Number(
                item.count || 0
              );

            const heat =
              Math.max(
                .05,
                Math.min(
                  .22,
                  (
                    count /
                    max
                  ) * .22
                )
              );

            const users =
              Number(
                item.users || 0
              );

            const engagement =
              users
                ? (
                    count /
                    users
                  ).toFixed(1)
                : '—';

            return `

              <article
                class="airv2-heat-card"
                style="--airv2-heat:${heat}">

                <span
                  class="airv2-heat-rank">
                  #${index + 1}
                </span>

                <h4>
                  ${p2Escape(
                    p2PrettyLocation(
                      item.name
                    )
                  )}
                </h4>

                <p>
                  ${count.toLocaleString()}
                  events ·
                  ${users.toLocaleString()}
                  users
                </p>

                <p>
                  ${engagement}
                  events/user ·
                  ${p2FormatBytes(
                    item.bytes ||
                    item.volume ||
                    0
                  )}
                </p>

              </article>

            `;
          }
        )
        .join('');
  }


  function p2EnhanceDonuts() {

    document
      .querySelectorAll(
        '.airv2-donut svg circle'
      )
      .forEach(
        (circle,index) => {

          if (
            circle.dataset
              .airv2Bound
          ) {
            return;
          }

          /*
            Skip the background circle.
          */

          if (
            !circle.getAttribute(
              'stroke-dasharray'
            )
          ) {
            return;
          }

          circle.dataset
            .airv2Bound =
            '1';

          circle.dataset
            .airv2Segment =
            String(index);


          circle.addEventListener(
            'mouseenter',
            event => {

              const parent =
                circle.closest(
                  '.airv2-card'
                );

              const legend =
                parent
                  ?.querySelectorAll(
                    '.airv2-legend-item'
                  )
                  ?.[
                    index - 1
                  ];

              const name =
                legend
                  ?.querySelector(
                    '.airv2-legend-name'
                  )
                  ?.textContent
                  ?.trim()
                ||
                'Segment';

              const pct =
                legend
                  ?.querySelector(
                    '.airv2-legend-pct'
                  )
                  ?.textContent
                  ?.trim()
                ||
                '';

              p2ShowTooltip(
                event,
                name,
                `${pct} of the current observed activity`
              );
            }
          );


          circle.addEventListener(
            'mousemove',
            event => {

              const tip =
                p2ById(
                  'airv2Tooltip'
                );

              if (!tip) {
                return;
              }

              tip.style.left =
                `${event.clientX + 16}px`;

              tip.style.top =
                `${event.clientY + 16}px`;
            }
          );


          circle.addEventListener(
            'mouseleave',
            p2HideTooltip
          );


          circle.addEventListener(
            'click',
            () => {

              const donut =
                circle.closest(
                  '.airv2-donut'
                );

              if (!donut) {
                return;
              }

              const wasActive =
                circle.classList
                  .contains(
                    'active'
                  );

              donut
                .querySelectorAll(
                  'circle'
                )
                .forEach(
                  c =>
                    c.classList
                      .remove(
                        'active'
                      )
                );

              donut.classList
                .toggle(
                  'is-dimmed',
                  !wasActive
                );

              if (!wasActive) {

                circle.classList
                  .add(
                    'active'
                  );
              }
            }
          );
        }
      );
  }


  function p2EnsureStoryMode() {

    if (
      p2ById(
        'airv2StoryMode'
      )
    ) {
      return;
    }

    const studio =
      p2ById(
        'airv2VisualStudio'
      );

    const headline =
      studio
        ?.querySelector(
          '.airv2-headline'
        );

    if (
      !studio ||
      !headline
    ) {
      return;
    }

    const controls =
      document.createElement(
        'div'
      );

    controls.id =
      'airv2StoryMode';

    controls.className =
      'airv2-story-control';

    controls.innerHTML = `

      <button
        type="button"
        data-airv2-story="overview"
        class="active">

        Overview

      </button>

      <button
        type="button"
        data-airv2-story="audience">

        Audience Story

      </button>

      <button
        type="button"
        data-airv2-story="market">

        Market Story

      </button>

      <button
        type="button"
        data-airv2-story="content">

        Content Story

      </button>

      <button
        type="button"
        data-airv2-story="decision">

        Decision Story

      </button>

    `;

    headline
      .querySelector(
        '.airv2-headline-copy'
      )
      ?.appendChild(
        controls
      );

    const banner =
      document.createElement(
        'div'
      );

    banner.id =
      'airv2StoryBanner';

    banner.className =
      'airv2-story-banner';

    banner.innerHTML = `

      <span>
        CLASSROOM STORY MODE
      </span>

      <strong>
        Start with the overall data picture
      </strong>

      <p>
        Move from evidence to a business decision one story at a time.
      </p>

    `;

    headline
      .insertAdjacentElement(
        'afterend',
        banner
      );
  }


  function p2UpdateStory(
    mode
  ) {

    const studio =
      p2ById(
        'airv2VisualStudio'
      );

    const banner =
      p2ById(
        'airv2StoryBanner'
      );

    if (
      !studio ||
      !banner
    ) {
      return;
    }

    const audience =
      studio.querySelectorAll(
        '.airv2-card'
      )[0];

    const content =
      studio.querySelectorAll(
        '.airv2-card'
      )[1];

    const marketBars =
      p2ById(
        'airv2MarketBars'
      )
        ?.closest(
          '.airv2-card'
        );

    const heat =
      p2ById(
        'airv2MarketHeat'
      )
        ?.closest(
          '.airv2-card'
        );

    const spotlights =
      p2ById(
        'airv2Spotlights'
      );


    [
      audience,
      content,
      marketBars,
      heat,
      spotlights
    ]
      .filter(Boolean)
      .forEach(
        el =>
          el.classList
            .remove(
              'airv2-highlight'
            )
      );


    const stories = {

      overview: {
        title:
          'Start with the overall data picture',

        text:
          'Review audience, market, content and platform behavior before making a strategic recommendation.',

        target: null
      },

      audience: {
        title:
          'Who is using AirGesture most?',

        text:
          'Use the audience mix to identify the strongest observed technology segment before selecting a product test.',

        target:
          audience
      },

      market: {
        title:
          'Where is activity strongest?',

        text:
          'Use market strength, reach and engagement to identify geographic areas worth testing—not to assume purchase demand.',

        target:
          heat ||
          marketBars
      },

      content: {
        title:
          'What behavior is driving usage?',

        text:
          'File-type behavior helps connect observed usage with possible storage, PDF, creative, backup or productivity experiments.',

        target:
          content
      },

      decision: {
        title:
          'Turn the evidence into one controlled business experiment',

        text:
          'After understanding the visual analytics, use the Commercial Strategy section below to select an Audience + Market and explore product opportunities.',

        target:
          spotlights
      }
    };


    const story =
      stories[mode] ||
      stories.overview;


    banner.innerHTML = `

      <span>
        CLASSROOM STORY MODE
      </span>

      <strong>
        ${p2Escape(
          story.title
        )}
      </strong>

      <p>
        ${p2Escape(
          story.text
        )}
      </p>

    `;


    if (
      story.target
    ) {

      story.target
        .classList
        .add(
          'airv2-highlight'
        );

      story.target
        .scrollIntoView({
          behavior:
            'smooth',
          block:
            'center'
        });
    }
  }


  document.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          '[data-airv2-story]'
        );

      if (!button) {
        return;
      }

      document
        .querySelectorAll(
          '[data-airv2-story]'
        )
        .forEach(
          item =>
            item.classList
              .remove(
                'active'
              )
        );

      button.classList
        .add(
          'active'
        );

      p2UpdateStory(
        button.dataset
          .airv2Story
      );
    }
  );


  function p2Refresh() {

    p2EnsureHeatSection();

    p2RenderHeat();

    p2EnsureStoryMode();

    p2EnhanceDonuts();
  }


  const originalRenderAllP2 =
    typeof renderAll ===
      'function'
        ? renderAll
        : null;


  if (originalRenderAllP2) {

    renderAll =
      function(snapshot) {

        originalRenderAllP2(
          snapshot
        );

        setTimeout(
          p2Refresh,
          80
        );
      };
  }


  document.addEventListener(
    'DOMContentLoaded',
    () => {

      setTimeout(
        p2Refresh,
        1200
      );

      setTimeout(
        p2Refresh,
        2200
      );
    }
  );


  window.addEventListener(
    'load',
    () => {

      setTimeout(
        p2Refresh,
        1400
      );
    }
  );



  // AIRGESTURE_FINAL_VISUAL_FIRST_V1

  function organizeVisualFirstDashboardV1() {

    const dashboard =
      $('dashboardView');

    if (!dashboard) return;


    const kpis =
      dashboard.querySelector(
        ':scope > .kpi-grid'
      );


    const sections =
      [
        ...dashboard.querySelectorAll(
          ':scope > .section-block'
        )
      ];


    const coreAnalytics =
      sections.find(section =>
        section
          .querySelector(
            '[data-panel="audience"]'
          )
      );


    const behavior =
      sections.find(section =>
        section.classList
          .contains(
            'behavior-block'
          )
      );


    const commercial =
      sections.find(section =>
        section.classList
          .contains(
            'commercial-block'
          )
      );


    /*
      Desired order:

      KPI summary
      ↓
      Visual analytics charts
      ↓
      Behavior charts
      ↓
      Commercial Strategy
    */

    if (kpis) {

      if (coreAnalytics) {
        kpis.insertAdjacentElement(
          'afterend',
          coreAnalytics
        );
      }


      if (
        behavior &&
        coreAnalytics
      ) {

        coreAnalytics
          .insertAdjacentElement(
            'afterend',
            behavior
          );
      }


      if (commercial) {

        const anchor =
          behavior ||
          coreAnalytics ||
          kpis;

        anchor
          .insertAdjacentElement(
            'afterend',
            commercial
          );
      }
    }


    /*
      Remove unnecessary explanatory text
      without removing the data itself.
    */

    dashboard
      .querySelectorAll(
        '.plain-note'
      )
      .forEach(note => {

        if (
          note.closest(
            '.commercial-block'
          )
        ) {
          return;
        }

        note.hidden = true;
      });
  }


  document.addEventListener(
    'DOMContentLoaded',
    () => {

      organizeVisualFirstDashboardV1();

    }
  );


  setTimeout(
    organizeVisualFirstDashboardV1,
    700
  );


  setTimeout(
    organizeVisualFirstDashboardV1,
    1600
  );



  // =======================================================
  // AIRGESTURE_FINAL_PASSIVE_CHARTS_V1
  // Charts are visual evidence only.
  // Commercial Strategy is controlled ONLY by its own
  // Audience + Market dropdowns.
  // =======================================================

  function makeAnalyticsChartsPassiveV1() {

    const dashboard =
      $('dashboardView');

    if (!dashboard) return;


    /*
      Prevent Chart.js canvas interactions from reaching
      existing dashboard filtering handlers.

      Capture phase is intentional:
      it runs before existing click handlers.
    */

    dashboard
      .querySelectorAll(
        '.chart-stage canvas'
      )
      .forEach(canvas => {

        if (
          canvas.dataset
            .passiveAnalyticsV1 ===
          '1'
        ) {
          return;
        }

        canvas.dataset
          .passiveAnalyticsV1 =
          '1';


        const blockInteraction =
          event => {

            event.preventDefault();

            event.stopPropagation();

            event
              .stopImmediatePropagation();

            return false;
          };


        [
          'click',
          'dblclick',
          'pointerdown',
          'pointerup',
          'mousedown',
          'mouseup',
          'touchstart',
          'touchend'
        ]
          .forEach(type => {

            canvas.addEventListener(
              type,
              blockInteraction,
              true
            );

          });

      });


    /*
      Remove chart filtering appearance from cards.
    */

    dashboard
      .querySelectorAll(
        '.chart-card'
      )
      .forEach(card => {

        card.removeAttribute(
          'tabindex'
        );

        card.removeAttribute(
          'role'
        );

      });
  }


  function forceCommercialStrategyLocalOnlyV1() {

    const audience =
      $('commercialAudienceFilterV1');

    const market =
      $('commercialMarketFilterV1');


    if (
      !audience ||
      !market
    ) {
      return;
    }


    /*
      Recalculate Commercial Strategy strictly from
      these two controls.

      Hidden dashboard chart filters must never decide
      the product scenario.
    */

    const refresh =
      () => {

        if (
          typeof
            loadCommercialStrategyOpportunityV1 ===
          'function'
        ) {

          loadCommercialStrategyOpportunityV1();

        }

      };


    if (
      audience.dataset
        .commercialLocalOnlyV1 !==
      '1'
    ) {

      audience.dataset
        .commercialLocalOnlyV1 =
        '1';

      audience.addEventListener(
        'change',
        refresh
      );

    }


    if (
      market.dataset
        .commercialLocalOnlyV1 !==
      '1'
    ) {

      market.dataset
        .commercialLocalOnlyV1 =
        '1';

      market.addEventListener(
        'change',
        refresh
      );

    }
  }


  function removeUsageIntensityV1() {

    const usage =
      document.querySelector(
        '#dashboardView [data-panel="usage"]'
      );

    if (usage) {

      usage.remove();

    }


    /*
      If Usage Intensity left an empty Behavior section,
      keep only the useful Activity-by-hour visualization.
    */

    const behavior =
      document.querySelector(
        '#dashboardView .behavior-block'
      );

    if (behavior) {

      const timing =
        behavior.querySelector(
          '[data-panel="timing"]'
        );

      if (timing) {

        timing.classList.add(
          'wide-card'
        );

      }

    }
  }


  function simplifyCommercialStrategyV1() {

    /*
      Real-time opportunity calculations remain available
      internally for product ranking, but the explanation
      panel is unnecessary in the visible student flow.
    */

    const realtime =
      $('realtimeOpportunityV1');

    if (realtime) {

      realtime.hidden = true;

      realtime.setAttribute(
        'aria-hidden',
        'true'
      );

    }


    const scenario =
      $('commercialScenarioV1');

    if (scenario) {

      scenario.hidden = true;

      scenario.setAttribute(
        'aria-hidden',
        'true'
      );

    }
  }


  function finalSimpleIntelligenceFlowV1() {

    makeAnalyticsChartsPassiveV1();

    removeUsageIntensityV1();

    simplifyCommercialStrategyV1();

    forceCommercialStrategyLocalOnlyV1();

  }


  document.addEventListener(
    'DOMContentLoaded',
    finalSimpleIntelligenceFlowV1
  );


  window.addEventListener(
    'load',
    () => {

      setTimeout(
        finalSimpleIntelligenceFlowV1,
        300
      );

      setTimeout(
        finalSimpleIntelligenceFlowV1,
        1200
      );

    }
  );

})();
