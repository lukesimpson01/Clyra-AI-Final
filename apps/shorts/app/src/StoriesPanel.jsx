import React, { useState } from "react";
import { MessageCircle, Scale, MessageSquareText, Plus, Trash2, ArrowLeftRight, Sparkles } from "lucide-react";
import { buildFakeText, buildWyr, buildReddit, CHAT_THEMES } from "./storyBuilders.js";

/* The editor's story tools: the same Fake text story / Would You Rather / Reddit generators as the dashboard,
   as compact sidebar forms that drop editable layers onto the timeline. */
const TOOLS = [["fake", "Fake text", MessageCircle], ["wyr", "Would you rather", Scale], ["reddit", "Reddit", MessageSquareText]];
const Field = ({ label, children, hint }) => <label className="sp-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;

export default function StoriesPanel({ onInsert }) {
  const [tool, setTool] = useState("fake");
  const [fake, setFake] = useState({ contact: "Alex", theme: "ios", messages: [{ from: "them", text: "hey are you up?" }, { from: "me", text: "yeah what's wrong" }, { from: "them", text: "you will not believe what just happened" }] });
  const [wyr, setWyr] = useState({ question: "Would you rather…", a: "Fly anywhere", b: "Read minds", pctA: 62, colorA: "#3b6df0", colorB: "#e8485a", reveal: 5 });
  const [rd, setRd] = useState({ subreddit: "AmItheAsshole", user: "throwaway123", title: "", body: "", upvotes: "12.4k", comments: "2.1k", dark: false });
  const setMsg = (i, patch) => setFake((f) => ({ ...f, messages: f.messages.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
  const insert = () => {
    if (tool === "fake") onInsert("Fake text story", buildFakeText(fake));
    else if (tool === "wyr") onInsert("Would you rather", buildWyr(wyr));
    else onInsert("Reddit story", buildReddit(rd));
  };
  const valid = tool === "fake" ? fake.messages.some((m) => m.text.trim()) : tool === "wyr" ? wyr.a.trim() && wyr.b.trim() : rd.title.trim();
  return (
    <div className="sp-root">
      <h2>Stories</h2>
      <div className="sp-tabs" role="tablist">{TOOLS.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tool === id} className={tool === id ? "on" : ""} onClick={() => setTool(id)}><Icon size={15} /><span>{label}</span></button>)}</div>
      <div className="sp-body" key={tool}>
        {tool === "fake" && <>
          <Field label="Contact name"><input value={fake.contact} onChange={(e) => setFake({ ...fake, contact: e.target.value })} /></Field>
          <Field label="Chat style"><div className="sp-seg">{Object.keys(CHAT_THEMES).map((t) => <button key={t} className={fake.theme === t ? "on" : ""} onClick={() => setFake({ ...fake, theme: t })}>{{ ios: "iMessage", dark: "Dark", green: "WhatsApp" }[t]}</button>)}</div></Field>
          <div className="sp-msgs"><div className="sp-msgs-head"><span>Messages</span><small>{fake.messages.length}</small></div>
            {fake.messages.map((m, i) => (
              <div className={"sp-msg " + m.from} key={i}>
                <button className="sp-who" title="Switch sender" onClick={() => setMsg(i, { from: m.from === "me" ? "them" : "me" })}><ArrowLeftRight size={12} />{m.from === "me" ? "You" : fake.contact || "Them"}</button>
                <input value={m.text} placeholder="Type a message…" onChange={(e) => setMsg(i, { text: e.target.value })} />
                <button className="sp-del" aria-label="Delete message" onClick={() => setFake((f) => ({ ...f, messages: f.messages.filter((_, k) => k !== i) }))}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="sp-add" onClick={() => setFake((f) => ({ ...f, messages: [...f.messages, { from: f.messages.at(-1)?.from === "me" ? "them" : "me", text: "" }] }))}><Plus size={14} /> Add message</button>
          </div>
        </>}
        {tool === "wyr" && <>
          <Field label="Question"><input value={wyr.question} onChange={(e) => setWyr({ ...wyr, question: e.target.value })} /></Field>
          <div className="sp-two">
            <Field label="Option A"><input value={wyr.a} onChange={(e) => setWyr({ ...wyr, a: e.target.value })} /></Field>
            <Field label="Option B"><input value={wyr.b} onChange={(e) => setWyr({ ...wyr, b: e.target.value })} /></Field>
          </div>
          <Field label={`Vote split · A ${wyr.pctA}% / B ${100 - wyr.pctA}%`}><input type="range" min="1" max="99" value={wyr.pctA} onChange={(e) => setWyr({ ...wyr, pctA: Number(e.target.value) })} /></Field>
          <div className="sp-two">
            <Field label="Colour A"><input type="color" value={wyr.colorA} onChange={(e) => setWyr({ ...wyr, colorA: e.target.value })} /></Field>
            <Field label="Colour B"><input type="color" value={wyr.colorB} onChange={(e) => setWyr({ ...wyr, colorB: e.target.value })} /></Field>
          </div>
          <Field label={`Time to decide · ${wyr.reveal}s`}><input type="range" min="2" max="12" value={wyr.reveal} onChange={(e) => setWyr({ ...wyr, reveal: Number(e.target.value) })} /></Field>
        </>}
        {tool === "reddit" && <>
          <div className="sp-two">
            <Field label="Subreddit"><input value={rd.subreddit} onChange={(e) => setRd({ ...rd, subreddit: e.target.value })} /></Field>
            <Field label="Username"><input value={rd.user} onChange={(e) => setRd({ ...rd, user: e.target.value })} /></Field>
          </div>
          <Field label="Post title"><input value={rd.title} placeholder="AITA for…" onChange={(e) => setRd({ ...rd, title: e.target.value })} /></Field>
          <Field label="Post text"><textarea rows={4} value={rd.body} placeholder="The story that types out on screen" onChange={(e) => setRd({ ...rd, body: e.target.value })} /></Field>
          <div className="sp-two">
            <Field label="Upvotes"><input value={rd.upvotes} onChange={(e) => setRd({ ...rd, upvotes: e.target.value })} /></Field>
            <Field label="Comments"><input value={rd.comments} onChange={(e) => setRd({ ...rd, comments: e.target.value })} /></Field>
          </div>
          <label className="ae-switch"><input type="checkbox" checked={rd.dark} onChange={(e) => setRd({ ...rd, dark: e.target.checked })} /><span>Dark card</span></label>
        </>}
      </div>
      <div className="sp-foot">
        <button className="sp-insert" disabled={!valid} onClick={insert}><Sparkles size={15} /> Add to timeline</button>
        <small>Creates grouped, animated layers at the playhead. Every text, colour and timing stays editable.</small>
      </div>
    </div>
  );
}
