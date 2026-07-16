/**
 * Regression test: streaming chunks must not lose whitespace.
 *
 * Bug: filterWarning() called .trim() on every chunk, stripping the
 * leading space that separates words during streaming. Result:
 * "Tôi" + " sẽ" → "Tôisẽ" instead of "Tôi sẽ".
 */

const { MessageHandler } = require('../src/core/message');

async function testStreamingSpacesPreserved() {
    let passed = 0;
    let failed = 0;

    const assert = (cond, msg) => {
        if (cond) { passed++; }
        else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
    };

    // Mock model that streams chunks with leading spaces
    const mockModel = {
        messages: [],
        lastUsage: null,
        pendingToolCalls: null,
        async *streamMessage() {
            yield 'Tôi';
            yield ' sẽ';
            yield ' viết';
            yield ' code';
            yield ' C++';
            yield ' giải';
            yield ' bài';
            yield ' toán';
            yield ' 8';
            yield ' Queens';
            yield '\n';
            yield 'Bây';
            yield ' giờ';
            yield ' tôi';
            yield ' sẽ';
            yield ' compile';
        },
        reset() { this.messages = []; },
    };

    const session = { workingDir: '/tmp', load() {}, reset() {} };
    const handler = new MessageHandler(mockModel, session);

    const chunks = [];
    const full = await handler.stream((chunk) => { chunks.push(chunk); });

    // Full text should preserve spaces
    const expected = 'Tôi sẽ viết code C++ giải bài toán 8 Queens\nBây giờ tôi sẽ compile';
    assert(full === expected, `Full text mismatch.\n  Expected: ${JSON.stringify(expected)}\n  Got:      ${JSON.stringify(full)}`);

    // Individual chunks should not be trimmed
    assert(chunks[0] === 'Tôi', `chunks[0] should be "Tôi", got ${JSON.stringify(chunks[0])}`);
    assert(chunks[1] === ' sẽ', `chunks[1] should be " sẽ", got ${JSON.stringify(chunks[1])}`);
    assert(chunks[2] === ' viết', `chunks[2] should be " viết", got ${JSON.stringify(chunks[2])}`);

    console.log(`  Streaming spaces: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

async function testSystemReminderStripped() {
    let passed = 0;
    let failed = 0;

    const assert = (cond, msg) => {
        if (cond) { passed++; }
        else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
    };

    const mockModel = {
        messages: [],
        lastUsage: null,
        pendingToolCalls: null,
        async *streamMessage() {
            yield 'Hello ';
            yield 'The <system_reminder>blah</system_reminder> Ignoring it and continuing.';
            yield ' world';
            yield '!';
        },
        reset() { this.messages = []; },
    };

    const session = { workingDir: '/tmp', load() {}, reset() {} };
    const handler = new MessageHandler(mockModel, session);

    const full = await handler.stream(() => {});

    // The system_reminder pattern should be stripped, spaces preserved
    assert(full === 'Hello  world!', `Should strip system_reminder but keep spaces. Got: ${JSON.stringify(full)}`);

    console.log(`  System reminder filter: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Run tests
(async () => {
    console.log('--- message.js streaming tests ---');
    let allPassed = true;
    allPassed = await testStreamingSpacesPreserved() && allPassed;
    allPassed = await testSystemReminderStripped() && allPassed;
    console.log(allPassed ? '\n  All passed ✓' : '\n  Some tests failed ✗');
})();
