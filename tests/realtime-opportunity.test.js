'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const {
  buildRealtimeOpportunity
} =
  require('../realtime-opportunity');


function row(
  daysAgo,
  {
    student,
    location,
    segment,
    fileType
  }
) {

  const anchor =
    Date.parse(
      '2026-08-18T12:00:00Z'
    );

  return {
    time:
      new Date(
        anchor -
        daysAgo *
        24 *
        60 *
        60 *
        1000
      ).toISOString(),

    student,
    location,

    commercialSegment:
      segment,

    fileType,

    fileSizeBytes:
      1000000,

    os:
      segment
        .toLowerCase()
        .includes('windows')
          ? 'Windows'
          : 'Other'
  };
}


test(
  'real-time opportunity responds to future geo/audience activity',
  () => {

    const rows = [];

    /*
      Previous week:
      smaller Missouri baseline.
    */

    for (
      let i = 0;
      i < 12;
      i++
    ) {

      rows.push(
        row(
          8 + (i % 5),
          {
            student:
              `old-${i % 5}`,

            location:
              'St. Louis, MO',

            segment:
              'Windows Desktop',

            fileType:
              'PDF'
          }
        )
      );
    }


    /*
      Recent week:
      strong Missouri growth.
    */

    for (
      let i = 0;
      i < 60;
      i++
    ) {

      rows.push(
        row(
          i % 6,
          {
            student:
              `new-${i % 16}`,

            location:
              'St. Louis, MO',

            segment:
              'Windows Desktop',

            fileType:
              i % 4 === 0
                ? 'DOCUMENT'
                : 'PDF'
          }
        )
      );
    }


    const result =
      buildRealtimeOpportunity(
        rows,
        {
          location:
            'St. Louis, MO',

          segment:
            'Windows Desktop'
        }
      );


    assert.equal(
      result.recentEvents,
      60
    );

    assert.equal(
      result.previousEvents,
      12
    );

    assert.equal(
      result.confidence,
      'STRONG'
    );

    assert.ok(
      result.growth.percent > 0
    );

    assert.ok(
      result.categoryScores.length >= 6
    );


    const topTitles =
      result
        .categoryScores
        .slice(0, 3)
        .map(item =>
          item.title
        );


    assert.ok(
      topTitles.includes(
        'PDF & Document Productivity'
      )
    );

    assert.ok(
      result.keywords.includes(
        'microsoft'
      )
    );

    assert.ok(
      result.keywords.includes(
        'acrobat'
      )
    );
  }
);


test(
  'small samples remain explore rather than strong',
  () => {

    const rows = [
      row(
        0,
        {
          student: 'one',
          location:
            'Boone Township, MO',
          segment:
            'Apple Mobile',
          fileType:
            'IMAGE'
        }
      ),

      row(
        1,
        {
          student: 'two',
          location:
            'Boone Township, MO',
          segment:
            'Apple Mobile',
          fileType:
            'IMAGE'
        }
      )
    ];


    const result =
      buildRealtimeOpportunity(
        rows,
        {
          location:
            'Boone Township, MO'
        }
      );


    assert.equal(
      result.confidence,
      'EXPLORE'
    );
  }
);
