(() => {
  const $ =
    (id) =>
      document.getElementById(id);

  const databaseScope =
    'ALL STORED RECORDS';


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
      key: 'country',
      label: 'Country'
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
    try {
      setText(
        'liveStatus',
        'Loading PostgreSQL…'
      );

      const response =
        await fetch(
          '/api/live-data',
          {
            cache: 'no-store',
            credentials: 'same-origin'
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

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
      `airgesture-commercial-data-${stamp}.csv`;


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
    databaseScope
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
