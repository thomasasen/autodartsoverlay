const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSubnetCandidates,
  getLocalPrivateIpv4Interfaces,
  createDiscoveryTargets
} = require('../server');

test('createSubnetCandidates creates a private /24 target list', () => {
  const targets = createSubnetCandidates('192.168.2.107');

  assert.equal(targets.length, 254);
  assert.equal(targets[0], '192.168.2.1');
  assert.equal(targets[106], '192.168.2.107');
  assert.equal(targets[253], '192.168.2.254');
});

test('createSubnetCandidates rejects non-private hosts', () => {
  assert.deepEqual(createSubnetCandidates('8.8.8.8'), []);
  assert.deepEqual(createSubnetCandidates('example.com'), []);
});

test('getLocalPrivateIpv4Interfaces ignores public and internal interfaces', () => {
  const interfaces = getLocalPrivateIpv4Interfaces({
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.2.10' },
      { family: 'IPv4', internal: false, address: '8.8.8.8' },
      { family: 'IPv4', internal: true, address: '127.0.0.1' }
    ]
  });

  assert.deepEqual(interfaces, [
    { name: 'Ethernet', address: '192.168.2.10', prefix: '192.168.2.0/24' }
  ]);
});

test('createDiscoveryTargets deduplicates overlapping interface subnets', () => {
  const result = createDiscoveryTargets({
    Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.2.10' }],
    WiFi: [{ family: 'IPv4', internal: false, address: '192.168.2.20' }]
  });

  assert.equal(result.interfaces.length, 2);
  assert.equal(result.targets.length, 254);
});
