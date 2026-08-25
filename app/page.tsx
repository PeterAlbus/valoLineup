'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import content from './data/content.json';

type MediaItem = { src: string; alt: string };
type Lineup = {
  id: string;
  mapId: string;
  agentId: string;
  abilityId: string;
  title: string;
  side: 'attack' | 'defense';
  area: string;
  target: { groupId: string; x: number; y: number };
  technique: { charge?: 'none' | 'one' | 'two' | 'full'; bounce?: number; jump?: boolean; instructions: string[] };
  media: { stance: MediaItem[]; aim: MediaItem[]; effect: MediaItem[] };
  source: { kind: string; reference: string };
};

const maps = content.maps;
const agents = content.agents;
const lineups = content.lineups as Lineup[];

const chargeLabels = { none: '无蓄力', one: '一格', two: '两格', full: '满格' };
const sideLabels = { attack: '进攻', defense: '防守' };

function techniqueSummary(lineup: Lineup) {
  const parts = [];
  if (lineup.technique.charge) parts.push(chargeLabels[lineup.technique.charge]);
  if (lineup.technique.bounce !== undefined) parts.push(`${lineup.technique.bounce} 次反弹`);
  if (lineup.technique.jump) parts.push('跳射');
  return parts.join(' · ') || '查看操作说明';
}

function mediaSections(lineup: Lineup) {
  return [
    { id: 'stance', index: '01', label: '站位', items: lineup.media.stance },
    { id: 'aim', index: '02', label: '瞄点', items: lineup.media.aim },
    { id: 'effect', index: '03', label: '道具效果', items: lineup.media.effect },
  ];
}

export default function Home() {
  const [selectedMapId, setSelectedMapId] = useState('ascent');
  const [selectedAgentId, setSelectedAgentId] = useState('sova');
  const [selectedGroupId, setSelectedGroupId] = useState('a-site-scan');
  const [selectedLineupId, setSelectedLineupId] = useState('ascent-sova-01');

  const activeMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];
  const mapLineups = lineups.filter((lineup) => lineup.mapId === selectedMapId);
  const agentLineups = mapLineups.filter((lineup) => lineup.agentId === selectedAgentId);
  const availableAgents = agents.filter((agent) => mapLineups.some((lineup) => lineup.agentId === agent.id));

  const grouped = new Map<string, Lineup[]>();
  for (const lineup of agentLineups) {
    const list = grouped.get(lineup.target.groupId) ?? [];
    list.push(lineup);
    grouped.set(lineup.target.groupId, list);
  }
  const groups = [...grouped.entries()].map(([id, items]) => ({
    id,
    items,
    x: items.reduce((sum, lineup) => sum + lineup.target.x, 0) / items.length,
    y: items.reduce((sum, lineup) => sum + lineup.target.y, 0) / items.length,
  }));

  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  const activeLineup = activeGroup?.items.find((lineup) => lineup.id === selectedLineupId) ?? activeGroup?.items[0];
  const activeAgent = agents.find((agent) => agent.id === selectedAgentId) ?? availableAgents[0] ?? agents[0];
  const activeAbility = activeAgent?.abilities.find((ability) => ability.id === activeLineup?.abilityId);

  function selectMap(mapId: string) {
    const nextLineups = lineups.filter((lineup) => lineup.mapId === mapId);
    const first = nextLineups[0];
    setSelectedMapId(mapId);
    if (first) {
      setSelectedAgentId(first.agentId);
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    } else {
      setSelectedGroupId('');
      setSelectedLineupId('');
    }
  }

  function selectAgent(agentId: string) {
    const first = mapLineups.find((lineup) => lineup.agentId === agentId);
    setSelectedAgentId(agentId);
    if (first) {
      setSelectedGroupId(first.target.groupId);
      setSelectedLineupId(first.id);
    }
  }

  function selectGroup(group: (typeof groups)[number]) {
    setSelectedGroupId(group.id);
    setSelectedLineupId(group.items[0].id);
  }

  return (
    <main className="app-shell">
      <aside className="map-rail" aria-label="地图选择">
        <div className="brand-mark" aria-label="Lineup Atlas"><span>LA</span></div>
        <p className="eyebrow rail-label">地图</p>
        <div className="map-list">
          {maps.map((map) => {
            const count = lineups.filter((lineup) => lineup.mapId === map.id).length;
            return (
              <button
                aria-pressed={map.id === selectedMapId}
                className={`map-card ${map.id === selectedMapId ? 'is-active' : ''}`}
                key={map.id}
                onClick={() => selectMap(map.id)}
                type="button"
              >
                <span className="map-thumb"><img alt="" src={map.image} /></span>
                <span className="map-name">{map.name}</span>
                <span className="map-count">{String(count).padStart(2, '0')}</span>
              </button>
            );
          })}
        </div>
        <div className="rail-footer">
          <span className="status-dot" />
          <p>非官方玩家项目<br />当前收录 {lineups.length} 条 Lineup</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">无畏契约 · LINEUP 图鉴</p>
            <h1>{activeMap.name}</h1>
          </div>
          <div className="agent-tabs" aria-label="英雄选择">
            {availableAgents.map((agent) => {
              const count = mapLineups.filter((lineup) => lineup.agentId === agent.id).length;
              return (
                <button
                  aria-pressed={agent.id === selectedAgentId}
                  className={`agent-tab ${agent.id === selectedAgentId ? 'is-active' : ''}`}
                  key={agent.id}
                  onClick={() => selectAgent(agent.id)}
                  type="button"
                >
                  <img alt={agent.name} src={agent.icon} />
                  <span><b>{agent.name}</b><small>{count} 个点位</small></span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="content-grid">
          <section className="map-panel" aria-label={`${activeMap.name} Lineup 地图`}>
            <div className="panel-heading">
              <div><p className="eyebrow">技能最终落点</p><h2>{groups.length ? '选择地图上的标记' : '等待点位数据'}</h2></div>
              <div className="legend"><span /> {activeAgent?.name ?? '未选择英雄'} · {groups.length} 个落点</div>
            </div>

            <div className="map-stage">
              <div className="map-grid" />
              <div className="map-canvas">
                <img className="map-image" alt={`${activeMap.name}俯视地图`} src={activeMap.image} />
                {groups.map((group, index) => {
                  const representative = group.items[0];
                  const ability = activeAgent?.abilities.find((item) => item.id === representative.abilityId);
                  return (
                    <button
                      aria-label={`${representative.area}，${representative.title}，${group.items.length} 种 Lineup`}
                      aria-pressed={group.id === activeGroup?.id}
                      className={`lineup-pin ${group.id === activeGroup?.id ? 'is-active' : ''}`}
                      key={group.id}
                      onClick={() => selectGroup(group)}
                      style={{ left: `${group.x * 100}%`, top: `${group.y * 100}%` }}
                      type="button"
                    >
                      <span className="pin-pulse" />
                      <img alt="" src={ability?.icon ?? activeAgent.icon} />
                      <i>{String(index + 1).padStart(2, '0')}</i>
                      {group.items.length > 1 ? <b>{group.items.length}</b> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="detail-panel" aria-live="polite">
            {activeLineup && activeGroup ? (
              <>
                {activeGroup.items.length > 1 ? (
                  <section className="method-picker" aria-label="相同落点的 Lineup 方法">
                    <div className="method-heading"><p className="eyebrow">同一落点</p><span>{activeGroup.items.length} 种方法</span></div>
                    <div className="method-list">
                      {activeGroup.items.map((lineup, index) => (
                        <button
                          aria-pressed={lineup.id === activeLineup.id}
                          className={lineup.id === activeLineup.id ? 'is-active' : ''}
                          key={lineup.id}
                          onClick={() => setSelectedLineupId(lineup.id)}
                          type="button"
                        >
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <span><b>方法 {index + 1}</b><small>{techniqueSummary(lineup)}</small></span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="detail-kicker">
                  <img alt="" src={activeAbility?.icon ?? activeAgent.icon} />
                  <span>{activeAbility?.name} · {sideLabels[activeLineup.side]} · {activeLineup.area}</span>
                </div>
                <h2>{activeLineup.title}</h2>
                <p className="detail-lead">{activeLineup.technique.instructions[0] || '按图确认站位和瞄点后释放技能。'}</p>
                <div className="technique-row">
                  <span><small>蓄力</small>{activeLineup.technique.charge ? chargeLabels[activeLineup.technique.charge] : '未注明'}</span>
                  <span><small>反弹</small>{activeLineup.technique.bounce !== undefined ? `${activeLineup.technique.bounce} 次` : '未注明'}</span>
                  <span><small>方式</small>{activeLineup.technique.jump ? '跳射' : '站立'}</span>
                </div>

                {mediaSections(activeLineup).map((section) => section.items.length ? (
                  <section className="media-section" key={section.id}>
                    <p><span>{section.index}</span>{section.label}</p>
                    {section.items.map((item) => <img alt={item.alt} key={item.src} loading="lazy" src={item.src} />)}
                  </section>
                ) : null)}

                {!activeLineup.media.effect.length ? (
                  <section className="effect-preview">
                    <p><span>03</span>效果落点</p>
                    <div>
                      <img alt="" className="effect-map" src={activeMap.image} />
                      <i style={{ left: `${21.875 + activeLineup.target.x * 56.25}%`, top: `${activeLineup.target.y * 100}%` }} />
                      <strong>当前资料未包含游戏内效果截图</strong>
                    </div>
                  </section>
                ) : null}

                <p className="source-note">资料来源：先锋.md · 构建时已转换并校验</p>
              </>
            ) : (
              <div className="empty-state"><span>00</span><h2>暂无已整理点位</h2><p>该地图已经进入资料库，但当前 Markdown 尚未提供可转换的完整 Lineup。</p></div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
