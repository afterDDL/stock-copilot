'use client';

import { useState } from 'react';
import type { SavedStrategySummary } from '../lib/storage/strategies';

type Props = { entries: SavedStrategySummary[]; currentId?: string | null; canSave: boolean; onSave(name?: string, id?: string): SavedStrategySummary | null | void; onLoad(id: string): void; onDelete(id: string): void };
export function SavedStrategies({ entries, currentId, canSave, onSave, onLoad, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(currentId ?? null);
  const submit = () => {
    const existing = entries.find((entry) => entry.id === selectedId);
    if (existing && !window.confirm(`更新「${existing.name}」的内容？`)) return;
    const saved = onSave(name.trim() || undefined, selectedId ?? undefined);
    if (saved) setSelectedId(saved.id);
    setName('');
  };
  return <div className="saved-strategies">
    <button className="saved-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}><span>已保存策略</span><span className="saved-count">{entries.length}</span><span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>
    {expanded && <div className="saved-menu">
      <label htmlFor="save-strategy-name">保存名称</label><input id="save-strategy-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="使用当前策略名称" />
      <button className="secondary-button save-action" type="button" disabled={!canSave} onClick={submit}>保存策略</button>
      {entries.length === 0 ? <p className="muted-copy saved-empty">还没有保存的策略。</p> : <ul>{entries.map((entry) => <li key={entry.id} className="saved-entry">
        <button type="button" className="saved-load" onClick={() => { setSelectedId(entry.id); onLoad(entry.id); }}><span>{entry.name}</span><small>更新于 {new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</small></button>
        <button type="button" aria-label={`删除${entry.name}`} className="icon-button saved-delete" onClick={() => { if (window.confirm(`删除「${entry.name}」？`)) onDelete(entry.id); }}>删除</button>
      </li>)}</ul>}
    </div>}
  </div>;
}
