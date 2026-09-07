type AgentChoice = { id: string; name: string; icon: string; count: number };

export default function MobileAgentSelect({ agents, value, disabled, onChange }: {
  agents: AgentChoice[]; value: string; disabled: boolean; onChange: (id: string) => void;
}) {
  const selected = agents.find((agent) => agent.id === value);
  const placeholder = agents.length ? '选择英雄' : '暂无英雄';
  return <div className="mobile-agent-select">
    <div className="mobile-agent-current" aria-hidden="true">
      {selected ? <img alt="" src={`${import.meta.env.BASE_URL}${selected.icon}`} /> : null}
      <span><b>{selected?.name ?? placeholder}</b>{selected ? <small>{selected.count} 个点位</small> : null}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" /></svg>
    </div>
    <select aria-label="选择英雄" value={selected?.id ?? ''} disabled={disabled || !agents.length} onChange={(event) => onChange(event.target.value)}>
      {!selected ? <option value="" disabled>{placeholder}</option> : null}
      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.count} 个点位</option>)}
    </select>
  </div>;
}
