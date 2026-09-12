// Synthetic records only. Never seed scenarios from the live lineup library.
export function makeLineup(overrides = {}) {
  return structuredClone({
    id: 'test-primary', mapId: 'ascent', agentId: 'sova', abilityId: 'recon-bolt',
    uploader: { name: 'Fixture Author', source: 'curated', bilibiliUid: '2003822' },
    title: '测试落点', side: 'attack', area: 'A点', videoBvid: 'BV17x411w7KC',
    target: { groupId: 'test-shared', x: .25, y: .3 }, instructions: '固定测试说明',
    media: { stance: [], aim: [], effect: [] }, ...overrides,
  });
}

export function makeLineups() {
  return [
    makeLineup({ videoBvid: '' }),
    makeLineup({ id: 'test-shared-second', title: '第二种方法', instructions: '第二种固定说明' }),
    makeLineup({ id: 'test-shared-third', title: '第三种方法' }),
    makeLineup({ id: 'test-independent', target: { groupId: 'test-independent', x: .7, y: .6 }, videoBvid: '' }),
    makeLineup({ id: 'test-other-map', mapId: 'bind', uploader: { name: 'Another Author', source: 'local' }, target: { groupId: 'test-shared', x: .3, y: .2 } }),
  ];
}
