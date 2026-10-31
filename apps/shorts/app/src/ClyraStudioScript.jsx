import React from 'react';
import './clyra-source/studioStyles.css';
import './clyra-studio-script.css';

const Icon = ({ name, size }) => <svg className={`i ${size || ''}`} aria-hidden="true"><use href={`#clyra-script-${name}`}/></svg>;
const ScriptIcons = () => <svg xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true"><defs>
  <symbol id="clyra-script-swap" viewBox="0 0 24 24"><path d="M7 7h14m-4-4 4 4-4 4M17 17H3m4-4-4 4 4 4"/></symbol>
  <symbol id="clyra-script-trash" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6"/></symbol>
  <symbol id="clyra-script-music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/></symbol>
  <symbol id="clyra-script-message" viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V7a2 2 0 0 1 2-2Z"/><path d="M8 10h8m-8 4h6"/></symbol>
  <symbol id="clyra-script-image" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></symbol>
  <symbol id="clyra-script-send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></symbol>
</defs></svg>;

// The live Clyra CreatorStudio renderScript/messageList markup and source
// classes, with state supplied by Shorts rather than studioEngine's closure.
export default function ClyraStudioScript({ name, onName, messages, onMessage, onSwapMessage, onDeleteMessage, onSwapAll, onDeleteAll, onImport, onAI, onAddImage, busy, side, onSide, composer, onComposer, onSubmit, onAdd, onReorder, dragFrom, confirmClear, onConfirmClear }) {
  const profile = name.trim() || 'Unknown';
  return <div className="cs-root fts-source"><ScriptIcons/><div className="editor"><div className="inner">
    <header className="pagehead"><h1>Text Script</h1><div className="topButtons"><button className="pill" type="button" onClick={onImport}>Import</button><button className="pill primary" type="button" disabled={busy} onClick={onAI}>{busy ? 'Writing…' : 'AI Writer'}</button></div></header>
    <section className="profile"><div className="avatarBig">{profile[0].toUpperCase()}</div><div className="profileEdit"><div className="fieldLabel">Profile Name</div><input aria-label="Profile Name" value={name} onChange={e => onName(e.target.value)} placeholder="Contact name" maxLength={35}/></div></section>
    <div className="messagesHead"><strong>Messages</strong><div className="smallActions"><button className="outlineBtn" onClick={onSwapAll}>Swap All <Icon name="swap"/></button><button className="outlineBtn" onClick={onConfirmClear}>{confirmClear ? 'Confirm Delete' : 'Delete All'} <Icon name="trash" size="sm"/></button></div></div>
    <div className="messageList">{messages.map((m, i) => <div className="messageRow" key={m.id} draggable onDragStart={() => { dragFrom.current = i; }} onDragOver={e => e.preventDefault()} onDrop={() => onReorder(dragFrom.current, i)} onDragEnd={() => { dragFrom.current = null; }}><label className="messageText"><Icon name={m.imageUrl ? 'image' : 'music'}/><input aria-label={`Message ${i + 1}`} value={m.text} maxLength={500} onChange={e => onMessage(m.id, { text: e.target.value })} placeholder={m.imageUrl ? 'Image caption (optional)' : 'Type a message...'}/>{m.imageUrl && <img className="fts-message-thumb" src={m.imageUrl} alt=""/>}</label><button className={`sideSwitch ${m.side === 'right' ? 'sender' : ''}`} onClick={() => onSwapMessage(m.id)} title="Toggle sender/receiver" aria-label={`Toggle message ${i + 1} side`}><span className="sideKnob"><Icon name="message" size="sm"/></span></button><button className="actionRound" onClick={() => onDeleteMessage(m.id)} title={`Delete message ${i + 1}`} aria-label={`Delete message ${i + 1}`}><Icon name="trash"/></button></div>)}</div>
    <div className="messageComposer"><div className="composeBox"><button className="fts-image-action" type="button" onClick={onAddImage} aria-label="Add image message" title="Add image message"><Icon name="image"/></button><input value={composer} onChange={e => onComposer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }} placeholder="Type your message here..." aria-label="New message" maxLength={500}/></div><button className={`sideSwitch ${side === 'right' ? 'sender' : ''}`} onClick={() => onSide(side === 'left' ? 'right' : 'left')} title="Toggle sender / receiver" aria-label="New message side"><span className="sideKnob"><Icon name="message" size="sm"/></span></button><button className="actionRound" onClick={onSubmit} title="Send new message" aria-label="Send new message"><Icon name="send" size="lg"/></button></div>
    <button className="addMessage" onClick={onAdd}>+ &nbsp;Add Message</button>
  </div></div></div>;
}
