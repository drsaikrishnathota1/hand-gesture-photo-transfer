(() => {
  const $ =
    (id) =>
      document.getElementById(id);

  const params =
    new URLSearchParams(
      window.location.search
    );

  const room =
    String(
      params.get('room') || ''
    )
      .trim()
      .toUpperCase();

  let currentRows = [];


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
      : d.toLocaleTimeString(
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
      label: 'Time',
      format: time
    },

    {
      key: 'student',
      label: 'Student'
    },

    {
      key: 'room',
      label: 'Room'
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
      key: 'trigger',
      label: 'Trigger'
    },

    {
      key: 'latencyMs',
      label: 'Latency ms'
    },

    {
      key: 'speedMbps',
      label: 'Speed Mbps'
    },

    {
      key: 'durationSec',
      label: 'Duration sec'
    },

    {
      key: 'acceptanceLatencySec',
      label: 'Acceptance sec'
    },

    {
      key: 'gestureConfidence',
      label: 'Gesture Confidence',
      format:
        (value) =>
          Number(value)
            ? `${(
                Number(value) *
                100
              ).toFixed(1)}%`
            : '—'
    },

    {
      key: 'integrityVerified',
      label: 'SHA-256 Verified',
      format:
        (value) =>
          value === true
            ? 'YES'
            : '—'
    },

    {
      key: 'retries',
      label: 'Retries'
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
      key: 'timezone',
      label: 'Timezone'
    },

    {
      key: 'language',
      label: 'Language'
    },

    {
      key: 'country',
      label: 'Country'
    },

    {
      key: 'region',
      label: 'Region'
    },

    {
      key: 'screenCategory',
      label: 'Screen Category'
    },

    {
      key: 'touchCapable',
      label: 'Touch Capable',
      format:
        (value) =>
          value === true
            ? 'YES'
            : value === false
              ? 'NO'
              : '—'
    },

    {
      key: 'memoryTier',
      label: 'Memory Tier'
    },

    {
      key: 'cpuTier',
      label: 'CPU Tier'
    },

    {
      key: 'referrerHost',
      label: 'Referrer Host'
    },

    {
      key: 'landingPath',
      label: 'Landing Path'
    },

    {
      key: 'utmSource',
      label: 'UTM Source'
    },

    {
      key: 'utmMedium',
      label: 'UTM Medium'
    },

    {
      key: 'utmCampaign',
      label: 'UTM Campaign'
    },

    {
      key: 'visitCount',
      label: 'Visits'
    },

    {
      key: 'totalTransfers',
      label: 'Total Transfers'
    },

    {
      key: 'totalBytes',
      label: 'Total User Data',
      format: bytes
    },

    {
      key: 'imageTransfers',
      label: 'Image Transfers'
    },

    {
      key: 'videoTransfers',
      label: 'Video Transfers'
    },

    {
      key: 'pdfTransfers',
      label: 'PDF Transfers'
    },

    {
      key: 'documentTransfers',
      label: 'Document Transfers'
    },

    {
      key: 'otherTransfers',
      label: 'Other Transfers'
    },

    {
      key: 'deviceSegment',
      label: 'Device Segment'
    },

    {
      key: 'usageSegment',
      label: 'Usage Segment'
    },

    {
      key: 'contentSegment',
      label: 'Content Segment'
    },

    {
      key: 'commercialSegment',
      label: 'Commercial Segment',
      format:
        (value) =>
          value ===
          'NOT_OPTED_IN'
            ? 'Not opted in'
            : value
    },

    {
      key: 'analyticsConsent',
      label: 'Analytics Opt-In',
      format:
        (value) =>
          value === true
            ? 'YES'
            : 'NO'
    },

    {
      key: 'firstSeenAt',
      label: 'First Seen',
      format:
        (value) =>
          value
            ? new Date(
                value
              ).toLocaleString()
            : '—'
    },

    {
      key: 'lastSeenAt',
      label: 'Last Seen',
      format:
        (value) =>
          value
            ? new Date(
                value
              ).toLocaleString()
            : '—'
    },

    {
      key: 'joinedAt',
      label: 'Room Joined',
      format:
        (value) =>
          value
            ? new Date(
                value
              ).toLocaleString()
            : '—'
    },

    {
      key: 'leftAt',
      label: 'Room Left',
      format:
        (value) =>
          value
            ? new Date(
                value
              ).toLocaleString()
            : '—'
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
        'Waiting for the first SEND or RECEIVE…';

      tr.appendChild(td);
      body.appendChild(tr);

      return;
    }


    for (const row of rows) {
      const tr =
        document.createElement(
          'tr'
        );

      for (
        const column
        of columns
      ) {
        const td =
          document.createElement(
            'td'
          );

        td.textContent =
          displayValue(
            row,
            column
          );

        if (
          column.key ===
          'action'
        ) {
          td.className =
            row.action === 'SEND'
              ? 'action-send'
              : 'action-receive';
        }

        tr.appendChild(td);
      }

      body.appendChild(tr);
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
        'Commercial opportunities will appear after opted-in classroom data is collected.';

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
        `${count} student${
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


  function render(data) {
    const summary =
      data.summary || {};

    const insights =
      data.insights || {};

    const mix =
      insights.fileMix || {};

    currentRows =
      Array.isArray(data.rows)
        ? data.rows
        : [];

    setText(
      'liveUsers',
      summary.totalUsers || 0
    );

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
      'liveCommercialAudience',
      summary.commercialAudience || 0
    );

    setText(
      'applePct',
      `${insights.applePct || 0}%`
    );

    setText(
      'windowsPct',
      `${insights.windowsPct || 0}%`
    );

    setText(
      'mobilePct',
      `${insights.mobilePct || 0}%`
    );

    setText(
      'imageMix',
      mix.IMAGE || 0
    );

    setText(
      'documentMix',
      Number(
        mix.PDF || 0
      ) +
      Number(
        mix.DOCUMENT || 0
      )
    );

    setText(
      'videoMix',
      mix.VIDEO || 0
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

    renderBusiness(
      insights.segments || {}
    );
  }


  async function refresh() {
    if (!room) {
      setText(
        'liveStatus',
        'Open this window from an AirGesture room'
      );

      return;
    }

    try {
      const response =
        await fetch(
          `/api/live-data?room=${encodeURIComponent(room)}`,
          {
            cache:
              'no-store'
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Live data unavailable'
        );
      }

      render(data);
    } catch (error) {
      console.error(error);

      setText(
        'liveStatus',
        'Reconnecting…'
      );
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


  function downloadCsv() {
    if (!currentRows.length) {
      return;
    }

    const output = [
      columns.map(
        (column) =>
          column.label
      ),

      ...currentRows.map(
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
      `airgesture-${room}-full-data-${stamp}.csv`;


    document.body
      .appendChild(
        link
      );

    link.click();
    link.remove();

    URL.revokeObjectURL(
      url
    );
  }



  renderHeader();

  setText(
    'liveRoom',
    room || '—'
  );

  $('downloadCsvBtn')
    .addEventListener(
      'click',
      downloadCsv
    );

  refresh();

  setInterval(
    refresh,
    1000
  );
})();
