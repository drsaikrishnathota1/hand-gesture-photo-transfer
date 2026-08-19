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

})();
