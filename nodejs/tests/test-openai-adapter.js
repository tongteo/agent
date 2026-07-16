/**
 * @fileoverview Tests for OpenAIAdapter — error handling, SSE parsing, silent failure detection.
 *
 * Tests that when the API returns a non-SSE body (e.g. JSON error in HTTP 200),
 * the adapter throws instead of silently returning empty response.
 *
 * Uses adapter option `fetch` for mock injection (see openai-adapter.js constructor).
 */

const { Readable } = require('stream');

/**
 * Build a mock HTTP response with a given body and status.
 */
function mockResponse(body, status = 200) {
  const buf = Buffer.from(body);
  const stream = new Readable({
    read() {
      this.push(buf);
      this.push(null);
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

const AdapterClass = () => require('../src/models/openai-adapter').OpenAIAdapter;

describe('OpenAIAdapter SSE parsing', () => {

  it('throws on non-SSE JSON error body (HTTP 200)', async () => {
    const errorBody = JSON.stringify({
      error: { message: 'Maximum combo retry limit reached', type: 'server_error' },
    });
    const mockFetch = () => Promise.resolve(mockResponse(errorBody, 200));

    const adapter = new (AdapterClass())({
      apiKey: 'sk-test',
      baseUrl: 'http://mock/v1',
      model: 'test-model',
      cacheEnabled: false,
      maxRetries: 0,
      fetch: mockFetch,
    });

    adapter.messages.push({ role: 'user', content: 'hello' });
    const chunks = [];
    let error = null;
    try {
      for await (const chunk of adapter.streamMessage()) {
        chunks.push(chunk);
      }
    } catch (e) {
      error = e;
    }

    adapter.cleanup();
    assert.ok(error, 'Expected an error to be thrown');
    assert.match(error.message, /non-SSE response/);
    assert.match(error.message, /Maximum combo retry limit reached/);
    assert.strictEqual(chunks.length, 0);
  });

  it('throws on empty non-SSE body (no data lines)', async () => {
    const adapter = new (AdapterClass())({
      apiKey: 'sk-test',
      baseUrl: 'http://mock/v1',
      model: 'test-model',
      cacheEnabled: false,
      maxRetries: 0,
      fetch: () => Promise.resolve(mockResponse('OK', 200)),
    });

    adapter.messages.push({ role: 'user', content: 'hello' });
    const chunks = [];
    let error = null;
    try {
      for await (const chunk of adapter.streamMessage()) {
        chunks.push(chunk);
      }
    } catch (e) {
      error = e;
    }

    adapter.cleanup();
    assert.ok(error, 'Expected an error to be thrown');
    assert.match(error.message, /no SSE data received/);
    assert.strictEqual(chunks.length, 0);
  });

  it('throws on HTTP 404 with JSON error body', async () => {
    const errorBody = JSON.stringify({
      error: { message: 'model_not_found', type: 'invalid_request_error' },
    });
    const adapter = new (AdapterClass())({
      apiKey: 'sk-test',
      baseUrl: 'http://mock/v1',
      model: 'test-model',
      cacheEnabled: false,
      maxRetries: 0,
      fetch: () => Promise.resolve(mockResponse(errorBody, 404)),
    });

    adapter.messages.push({ role: 'user', content: 'hello' });
    const chunks = [];
    let error = null;
    try {
      for await (const chunk of adapter.streamMessage()) {
        chunks.push(chunk);
      }
    } catch (e) {
      error = e;
    }

    adapter.cleanup();
    assert.ok(error, 'Expected an error to be thrown');
    assert.match(error.message, /API error 404/);
    assert.strictEqual(chunks.length, 0);
  });

  it('yields text from a valid SSE stream', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const adapter = new (AdapterClass())({
      apiKey: 'sk-test',
      baseUrl: 'http://mock/v1',
      model: 'test-model',
      cacheEnabled: false,
      maxRetries: 0,
      fetch: () => Promise.resolve(mockResponse(sseBody, 200)),
    });

    adapter.messages.push({ role: 'user', content: 'hi' });
    const chunks = [];
    let error = null;
    try {
      for await (const chunk of adapter.streamMessage()) {
        chunks.push(chunk);
      }
    } catch (e) {
      error = e;
    }

    adapter.cleanup();
    assert.ok(!error, `Unexpected error: ${error?.message}`);
    assert.strictEqual(chunks.join(''), 'Hello world');
  });

});
