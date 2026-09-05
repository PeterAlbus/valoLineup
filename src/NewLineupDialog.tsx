import { useEffect, useMemo, useState } from 'react';

type MapOption = { id: string; name: string; sites: { label: string }[] };
type AgentOption = { id: string; name: string; icon: string; abilities: { id: string; name: string; icon: string }[] };

export type NewLineupInput = {
  mapId: string;
  agentId: string;
  abilityId: string;
  side: 'attack' | 'defense';
  area: string;
  title: string;
  videoBvid: string;
  instructions: string;
};

type Props = {
  maps: MapOption[];
  agents: AgentOption[];
  initialMapId: string;
  initialAgentId: string;
  initialAbilityId?: string;
  initialSide: 'attack' | 'defense';
  onCancel: () => void;
  onPlace: (input: NewLineupInput) => void;
};

export default function NewLineupDialog({ maps, agents, initialMapId, initialAgentId, initialAbilityId, initialSide, onCancel, onPlace }: Props) {
  const firstAgent = agents.find((agent) => agent.id === initialAgentId) ?? agents[0];
  const [mapId, setMapId] = useState(initialMapId);
  const [agentId, setAgentId] = useState(firstAgent.id);
  const [abilityId, setAbilityId] = useState(
    firstAgent.abilities.some((ability) => ability.id === initialAbilityId) ? initialAbilityId! : firstAgent.abilities[0].id,
  );
  const [side, setSide] = useState<'attack' | 'defense'>(initialSide);
  const [area, setArea] = useState(`${maps.find((map) => map.id === initialMapId)?.sites[0]?.label ?? 'A'}点`);
  const [title, setTitle] = useState('');
  const [videoBvid, setVideoBvid] = useState('');
  const [instructions, setInstructions] = useState('');
  const activeAgent = useMemo(() => agents.find((agent) => agent.id === agentId) ?? agents[0], [agentId, agents]);
  const activeAbility = activeAgent.abilities.find((ability) => ability.id === abilityId) ?? activeAgent.abilities[0];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section aria-labelledby="new-lineup-title" aria-modal="true" className="new-lineup-dialog" role="dialog">
        <div className="dialog-heading">
          <div><p className="eyebrow">浏览器草稿</p><h2 id="new-lineup-title">新增 Lineup 点位</h2></div>
          <button aria-label="关闭新增点位窗口" onClick={onCancel} type="button">×</button>
        </div>
        <p className="dialog-intro">先定义点位内容，下一步到地图上点击技能最终落点。坐标不会使用默认值。</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onPlace({
              mapId,
              agentId,
              abilityId,
              side,
              area: area.trim(),
              title: title.trim(),
              videoBvid: videoBvid.trim(),
              instructions: instructions.trim(),
            });
          }}
        >
          <div className="form-grid">
            <label>
              <span>地图</span>
              <select
                onChange={(event) => {
                  const nextMapId = event.target.value;
                  setMapId(nextMapId);
                  setArea(`${maps.find((map) => map.id === nextMapId)?.sites[0]?.label ?? 'A'}点`);
                }}
                value={mapId}
              >
                {maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
              </select>
            </label>
            <label>
              <span>阵营</span>
              <select onChange={(event) => setSide(event.target.value as 'attack' | 'defense')} value={side}>
                <option value="attack">进攻</option>
                <option value="defense">防守</option>
              </select>
            </label>
          </div>

          <label>
            <span>英雄 · 共 {agents.length} 位</span>
            <select
              onChange={(event) => {
                const nextAgent = agents.find((agent) => agent.id === event.target.value) ?? agents[0];
                setAgentId(nextAgent.id);
                setAbilityId(nextAgent.abilities[0].id);
              }}
              value={agentId}
            >
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>

          <label>
            <span>技能</span>
            <select onChange={(event) => setAbilityId(event.target.value)} value={abilityId}>
              {activeAgent.abilities.map((ability) => <option key={ability.id} value={ability.id}>{ability.name}</option>)}
            </select>
          </label>

          <div className="selection-preview">
            <img alt="" src={`${import.meta.env.BASE_URL}${activeAgent.icon}`} />
            <span><small>{activeAgent.name}</small><b>{activeAbility.name}</b></span>
            <img alt="" src={`${import.meta.env.BASE_URL}${activeAbility.icon}`} />
          </div>

          <div className="form-grid">
            <label>
              <span>区域</span>
              <input maxLength={40} onChange={(event) => setArea(event.target.value)} placeholder="例如：A点、B大、中路" required value={area} />
              <span className="area-shortcuts">{['A点', 'B点', ...(maps.find((map) => map.id === mapId)?.sites.some((site) => site.label === 'C') ? ['C点'] : [])].map((value) => <button key={value} type="button" aria-pressed={area === value} onClick={() => setArea(value)}>{value}</button>)}</span>
            </label>
            <label>
              <span>点位标题</span>
              <input maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="描述技能最终效果或用途" required value={title} />
            </label>
          </div>

          <label>
            <span>B站教学视频 BV 号 <small>可选</small></span>
            <input
              maxLength={12}
              onChange={(event) => setVideoBvid(event.target.value.trim())}
              pattern="BV[0-9A-Za-z]{10}"
              placeholder="BV17x411w7KC"
              title="请输入以 BV 开头的 12 位 BV 号"
              value={videoBvid}
            />
          </label>

          <label>
            <span>操作说明 <small>可选，每行一条</small></span>
            <textarea maxLength={1000} onChange={(event) => setInstructions(event.target.value)} placeholder={'确认站位后瞄准墙面标记\n释放技能后覆盖入口区域'} rows={3} value={instructions} />
          </label>

          <div className="dialog-footer">
            <p>创建后仍是浏览器草稿，可以继续拖动并添加图片；点击保存编辑后刷新仍保留，也可统一导出编辑包。</p>
            <div><button className="dialog-cancel" onClick={onCancel} type="button">取消</button><button className="dialog-next" type="submit">下一步：在地图上放置</button></div>
          </div>
        </form>
      </section>
    </div>
  );
}
