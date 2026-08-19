(() => {
  const $ =
    (id) =>
      document.getElementById(id);

  const databaseScope =
    'ALL STORED RECORDS';


  let currentRows = [];

  // ========================================================
  // SERVER-SIDE DATABASE SEARCH + PAGINATION
  // ========================================================

  const PAGE_SIZE = 20;

  let currentPage = 1;
  let currentSearch = '';

  let currentPagination = {
    page: 1,
    pageSize: PAGE_SIZE,
    totalRecords: 0,
    totalPages: 1,
    from: 0,
    to: 0,
    search: ''
  };

  let searchTimer = null;
  let refreshInFlight = false;

  // Commercial analytics use the SAME Intelligence snapshot
  // as /intelligence.html.
  let intelligenceRefreshInFlight = false;
  let latestIntelligenceSnapshot = null;

  // Selected transaction remains expanded even while
  // the live dashboard refreshes every second.
  let activeTransferGroupId = '';


  function setText(id, value) {
    const el = $(id);

    if (el) {
      el.textContent =
        String(value);
    }
  }


  function bytes(value) {
    const size =
      Number(value) || 0;

    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 ** 2) {
      return `${(
        size / 1024
      ).toFixed(1)} KB`;
    }

    return `${(
      size / 1024 ** 2
    ).toFixed(2)} MB`;
  }


  function time(value) {
    const d =
      new Date(value);

    return Number.isNaN(
      d.getTime()
    )
      ? '—'
      : d.toLocaleString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }
        );
  }


  const columns = [
    {
      key: 'time',
      label: 'Date / Time',
      format: time
    },
    {
      key: 'student',
      label: 'User'
    },
    {
      key: 'room',
      label: 'Room'
    },
    {
      key: 'transferId',
      label: 'Transfer ID'
    },
    {
      key: 'action',
      label: 'Action'
    },
    {
      key: 'fileType',
      label: 'File Type'
    },
    {
      key: 'fileSizeBytes',
      label: 'File Size',
      format: bytes
    },
    {
      key: 'result',
      label: 'Result'
    },
    {
      key: 'device',
      label: 'Device'
    },
    {
      key: 'os',
      label: 'OS'
    },
    {
      key: 'browser',
      label: 'Browser'
    },
    {
      key: 'location',
      label: 'Location'
    },
    {
      key: 'commercialSegment',
      label: 'Commercial Segment',
      format: (value) => value || '—'
    }
  ];

  function renderHeader() {
    const head =
      $('liveHead');

    if (!head) return;

    const tr =
      document.createElement(
        'tr'
      );

    for (
      const column
      of columns
    ) {
      const th =
        document.createElement(
          'th'
        );

      th.textContent =
        column.label;

      tr.appendChild(th);
    }

    head.replaceChildren(tr);
  }


  function displayValue(
    row,
    column
  ) {
    const raw =
      row?.[column.key];

    if (
      typeof column.format ===
      'function'
    ) {
      return column.format(raw);
    }

    if (
      raw === null ||
      raw === undefined ||
      raw === ''
    ) {
      return '—';
    }

    return String(raw);
  }


  function compactTransferId(value) {
    const id =
      String(value || '');

    if (!id) {
      return '—';
    }

    return id.length > 8
      ? `${id.slice(0, 8)}…`
      : id;
  }


  async function copyText(value) {
    const text =
      String(value || '');

    if (!text) {
      return false;
    }

    try {
      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard
          .writeText(text);

        return true;
      }
    } catch {
      // Continue to legacy fallback.
    }

    const temporary =
      document.createElement(
        'textarea'
      );

    temporary.value =
      text;

    temporary.setAttribute(
      'readonly',
      ''
    );

    temporary.style.position =
      'fixed';

    temporary.style.opacity =
      '0';

    document.body
      .appendChild(
        temporary
      );

    temporary.select();

    let copied = false;

    try {
      copied =
        document.execCommand(
          'copy'
        );
    } catch {
      copied = false;
    }

    temporary.remove();

    return copied;
  }


  function createTransferIdControl(
    value,
    transferGroupId
  ) {
    const id =
      String(value || '');

    const groupId =
      String(transferGroupId || '');

    const wrapper =
      document.createElement(
        'div'
      );

    wrapper.className =
      'transfer-id-tools';

    if (!id) {
      wrapper.textContent =
        '—';

      return wrapper;
    }

    const expanded =
      Boolean(groupId) &&
      activeTransferGroupId === groupId;

    const chip =
      document.createElement(
        'button'
      );

    chip.type =
      'button';

    chip.className =
      expanded
        ? 'transfer-id-chip is-expanded'
        : 'transfer-id-chip';

    chip.textContent =
      expanded
        ? id
        : compactTransferId(id);

    chip.title =
      expanded
        ? 'Collapse Transfer Trace'
        : 'Expand full ID and trace matching SEND / RECEIVE rows';

    chip.setAttribute(
      'aria-expanded',
      expanded
        ? 'true'
        : 'false'
    );

    chip.addEventListener(
      'click',
      () => {
        activeTransferGroupId =
          expanded
            ? ''
            : groupId;

        renderRows(
          currentRows
        );
      }
    );


    const copyButton =
      document.createElement(
        'button'
      );

    copyButton.type =
      'button';

    copyButton.className =
      'transfer-id-copy';

    copyButton.textContent =
      '⧉';

    copyButton.title =
      'Copy full Transfer ID';

    copyButton.setAttribute(
      'aria-label',
      `Copy Transfer ID ${id}`
    );

    copyButton.addEventListener(
      'click',
      async (event) => {
        event.stopPropagation();

        const copied =
          await copyText(id);

        if (!copied) {
          return;
        }

        copyButton.textContent =
          '✓';

        copyButton.classList
          .add(
            'is-copied'
          );

        setTimeout(
          () => {
            copyButton.textContent =
              '⧉';

            copyButton.classList
              .remove(
                'is-copied'
              );
          },
          900
        );
      }
    );


    wrapper.appendChild(
      chip
    );

    wrapper.appendChild(
      copyButton
    );

    return wrapper;
  }


  function renderRows(rows) {
    const body =
      $('liveRows');

    body.innerHTML = '';

    if (!rows.length) {
      const tr =
        document.createElement(
          'tr'
        );

      const td =
        document.createElement(
          'td'
        );

      td.colSpan =
        columns.length;

      td.className =
        'table-empty';

      td.textContent =
        currentSearch
          ? `No records found for "${currentSearch}". Try another Transfer ID or User Name.`
          : 'Waiting for the first SEND or RECEIVE…';

      tr.appendChild(td);
      body.appendChild(tr);

      return;
    }


    for (const row of rows) {
      const tr =
        document.createElement(
          'tr'
        );

      const rowTransferGroupId =
        String(
          row.transferGroupId || ''
        );

      if (
        rowTransferGroupId &&
        rowTransferGroupId ===
          activeTransferGroupId
      ) {
        tr.classList.add(
          'transfer-trace-active'
        );
      }

      for (
        const column
        of columns
      ) {
        const td =
          document.createElement(
            'td'
          );

        if (
          column.key ===
          'transferId'
        ) {
          td.classList.add(
            'transfer-id-cell'
          );

          td.appendChild(
            createTransferIdControl(
              row.transferId,
              row.transferGroupId
            )
          );
        } else if (
          column.key ===
          'student'
        ) {
          td.classList.add(
            'user-search-cell'
          );

          const userButton =
            document.createElement(
              'button'
            );

          userButton.type =
            'button';

          userButton.className =
            'user-search-link';

          userButton.textContent =
            displayValue(
              row,
              column
            );

          userButton.title =
            `Show all records for ${row.student || 'this user'}`;

          userButton.addEventListener(
            'click',
            () => {
              applySearch(
                row.student || ''
              );
            }
          );

          td.appendChild(
            userButton
          );

        } else {
          td.textContent =
            displayValue(
              row,
              column
            );
        }

        if (
          column.key ===
          'action'
        ) {
          td.classList.add(
            row.action === 'SEND'
              ? 'action-send'
              : 'action-receive'
          );
        }

        tr.appendChild(td);
      }

      body.appendChild(tr);
    }
  }




  function applySearch(value) {
    const next =
      String(value || '')
        .trim()
        .slice(0, 160);

    currentSearch =
      next;

    currentPage =
      1;

    activeTransferGroupId =
      '';

    const input =
      $('liveSearchInput');

    if (
      input &&
      input.value !== next
    ) {
      input.value =
        next;
    }

    refresh();
  }


  function clearSearch() {
    currentSearch = '';
    currentPage = 1;
    activeTransferGroupId = '';

    const input =
      $('liveSearchInput');

    if (input) {
      input.value = '';
      input.focus();
    }

    refresh();
  }


  function paginationItems(
    current,
    total
  ) {
    if (total <= 7) {
      return Array.from(
        {
          length: total
        },
        (_, index) =>
          index + 1
      );
    }


    const pages =
      new Set([
        1,
        total,
        current - 2,
        current - 1,
        current,
        current + 1,
        current + 2
      ]);


    const sorted =
      [...pages]
        .filter(
          (page) =>
            page >= 1 &&
            page <= total
        )
        .sort(
          (a, b) =>
            a - b
        );


    const output = [];

    let previous = 0;


    for (
      const page
      of sorted
    ) {
      if (
        previous &&
        page - previous > 1
      ) {
        output.push(
          'ellipsis'
        );
      }

      output.push(
        page
      );

      previous =
        page;
    }


    return output;
  }


  function goToPage(page) {
    const next =
      Math.max(
        1,
        Math.min(
          Number(page) || 1,
          Number(
            currentPagination
              .totalPages
          ) || 1
        )
      );

    if (
      next ===
      currentPage
    ) {
      return;
    }

    currentPage =
      next;

    activeTransferGroupId =
      '';

    refresh();

    const table =
      document.querySelector(
        '.live-panel'
      );

    if (table) {
      table.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }


  function renderPagination(
    pagination = {}
  ) {
    currentPagination = {
      page:
        Number(
          pagination.page
        ) || 1,

      pageSize:
        Number(
          pagination.pageSize
        ) || PAGE_SIZE,

      totalRecords:
        Number(
          pagination.totalRecords
        ) || 0,

      totalPages:
        Math.max(
          1,
          Number(
            pagination.totalPages
          ) || 1
        ),

      from:
        Number(
          pagination.from
        ) || 0,

      to:
        Number(
          pagination.to
        ) || 0,

      search:
        String(
          pagination.search ||
          currentSearch ||
          ''
        )
    };


    currentPage =
      currentPagination.page;


    const total =
      currentPagination
        .totalRecords;


    if (total) {
      setText(
        'liveRecordRange',
        `Showing ${currentPagination.from.toLocaleString()}–${currentPagination.to.toLocaleString()} of ${total.toLocaleString()} matching record${total === 1 ? '' : 's'}`
      );
    } else {
      setText(
        'liveRecordRange',
        currentSearch
          ? 'No matching records'
          : 'No stored records'
      );
    }


    const activeSearch =
      $('liveActiveSearch');

    if (activeSearch) {
      if (currentSearch) {
        activeSearch.hidden =
          false;

        activeSearch.textContent =
          `Search: "${currentSearch}"`;

      } else {
        activeSearch.hidden =
          true;

        activeSearch.textContent =
          '';
      }
    }


    const clearButton =
      $('clearLiveSearchBtn');

    if (clearButton) {
      clearButton.hidden =
        !currentSearch;
    }


    const previous =
      $('livePreviousPage');

    const next =
      $('liveNextPage');


    if (previous) {
      previous.disabled =
        currentPagination.page <= 1;
    }


    if (next) {
      next.disabled =
        currentPagination.page >=
        currentPagination.totalPages;
    }


    const root =
      $('livePageNumbers');

    if (!root) {
      return;
    }


    root.innerHTML = '';


    for (
      const item
      of paginationItems(
        currentPagination.page,
        currentPagination.totalPages
      )
    ) {
      if (
        item ===
        'ellipsis'
      ) {
        const ellipsis =
          document.createElement(
            'span'
          );

        ellipsis.className =
          'pagination-ellipsis';

        ellipsis.textContent =
          '…';

        root.appendChild(
          ellipsis
        );

        continue;
      }


      const button =
        document.createElement(
          'button'
        );

      button.type =
        'button';

      button.className =
        item ===
        currentPagination.page
          ? 'pagination-page is-current'
          : 'pagination-page';

      button.textContent =
        String(item);

      button.setAttribute(
        'aria-label',
        `Go to page ${item}`
      );


      if (
        item ===
        currentPagination.page
      ) {
        button.setAttribute(
          'aria-current',
          'page'
        );
      }


      button.addEventListener(
        'click',
        () =>
          goToPage(item)
      );


      root.appendChild(
        button
      );
    }
  }


  const recommendations = {
    APPLE_DESKTOP: [
      'Mac accessories',
      'Cloud storage',
      'Productivity applications'
    ],

    APPLE_MOBILE: [
      'Mobile storage',
      'iPhone/iPad services',
      'Mobile productivity tools'
    ],

    WINDOWS_DESKTOP: [
      'Windows productivity software',
      'Business cloud services',
      'PC accessories'
    ],

    ANDROID_MOBILE: [
      'Android services',
      'Mobile cloud storage',
      'Mobile-first offers'
    ],

    LINUX_DESKTOP: [
      'Developer tools',
      'Cloud infrastructure',
      'Technical services'
    ],

    MOBILE_USER: [
      'Mobile plans',
      'Mobile storage',
      'Mobile services'
    ],

    TABLET_USER: [
      'Tablet accessories',
      'Cloud storage',
      'Productivity tools'
    ],

    GENERAL_DESKTOP: [
      'Productivity software',
      'Cloud backup',
      'Desktop accessories'
    ]
  };


  function renderBusiness(
    segments = {}
  ) {
    const root =
      $('businessOpportunities');

    root.innerHTML = '';

    const entries =
      Object.entries(segments)
        .filter(
          ([, count]) =>
            Number(count) > 0
        )
        .sort(
          (a, b) =>
            Number(b[1]) -
            Number(a[1])
        );

    if (!entries.length) {
      const empty =
        document.createElement('div');

      empty.className =
        'business-empty';

      empty.textContent =
        'Commercial opportunities will appear as usage data is collected.';

      root.appendChild(empty);

      return;
    }

    for (
      const [segment, count]
      of entries
    ) {
      const card =
        document.createElement('article');

      const title =
        document.createElement('strong');

      title.textContent =
        segment;

      const audience =
        document.createElement('span');

      audience.textContent =
        `${count} user${
          Number(count) === 1
            ? ''
            : 's'
        }`;

      const list =
        document.createElement('ul');

      for (
        const idea
        of (
          recommendations[segment] ||
          [
            'Cloud services',
            'Productivity tools',
            'Digital services'
          ]
        )
      ) {
        const item =
          document.createElement('li');

        item.textContent =
          idea;

        list.appendChild(item);
      }

      card.appendChild(title);
      card.appendChild(audience);
      card.appendChild(list);

      root.appendChild(card);
    }
  }



  // ========================================================
  // AIRGESTURE_UNIFIED_INTELLIGENCE_SOURCE_V1
  //
  // Single source of truth:
  //
  // Database records:
  //   /api/live-data
  //
  // Commercial analytics:
  //   /api/intelligence
  //
  // This guarantees the Database page and Strategic
  // Intelligence page use the SAME analytical snapshot.
  // ========================================================


  function normalizedDimensionName(value) {

    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }


  function validCommercialSegment(item) {

    const name =
      normalizedDimensionName(
        item?.name
      );

    return Boolean(name)
      && name !== 'UNCLASSIFIED'
      && name !== 'NOT_OPTED_IN'
      && name !== 'UNSPECIFIED';
  }


  function segmentMetricMap(snapshot) {

    const map =
      new Map();


    for (
      const item
      of (
        snapshot
          ?.dimensions
          ?.segments || []
      )
    ) {

      if (
        !validCommercialSegment(item)
      ) {
        continue;
      }


      map.set(
        normalizedDimensionName(
          item.name
        ),
        {
          name:
            item.name,

          events:
            Number(
              item.count || 0
            ),

          users:
            Number(
              item.users || 0
            ),

          bytes:
            Number(
              item.bytes || 0
            )
        }
      );
    }


    return map;
  }


  function fileMetricMap(snapshot) {

    const map =
      new Map();


    for (
      const item
      of (
        snapshot
          ?.dimensions
          ?.fileTypes || []
      )
    ) {

      map.set(
        normalizedDimensionName(
          item.name
        ),
        Number(
          item.count || 0
        )
      );
    }


    return map;
  }


  function pctOf(
    value,
    total
  ) {

    if (!total) {
      return '0%';
    }


    return (
      Math.round(
        (
          Number(value || 0)
          /
          Number(total || 1)
        )
        * 1000
      )
      / 10
    ) + '%';
  }


  function prettyCommercialSegmentV1(
    value
  ) {

    const key =
      normalizedDimensionName(
        value
      );


    const labels = {

      WINDOWS_DESKTOP:
        'Windows Desktop',

      APPLE_DESKTOP:
        'Apple Desktop',

      APPLE_MOBILE:
        'Apple Mobile',

      ANDROID_MOBILE:
        'Android Mobile',

      TABLET_USER:
        'Tablet',

      TABLET:
        'Tablet',

      LINUX_DESKTOP:
        'Linux Desktop',

      GENERAL_DESKTOP:
        'General Desktop',

      MOBILE_USER:
        'Mobile User'
    };


    return (
      labels[key]
      ||
      String(value || '')
        .replace(/_/g, ' ')
        .replace(
          /\b\w/g,
          char =>
            char.toUpperCase()
        )
    );
  }


  function renderUnifiedCommercialV1(
    snapshot
  ) {

    if (!snapshot) {
      return;
    }


    latestIntelligenceSnapshot =
      snapshot;


    const segments =
      segmentMetricMap(
        snapshot
      );


    const segmentRows =
      [...segments.values()];


    /*
      Same denominator as the visible Audience Mix chart:
      qualified commercial-segment EVENTS.
    */

    const totalSegmentEvents =
      segmentRows.reduce(
        (sum, item) =>
          sum + item.events,
        0
      );


    const eventsFor =
      (...names) =>
        names.reduce(
          (sum, name) =>
            sum
            +
            (
              segments.get(
                normalizedDimensionName(
                  name
                )
              )
                ?.events || 0
            ),
          0
        );


    const appleEvents =
      eventsFor(
        'APPLE_DESKTOP',
        'APPLE_MOBILE'
      );


    const windowsEvents =
      eventsFor(
        'WINDOWS_DESKTOP'
      );


    const mobileEvents =
      eventsFor(
        'APPLE_MOBILE',
        'ANDROID_MOBILE',
        'TABLET_USER',
        'TABLET',
        'MOBILE_USER'
      );


    setText(
      'applePct',
      pctOf(
        appleEvents,
        totalSegmentEvents
      )
    );


    setText(
      'windowsPct',
      pctOf(
        windowsEvents,
        totalSegmentEvents
      )
    );


    setText(
      'mobilePct',
      pctOf(
        mobileEvents,
        totalSegmentEvents
      )
    );


    const files =
      fileMetricMap(
        snapshot
      );


    setText(
      'imageMix',
      files.get('IMAGE') || 0
    );


    setText(
      'documentMix',
      Number(
        files.get('PDF') || 0
      )
      +
      Number(
        files.get('DOCUMENT') || 0
      )
    );


    setText(
      'videoMix',
      files.get('VIDEO') || 0
    );


    renderUnifiedBusinessV1(
      segmentRows
    );
  }


  function renderUnifiedBusinessV1(
    segments
  ) {

    const root =
      $('businessOpportunities');


    if (!root) {
      return;
    }


    root.innerHTML = '';


    /*
      Sort by EVENT COUNT so the order corresponds to
      Strategic Intelligence Audience Mix.
    */

    const rows =
      [...(segments || [])]
        .filter(
          item =>
            Number(
              item.events || 0
            ) > 0
        )
        .sort(
          (a, b) =>
            Number(
              b.events || 0
            )
            -
            Number(
              a.events || 0
            )
        );


    if (!rows.length) {

      const empty =
        document.createElement(
          'div'
        );

      empty.className =
        'business-empty';

      empty.textContent =
        'Commercial opportunities will appear as usage data is collected.';

      root.appendChild(
        empty
      );

      return;
    }


    for (
      const item
      of rows
    ) {

      const key =
        normalizedDimensionName(
          item.name
        );


      const card =
        document.createElement(
          'article'
        );


      const title =
        document.createElement(
          'strong'
        );

      title.textContent =
        prettyCommercialSegmentV1(
          item.name
        );


      const audience =
        document.createElement(
          'span'
        );


      /*
        Show BOTH metrics to eliminate ambiguity.
      */

      audience.textContent =
        `${Number(item.users || 0).toLocaleString()} users · `
        +
        `${Number(item.events || 0).toLocaleString()} events`;


      const list =
        document.createElement(
          'ul'
        );


      for (
        const idea
        of (
          recommendations[key]
          ||
          [
            'Cloud services',
            'Productivity tools',
            'Digital services'
          ]
        )
      ) {

        const li =
          document.createElement(
            'li'
          );

        li.textContent =
          idea;

        list.appendChild(
          li
        );
      }


      card.appendChild(
        title
      );

      card.appendChild(
        audience
      );

      card.appendChild(
        list
      );


      root.appendChild(
        card
      );
    }
  }


  async function refreshUnifiedIntelligenceV1() {

    if (
      intelligenceRefreshInFlight
    ) {
      return;
    }


    intelligenceRefreshInFlight =
      true;


    try {

      const response =
        await fetch(
          '/api/intelligence',
          {
            cache:
              'no-store',

            credentials:
              'same-origin'
          }
        );


      const snapshot =
        await response
          .json()
          .catch(
            () => ({})
          );


      if (!response.ok) {

        throw new Error(
          snapshot.error
          ||
          'Strategic Intelligence unavailable'
        );
      }


      renderUnifiedCommercialV1(
        snapshot
      );


    } catch (error) {

      console.error(
        'Unified Intelligence load failed:',
        error
      );


      /*
        Do NOT fall back to the old /api/live-data
        commercial calculation. A silent fallback would
        recreate the exact mismatch we are fixing.
      */

    } finally {

      intelligenceRefreshInFlight =
        false;
    }
  }


  function render(data) {
    const summary =
      data.summary || {};

    currentRows =
      Array.isArray(data.rows)
        ? data.rows
        : [];

    setText(
      'liveSend',
      summary.sendEvents || 0
    );

    setText(
      'liveReceive',
      summary.receiveEvents || 0
    );

    setText(
      'liveEvents',
      summary.totalEvents || 0
    );

    setText(
      'liveBytes',
      bytes(
        summary.totalBytes || 0
      )
    );

    setText(
      'liveStatus',
      'LIVE · PostgreSQL'
    );

    setText(
      'lastUpdated',
      `Updated ${new Date().toLocaleTimeString()}`
    );

    renderRows(
      currentRows
    );

    renderPagination(
      data.pagination || {}
    );

  }


  async function refresh() {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight =
      true;

    try {
      const parameters =
        new URLSearchParams({
          page:
            String(currentPage),

          pageSize:
            String(PAGE_SIZE)
        });


      if (currentSearch) {
        parameters.set(
          'q',
          currentSearch
        );
      }


      const response =
        await fetch(
          `/api/live-data?${parameters.toString()}`,
          {
            cache: 'no-store',
            credentials: 'same-origin'
          }
        );


      const data =
        await response
          .json()
          .catch(
            () => ({})
          );


      if (!response.ok) {
        throw new Error(
          data.error ||
          'Database unavailable'
        );
      }


      render(data);


    } catch (error) {
      console.error(
        'Live database load failed:',
        error
      );


      setText(
        'liveStatus',
        'DATABASE ERROR'
      );


      setText(
        'lastUpdated',
        error.message ||
        'Could not load PostgreSQL data'
      );

    } finally {
      refreshInFlight =
        false;
    }
  }


  function csv(value) {
    const text =
      String(
        value ?? ''
      );

    return /[",\n]/.test(text)
      ? `"${text.replace(
          /"/g,
          '""'
        )}"`
      : text;
  }


  async function downloadCsv() {
    const button =
      $('downloadCsvBtn');

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Preparing CSV…';
    }


    try {
      const parameters =
        new URLSearchParams({
          export:
            '1',

          page:
            '1',

          pageSize:
            '50000'
        });


      if (currentSearch) {
        parameters.set(
          'q',
          currentSearch
        );
      }


      const response =
        await fetch(
          `/api/live-data?${parameters.toString()}`,
          {
            cache:
              'no-store',

            credentials:
              'same-origin'
          }
        );


      const data =
        await response
          .json()
          .catch(
            () => ({})
          );


      if (!response.ok) {
        throw new Error(
          data.error ||
          'Could not export database'
        );
      }


      const exportRows =
        Array.isArray(
          data.rows
        )
          ? data.rows
          : [];


      if (!exportRows.length) {
        setText(
          'liveStatus',
          'NO RECORDS TO EXPORT'
        );

        return;
      }


      const output = [
        columns.map(
          (column) =>
            column.label
        ),

        ...exportRows.map(
          (row) =>
            columns.map(
              (column) => {
                const value =
                  row?.[
                    column.key
                  ];

                if (
                  value === null ||
                  value === undefined
                ) {
                  return '';
                }

                return value;
              }
            )
        )
      ]
        .map(
          (row) =>
            row
              .map(csv)
              .join(',')
        )
        .join('\n');


      const blob =
        new Blob(
          [output],
          {
            type:
              'text/csv;charset=utf-8'
          }
        );


      const url =
        URL.createObjectURL(
          blob
        );


      const link =
        document.createElement(
          'a'
        );


      link.href =
        url;


      const stamp =
        new Date()
          .toISOString()
          .slice(0, 10);


      link.download =
        currentSearch
          ? `airgesture-search-data-${stamp}.csv`
          : `airgesture-commercial-data-${stamp}.csv`;


      document.body
        .appendChild(
          link
        );


      link.click();
      link.remove();


      URL.revokeObjectURL(
        url
      );


      setText(
        'liveStatus',
        `EXPORTED · ${exportRows.length.toLocaleString()} RECORDS`
      );


      setTimeout(
        () =>
          setText(
            'liveStatus',
            'LIVE · PostgreSQL'
          ),
        1200
      );


    } catch (error) {
      console.error(
        'CSV export failed:',
        error
      );


      setText(
        'liveStatus',
        'CSV EXPORT ERROR'
      );


    } finally {
      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Download CSV';
      }
    }
  }




  renderHeader();


  setText(
    'liveRoom',
    databaseScope
  );


  const searchInput =
    $('liveSearchInput');


  if (searchInput) {
    searchInput.addEventListener(
      'input',
      () => {
        clearTimeout(
          searchTimer
        );


        const value =
          searchInput.value
            .trim()
            .slice(
              0,
              160
            );


        searchTimer =
          setTimeout(
            () => {
              currentSearch =
                value;

              currentPage =
                1;

              activeTransferGroupId =
                '';

              refresh();
            },
            350
          );
      }
    );


    searchInput.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !==
          'Enter'
        ) {
          return;
        }


        event.preventDefault();


        clearTimeout(
          searchTimer
        );


        applySearch(
          searchInput.value
        );
      }
    );
  }


  const clearButton =
    $('clearLiveSearchBtn');

  if (clearButton) {
    clearButton.addEventListener(
      'click',
      clearSearch
    );
  }


  const previousButton =
    $('livePreviousPage');

  if (previousButton) {
    previousButton.addEventListener(
      'click',
      () =>
        goToPage(
          currentPage - 1
        )
    );
  }


  const nextButton =
    $('liveNextPage');

  if (nextButton) {
    nextButton.addEventListener(
      'click',
      () =>
        goToPage(
          currentPage + 1
        )
    );
  }


  $('downloadCsvBtn')
    .addEventListener(
      'click',
      downloadCsv
    );


  refresh();

  // Commercial sections use the same source as
  // Strategic Intelligence.
  refreshUnifiedIntelligenceV1();


  // Preserve the live character of the database page.
  // refreshInFlight prevents overlapping PostgreSQL requests.
  setInterval(
    refresh,
    1000
  );

  // Intelligence endpoint is server-cached and does not
  // need the one-second database-table refresh frequency.
  setInterval(
    refreshUnifiedIntelligenceV1,
    5000
  );

})();
