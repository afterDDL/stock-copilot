'use client';

import type { FormEvent, KeyboardEvent } from 'react';
import type { ChatMessage, Clarification } from '../hooks/use-copilot';

type Props = {
  messages: ChatMessage[]; draft: string; busy: boolean; error: string | null; clarification: Clarification | null;
  busyText?: string;
  onDraftChange(value: string): void; onSubmit(): void; onClarificationAnswer(index: number, answer: string): void; onSubmitClarification(): void;
};

export function ChatPanel({ messages, draft, busy, busyText = '正在整理你的筛选条件…', error, clarification, onDraftChange, onSubmit, onClarificationAnswer, onSubmitClarification }: Props) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy) onSubmit(); }
  };
  return <section className="card chat-panel" aria-labelledby="chat-heading">
    <div className="section-heading"><div><p className="eyebrow">从一句话开始</p><h2 id="chat-heading">选股对话</h2></div><span className="quiet-pill">银行股 · P0</span></div>
    <div className="conversation" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 ? <div className="conversation-empty"><div className="sparkle">✳</div><p>描述你想找的银行股</p><span>例如：找市值在 1000 亿元以上、利润正增长的银行。</span></div> : messages.map((message) =>
        <article className={`message message-${message.role} ${message.kind === 'error' ? 'message-error' : ''}`} key={message.id}><p>{message.text}</p></article>)}
      {busy && <p className="working-note" role="status">{busyText}</p>}
    </div>
    {clarification && <section className="clarification" aria-labelledby="clarification-heading"><h3 id="clarification-heading">请补充以下信息</h3><div className="clarification-prompts">{clarification.prompts.map((item, index) => <label className="clarification-field" key={item.id} htmlFor={item.id}><span>澄清回答 {index + 1}：{item.prompt}</span><input id={item.id} value={item.answer} onChange={(event) => onClarificationAnswer(index, event.target.value)} placeholder="输入你的条件" disabled={busy} /></label>)}</div><button className="secondary-button clarification-submit" type="button" onClick={onSubmitClarification} disabled={busy || clarification.prompts.some((item) => !item.answer.trim())}>提交补充说明</button></section>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="intent-draft">请输入选股需求</label>
      <textarea id="intent-draft" aria-label="请输入选股需求" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={keyDown} placeholder="描述你的选股想法…" rows={2} />
      <div className="composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><button className="primary-button" type="submit" disabled={!draft.trim() || busy}>{busy ? '处理中…' : '发送'}</button></div>
    </form>
  </section>;
}
