const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAutodartsState,
  parseSegmentScore,
  isAllowedPrivateHost
} = require('../public/normalize');

test('normalizeAutodartsState handles takeout in progress', () => {
  const normalized = normalizeAutodartsState({
    connected: true,
    running: true,
    status: 'Takeout in progress',
    event: 'Takeout started',
    numThrows: 0
  });

  assert.equal(normalized.connected, true);
  assert.equal(normalized.running, true);
  assert.equal(normalized.phase, 'takeout');
  assert.equal(normalized.takeoutActive, true);
  assert.equal(normalized.handDetected, true);
  assert.equal(normalized.numThrows, 0);
  assert.deepEqual(normalized.throws, []);
  assert.equal(normalized.visitScore, 0);
});

test('normalizeAutodartsState handles throw detected with segment and coords', () => {
  const normalized = normalizeAutodartsState({
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Throw detected',
    throws: [
      { segment: { name: 'T20' }, coords: { x: 12.3, y: -4.2 } }
    ]
  });

  assert.equal(normalized.phase, 'dart-detected');
  assert.equal(normalized.numThrows, 1);
  assert.equal(normalized.throws[0].segmentName, 'T20');
  assert.equal(normalized.throws[0].score, 60);
  assert.equal(normalized.throws[0].x, 12.3);
  assert.equal(normalized.throws[0].y, -4.2);
  assert.equal(normalized.visitScore, 60);
});

test('normalizeAutodartsState handles stopped board', () => {
  const normalized = normalizeAutodartsState({
    connected: false,
    running: false,
    status: 'Stopped',
    event: 'Board stopped',
    numThrows: 0
  });

  assert.equal(normalized.phase, 'offline');
  assert.equal(normalized.takeoutActive, false);
  assert.equal(normalized.numThrows, 0);
});

test('normalizeAutodartsState treats takeout finished as inactive', () => {
  const normalized = normalizeAutodartsState({
    connected: true,
    running: true,
    status: 'Throw',
    event: 'Takeout finished',
    numThrows: 0
  });

  assert.equal(normalized.phase, 'throwing');
  assert.equal(normalized.takeoutActive, false);
  assert.equal(normalized.handDetected, false);
});

test('parseSegmentScore parses common dart segment names', () => {
  assert.equal(parseSegmentScore('T20'), 60);
  assert.equal(parseSegmentScore('D16'), 32);
  assert.equal(parseSegmentScore('S5'), 5);
  assert.equal(parseSegmentScore('Bull'), 50);
  assert.equal(parseSegmentScore('S25'), 25);
  assert.equal(parseSegmentScore('Miss'), 0);
});

test('isAllowedPrivateHost allows only local or private hosts', () => {
  assert.equal(isAllowedPrivateHost('192.168.2.107'), true);
  assert.equal(isAllowedPrivateHost('localhost'), true);
  assert.equal(isAllowedPrivateHost('8.8.8.8'), false);
  assert.equal(isAllowedPrivateHost('example.com'), false);
});
