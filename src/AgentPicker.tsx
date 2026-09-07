import { useRef, useState } from 'react';

type Agent = { id: string; name: string; icon: string; abilities: { id: string; name: string; icon: string }[] };

export default function AgentPicker({ agents, agentId, abilityId, onChange }: {
  agents: Agent[];
  agentId: string;
  abilityId: string;
  onChange: (fields: { agentId?: string; abilityId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const agent = agents.find((item) => item.id === agentId)!;
  const asset = (key: string) => `${import.meta.env.BASE_URL}${key}`;
  return <div className="agent-picker">
    <span className="field-label">英雄</span>
    <button ref={toggle} className="agent-picker-toggle" aria-expanded={open} aria-controls="agent-picker-grid" onClick={() => setOpen(!open)} type="button">
      <img src={asset(agent.icon)} alt="" /><span>{agent.name}</span><small>{open ? '收起' : '更换英雄'}</small>
    </button>
    {open ? <div id="agent-picker-grid" className="agent-picker-grid" role="group" aria-label="选择英雄">
      {agents.map((item) => <button type="button" key={item.id} aria-label={item.name} aria-pressed={item.id === agentId} onClick={() => {
        if (item.id !== agentId) onChange({ agentId: item.id, abilityId: item.abilities[0].id });
        setOpen(false);
        toggle.current?.focus({ preventScroll: true });
      }}><img src={asset(item.icon)} alt="" /><span>{item.name}</span></button>)}
    </div> : null}
    <span className="field-label">技能</span>
    <div className="ability-picker" role="group" aria-label="选择技能">
      {agent.abilities.map((ability) => <button type="button" key={ability.id} aria-pressed={ability.id === abilityId} onClick={() => onChange({ abilityId: ability.id })}>
        <img src={asset(ability.icon)} alt="" /><span>{ability.name}</span>
      </button>)}
    </div>
  </div>;
}
