'use strict';

const {
  normalizeAiHistory,
  buildAiEvidencePackage,
  normalizeStructuredAiAnswer
} = require('./strategy-intelligence');

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scenario: {
      type: 'string',
      description: 'Short business scenario label based on the user question.'
    },
    title: {
      type: 'string',
      description: 'Short title that reflects the exact user question.'
    },
    directAnswer: {
      type: 'string',
      description: 'Direct answer to the current user question. The first sentence must answer the question rather than restating it.'
    },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to five concrete aggregate facts from AirGesture that support the answer.'
    },
    interpretation: {
      type: 'string',
      description: 'What the observed evidence means for the business question, without claiming purchase intent.'
    },
    recommendation: {
      type: 'string',
      description: 'One practical management recommendation that follows from the evidence.'
    },
    experiment: {
      type: 'string',
      description: 'A small controlled test that would validate or reject the recommendation.'
    },
    channel: {
      type: 'string',
      description: 'Advertising or go-to-market channel consideration when relevant; otherwise an empty string.'
    },
    limitation: {
      type: 'string',
      description: 'The most important limitation of the available AirGesture evidence for this question.'
    },
    evidenceStrength: {
      type: 'string',
      enum: ['HIGH', 'MODERATE', 'LIMITED'],
      description: 'Strength of the observed aggregate evidence for answering the exact question.'
    },
    chartKey: {
      type: 'string',
      enum: [
        'none',
        'markets',
        'segments',
        'fileTypes',
        'operatingSystems',
        'hours',
        'antivirusMarkets',
        'pdfMarkets',
        'cloudMarkets',
        'backupMarkets',
        'productivityMarkets',
        'creativeMarkets'
      ],
      description: 'Choose a server-generated supporting chart that directly helps answer the question.'
    },
    chartTitle: {
      type: 'string',
      description: 'Plain-language title for the supporting chart; empty when chartKey is none.'
    },
    followUps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to four natural follow-up questions grounded in the current conversation.'
    }
  },
  required: [
    'scenario',
    'title',
    'directAnswer',
    'evidence',
    'interpretation',
    'recommendation',
    'experiment',
    'channel',
    'limitation',
    'evidenceStrength',
    'chartKey',
    'chartTitle',
    'followUps'
  ]
};

function extractOutputText(payload = {}) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  return (payload.output || [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === 'output_text' && typeof part?.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function instructions() {
  return [
    'You are AirGesture AI Strategy Copilot for a DBA 802 Data Analytics and Strategic Decision Intelligence lab.',
    'Your job is to answer the CURRENT USER QUESTION exactly, using only the supplied aggregate AirGesture evidence.',
    'Do not substitute a nearby canned question. If the user asks WHERE, answer where. If they ask WHY, explain why. If they ask WHICH PRODUCT, compare products. If they ask a follow-up such as "why?", "what about Dallas?", or "which one?", use the recent conversation to resolve the reference.',
    'The current question always has priority over earlier conversation.',
    'Distinguish OBSERVED DATA from BUSINESS HYPOTHESIS. Events, users, file types, devices, operating systems, locations, and timing are observed. Product fit and advertising recommendations are hypotheses to test.',
    'Never invent revenue, price, demographics, conversion rate, ad clicks, cost-per-click, purchase intent, company size, industry, income, age, gender, or any other fact not present in the evidence.',
    'Never infer sensitive traits.',
    'Never claim that a large audience will buy a product. Say test, investigate, compare, or validate.',
    'Do not expose raw user names, transfer IDs, room IDs, IP addresses, or any personal identifiers.',
    'Do not use internal 0-100 heuristic scores in the answer.',
    'When a named product appears in the question, analyze that product even if another product ranks higher in generic heuristics.',
    'When a named market appears, address that market directly and compare it with alternatives only when useful.',
    'When the evidence cannot support the requested conclusion, say exactly what AirGesture can support and what additional data would be needed.',
    'Prefer a specific answer over generic management language. Use concrete aggregate counts/shares/locations when they matter.',
    'Keep the direct answer concise; use the structured fields for evidence, recommendation, test, channel, and limitation.'
  ].join(' ');
}

async function generateAiStrategyAnswer(input = {}) {
  const question = String(input.question || '').trim().slice(0, 500);
  const apiKey = String(input.apiKey || '').trim();
  const model = String(input.model || 'gpt-5.6').trim();
  const snapshot = input.snapshot || {};
  const history = normalizeAiHistory(input.history || []);

  if (!question) {
    throw new Error('A strategy question is required.');
  }

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (!globalThis.fetch) {
    throw new Error('Server fetch is unavailable.');
  }

  const evidence = buildAiEvidencePackage(snapshot);
  const conversation = history.map((message) => ({
    role: message.role,
    content: message.content
  }));

  conversation.push({
    role: 'user',
    content: JSON.stringify({
      currentQuestion: question,
      currentFilters: snapshot?.filters || {},
      aggregateAirGestureEvidence: evidence
    })
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: instructions(),
        input: conversation,
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'airgesture_strategy_answer',
            description: 'A grounded strategic answer to the exact AirGesture business question.',
            strict: true,
            schema: ANSWER_SCHEMA
          }
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI ${response.status}: ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const outputText = extractOutputText(payload);

    if (!outputText) {
      throw new Error('OpenAI returned no strategy answer.');
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error('OpenAI returned an invalid structured strategy answer.');
    }

    const strategy = normalizeStructuredAiAnswer(parsed, snapshot, question);

    if (!strategy.directAnswer) {
      throw new Error('OpenAI strategy answer did not contain a direct answer.');
    }

    return {
      strategy,
      ai: {
        configured: true,
        used: true,
        provider: 'OpenAI + AirGesture Grounding',
        model,
        source: 'generative-ai'
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ANSWER_SCHEMA,
  extractOutputText,
  generateAiStrategyAnswer
};
