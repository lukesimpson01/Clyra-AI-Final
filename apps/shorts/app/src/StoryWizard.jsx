import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clipboard,
  ImagePlus,
  Pause,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import ImessagePreview from "./ImessagePreview.jsx";
import FakeTextWorkspace from "./FakeTextWorkspace.jsx";
import RedditLivePreview from "./RedditLivePreview.jsx";
import { announceProject } from "./projectThumb.js";
import { fileToDataUrl, urlToBlob } from "./imageData.js";
import "./story-wizard.css";
import EmbedAddButton from './EmbedAddButton.jsx';

const subtitleIds = [
  1, 7, 3, 6, 67, 8, 34, 37, 61, 66, 104, 114, 122, 131, 157, 208,
];
const gameplayIds = [
  "12dm7zdo-qhr4-9ro5-xb9p-794xmqsudvi",
  "25r3klxv-8xnh-bx9z-0v5e-l02oj4wq85p",
  "04k002fo-pf26-j5h1-v6ti-nxykcnf42",
  "2fg1tjdy-8ngb-xg29-tz1y-ze3h4vxeih",
  "0rbt0c54-ace8-8khb-nw6u-o6azecvjlzk",
  "00eieqe3-po4g-rh90-888c-zriwtgl77k",
  "27yzpm7j-wlau-sx6d-hguk-85621eh5k89",
  "1s739e44-vipb-57t9-5jqa-a14rqcc4upw",
  "3ncmzbyx-jfrn-axi2-rq0d-t5kk8sbr9ha",
  "17bu4z5j-srkt-5b8j-q6ar-jdurow26pzn",
  "0vw1h3lz-2tt3-n7k7-b98p-9c154ozp06n",
  "2m69x29r-2jf4-me7c-v78s-vdwqcd5k4mn",
  "23dfs135-48dv-e8rk-3uqs-i4k3nu5ut6n",
  "10xr2xpw-tode-8jnk-v1ke-zv3svbi4w3",
  "1ty6nlgz-tn87-8p6c-c5z3-0sqlp10wdf5r",
  "24fmrp9x-0hak-r5rd-7nft-652n4dvo2y5",
  "2trross0-2cbw-vxl9-vz05-0oc0dez0efx",
  "0864s7f0-u5v3-vrhb-lyef-n6lrc1oblvk",
  "1idc8qo6-2w9u-5eud-xwm2-nkaqgww6egm",
  "1ugj853n-7bon-dbtg-rh3g-2qb7ez2f1cz",
  "3mrc3y7k-gjyh-kadj-vlqn-vrb147gzep",
  "313ylwzs-jxbb-x19i-vwo8-muwlzxih7um",
  "0xacedg7-9dp8-8p3s-53zy-vt35lqhy0ml",
  "2ibe7k60-x2i7-34t5-umje-a3s89d5ic4",
  "4dsd1k4g-jie6-3a4o-c56q-g6ldu00mxmo",
  "4n2riglr-0hgm-erzz-0tlu-6ak40mdm95j",
  "3n4gdxmp-kz62-usur-zbfw-paqdrcbzxv",
  "23h5er9b-981x-khfz-mjdd-v78quz93ewo",
  "68bki2q6-vgfa-2q5b-fpoe-jiwjnaj2s4",
  "4ly973he-fwmq-i78t-y16c-neo2iosu28",
  "5f23yh4q-mwsv-8uts-bnuc-909o0yyy5na",
  "5vrdji60-24vi-l7aw-pce4-vl2p8vrpii",
  "6jww7z18-spei-32kn-9u6l-hm8rq6oq66n",
  "5p00qpnk-q5ok-njot-q8t5-hvoz6kyngq9",
  "6whgrwz6-l9ta-3jgl-oti4-5iia2q3s5us",
  "7ob75v4o-vgia-vnwu-x7l5-bzh0kbxl224",
];
const gameplayTypes = [
  { name: "Subway Surfers", by: "Jakey", avatar: "jakey.jpg" },
  { name: "Soap Video", by: "Sir Satisfying", avatar: "sir.jpg" },
  {
    name: "Minecraft Video",
    by: "Steve",
    avatar: "04k002fo-pf26-j5h1-v6ti-nxykcnf42.webp",
  },
  { name: "Mario Kart", by: "Mario", avatar: "mario.jpg" },
  { name: "Slime Video", by: "Sir Satisfying", avatar: "sir.jpg" },
];
const gameplayDetails = [
  ["2 mins", "327 MB"],
  ["1.0 mins", "93 MB"],
  ["2 mins", "84 MB"],
  ["2 mins", "309 MB"],
  ["0.9 mins", "204 MB"],
  ["3 mins", "536 MB"],
  ["1.0 mins", "94 MB"],
  ["2 mins", "95 MB"],
  ["2 mins", "303 MB"],
  ["1 mins", "254 MB"],
  ["1 mins", "132 MB"],
  ["1.0 mins", "92 MB"],
  ["2 mins", "131 MB"],
  ["1 mins", "165 MB"],
  ["0.7 mins", "170 MB"],
  ["3 mins", "378 MB"],
  ["1 mins", "97 MB"],
  ["1 mins", "38 MB"],
  ["3 mins", "458 MB"],
  ["1 mins", "256 MB"],
  ["1 mins", "186 MB"],
  ["1 mins", "96 MB"],
  ["3 mins", "133 MB"],
  ["1 mins", "138 MB"],
  ["0.9 mins", "213 MB"],
  ["3 mins", "375 MB"],
  ["1 mins", "98 MB"],
  ["1 mins", "51 MB"],
  ["3 mins", "467 MB"],
  ["0.9 mins", "208 MB"],
  ["3 mins", "378 MB"],
  ["1 mins", "37 MB"],
  ["3 mins", "477 MB"],
  ["1 mins", "139 MB"],
  ["1 mins", "44 MB"],
  ["1 mins", "137 MB"],
];
export const backgrounds = gameplayIds.map((id, i) => {
  const type =
    gameplayTypes[
      i < 30 ? i % 5 : i === 30 || i === 33 ? 0 : i === 31 || i === 34 ? 2 : 3
    ];
  return {
    id,
    ...type,
    duration: gameplayDetails[i][0],
    size: gameplayDetails[i][1],
  };
});
const voiceNames = [
  "William",
  "Adam",
  "Dan Dan",
  "Natasha",
  "Amir #1",
  "Amir #2 (Ameer)",
  "Sponge Bob",
  "Pajeet",
  "Nicole",
  "Rachel",
  "Elli",
  "Josh",
  "Arnold",
  "Joey",
  "Aria",
  "Roger",
  "Sarah",
  "Laura",
  "Charlie",
  "George",
  "Callum",
  "Liam",
  "River",
  "Charlotte",
  "Alice",
  "Matilda",
  "Will",
  "Jessica",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Lily",
  "Bill",
  "Hicran Vuslat",
  "Vishnu",
  "Derya",
  "Sonya",
  "Nathalia",
  "Harun",
  "Sinan Sade",
  "Berkay Gok",
  "Furkan Bucak",
  "Anıl",
  "Viraj",
  "Linh",
  "Deniz Dogan",
  "Deniz",
  "Thorthugo",
  "Irmina",
  "Gokhan Uraslı",
  "Damian",
  "Ahmed",
  "Diego Narrativo",
  "Carmelo",
  "Ava Said 2",
  "GianP",
  "Sahara",
  "Denzel",
  "Dawid PL",
  "Onur Naci Ozturkler",
  "Victor",
  "Nickrad",
  "Antonio LV",
  "Nigel J.",
  "Sébastien",
  "Northern Irish Peter",
  "Steve V",
  "Mark",
  "Lumina",
  "Ranbir Merchant",
  "Screaming George",
  "Juan Carlos",
  "Stefanos",
  "Yorman Andres",
  "Sean",
  "Plushi",
  "Anna Kim",
];
const femaleVoices = new Set([
  "Natasha",
  "Nicole",
  "Rachel",
  "Elli",
  "Aria",
  "Sarah",
  "Laura",
  "Charlotte",
  "Alice",
  "Matilda",
  "Jessica",
  "Lily",
  "Hicran Vuslat",
  "Derya",
  "Sonya",
  "Nathalia",
  "Linh",
  "Irmina",
  "Ava Said 2",
  "Sahara",
  "Lumina",
  "Anna Kim",
]);
const olderVoices = new Set([
  "William",
  "Adam",
  "Dan Dan",
  "Arnold",
  "Aria",
  "George",
  "Callum",
  "River",
  "Alice",
  "Matilda",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Lily",
  "Bill",
]);
const musicNames = [
  "No background music",
  "Green to Blue",
  "Wii Shop Trap Theme",
  "Milk Cassete",
  "Bladerunner",
  "3am Walk",
  "Fluffing Duck",
  "I was only temporary",
  "M83 Solitude",
  "Idea 22",
];
const musicLengths = [
  "",
  "3m 8s",
  "1m 0s",
  "5m 8s",
  "3m 48s",
  "1m 0s",
  "1m 7s",
  "1m 0s",
  "1m 0s",
  "1m 0s",
];
const sampleMessages = [
  ["left", "would u love me if i was a tank?"],
  ["right", "well that depends on what tank you are..."],
  ["left", "a tank of your love 😭"],
  ["right", "then of course 💙"],
];
const stepKey = ["script", "style", "video", "audio"];
const textStepKey = ["script", "theme", "video", "audio"];

function useGeneration() {
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearInterval(timer.current), []);
  const start = () => {
    clearInterval(timer.current);
    setDone(false);
    const duration = 6000 + Math.random() * 6000,
      started = performance.now();
    setProgress(0);
    timer.current = setInterval(() => {
      const next = Math.min(
        100,
        Math.round(((performance.now() - started) / duration) * 100),
      );
      setProgress(next);
      if (next === 100) {
        clearInterval(timer.current);
        setTimeout(() => {
          setProgress(null);
          setDone(true);
        }, 360);
      }
    }, 75);
  };
  return { progress, done, start, setDone };
}
function ThemePreview({ theme, selected, onClick }) {
  const outgoing = [
    "#155f57",
    "#e8ffd9",
    "#4c9be7",
    "#4c9be7",
    "#8b55fa",
    "#4a9ff0",
  ][theme];
  return (
    <button
      type="button"
      className={"sw-theme sw-theme-" + theme + (selected ? " selected" : "")}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="sw-theme-head">
        <span>‹</span>
        <strong>my bae &lt;3</strong>
        <span>♧　♧</span>
      </div>
      <div className="sw-theme-wall">
        <p>would u love me if i was a tank?</p>
        <p style={{ background: outgoing }}>
          well that depends on what tank you are...
        </p>
      </div>
    </button>
  );
}
function VoiceList({ title, value, onChange }) {
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState("");
  const play = (name) => {
    if (playing === name) {
      speechSynthesis.cancel();
      setPlaying("");
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      "Hello, this is a short voice preview.",
    );
    utterance.onend = () => setPlaying("");
    speechSynthesis.speak(utterance);
    setPlaying(name);
  };
  return (
    <section className="sw-audio-panel">
      <h3>{title}</h3>
      <label className="sw-search">
        <Search size={15} />
        <input
          placeholder="Search name, tag, etc."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="sw-audio-scroll">
        {voiceNames
          .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
          .map((name, i) => (
            <div
              className={"sw-voice-row" + (name === value ? " selected" : "")}
              key={name + "-" + i}
            >
              <button
                type="button"
                aria-label={"Preview " + name}
                onClick={() => play(name)}
              >
                {playing === name ? (
                  <Pause size={11} />
                ) : (
                  <Play size={11} fill="currentColor" />
                )}
              </button>
              <button type="button" onClick={() => onChange(name)}>
                <strong>{name}</strong>
                <span className="sw-voice-tags">
                  <i>{femaleVoices.has(name) ? "Female" : "Male"}</i>
                  <i>{olderVoices.has(name) ? "Middle aged" : "Young"}</i>
                  <i>{name === "William" ? "English" : "Multilingual"}</i>
                </span>
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}

function LegacyStoryWizard({ kind, go, embed = false, initial = null, onState }) {
  const reddit = kind === "reddit";
  const steps = reddit ? stepKey : textStepKey;
  const queryStep = new URLSearchParams(location.search).get("step");
  const [step, setStep] = useState(Math.max(0, steps.indexOf(queryStep)));
  const [name, setName] = useState(initial?.name ?? (reddit ? "Shorts AI" : "luke"));
  const [title, setTitle] = useState(
    reddit
      ? initial?.title ?? "Shorts AI is a platform that allows you to create videos with AI."
      : "",
  );
  const [script, setScript] = useState(initial?.script ?? "");
  const [votes, setVotes] = useState(initial?.votes ?? ["99", "99"]);
  const [extraPosts,setExtraPosts]=useState(initial?.extraPosts ?? []);
  const [messages, setMessages] = useState([]);
  const [avatar, setAvatar] = useState(initial?.avatar ?? "");
  const [postImage, setPostImage] = useState(initial?.image ?? "");
  const imageRef = useRef(), imageFor = useRef("first");
  const [render, setRender] = useState(null);
  const renderRun = useRef(0);
  const [dark, setDark] = useState(initial?.dark ?? false);
  const [intro, setIntro] = useState(true);
  const [oneWord, setOneWord] = useState(false);
  const [subtitle, setSubtitle] = useState(0);
  const [theme, setTheme] = useState(3);
  const [background, setBackground] = useState(initial?.background ?? 0);
  const [introVoice, setIntroVoice] = useState("William");
  const [scriptVoice, setScriptVoice] = useState("Adam");
  const [music, setMusic] = useState(musicNames[0]);
  const [language, setLanguage] = useState("Auto Detect Language");
  const [volume, setVolume] = useState(50);
  const [stability, setStability] = useState(50);
  const [exaggeration, setExaggeration] = useState(50);
  const [promo, setPromo] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const { progress, done, start, setDone } = useGeneration();
  useEffect(() => {
    if (!done || !go || reddit) return;
    sessionStorage.setItem(
      "frame-story-project",
      JSON.stringify({
        kind,
        name,
        title,
        script,
        posts:[{id:'first',author:name,title,body:script,votes:votes[0],comments:votes[1]},...extraPosts],
        messages,
        subtitleId: subtitleIds[subtitle],
        theme,
        backgroundId: backgrounds[background].id,
        backgroundName: backgrounds[background].name,
        introVoice,
        scriptVoice,
        music,
      }),
    );
    const timer = setTimeout(() => go("/editor/mock"), 360);
    return () => clearTimeout(timer);
  }, [done]);
  const move = (index) => {
    setStep(index);
    history.replaceState({}, "", location.pathname + "?step=" + steps[index]);
    setDone(false);
  };
  const updateMessage = (index, value) =>
    setMessages((items) =>
      items.map((item, i) => (i === index ? [item[0], value] : item)),
    );
  const addMessage = (side) => setMessages((items) => [...items, [side, ""]]);
  const setSample = () => {
    if (reddit) {
      setName("randy-gustavo");
      setTitle("How to secure a 10 foot ramp to stone stairs?");
      setScript(
        "My sweet pup is 16 and is now struggling to get up and down our front steps to go outside.",
      );
    } else {
      setName("my bae <3");
      setMessages(sampleMessages);
    }
  };
  const aiScript = () => {
    setAiBusy(true);
    setTimeout(() => {
      setSample();
      setAiBusy(false);
    }, 1400);
  };
  /* a finished story becomes a project, its card a frame of the preview's gameplay */
  useEffect(() => { if (done && !embed && !reddit) announceProject({ name: (reddit ? title : `${name} story`) || 'Untitled story', source: document.querySelector('.rlp-game, .sw-preview-card video') }); }, [done]);
  const allPosts=[{id:'first',author:name,title,body:script,votes:votes[0],comments:votes[1],imageUrl:postImage,avatarUrl:avatar},...extraPosts];
  const patchPost=(id,patch)=>setExtraPosts(items=>items.map(post=>post.id===id?{...post,...patch}:post));
  useEffect(() => { if (embed) onState?.({ name, title, script, votes, extraPosts, dark, background, avatar, image: postImage, gameplayFile: previewFile.replace('-60', '') }); });
  const previewFile=backgrounds[background].name.includes('Minecraft')?'minecraft-01-60.mp4':backgrounds[background].name.includes('Mario')?'trackmania-01-60.mp4':backgrounds[background].name.includes('Soap')?'gta-01-60.mp4':'subway-01-60.mp4';
  const generate = () => {
    if (reddit && !allPosts.some(post=>post.body.trim())) {
      setError("Please write a script before generating a video");
      return;
    }
    if (!reddit && !messages.some(([, message]) => message.trim())) {
      setError("Please add a message before generating a video");
      return;
    }
    setError("");
    if (reddit) { void renderReddit(); return; }
    start();
  };
  /* Reddit: a real 60 fps MP4, drawn from this same preview by the local render worker (as the text story is) */
  const renderReddit = async () => {
    const run = ++renderRun.current;
    setRender({ progress: 0, status: "Uploading story media" });
    try {
      const form = new FormData();
      const posts = allPosts.map(({ imageUrl, avatarUrl, ...post }) => post);
      for (let i = 0; i < allPosts.length; i++) {
        if (allPosts[i].imageUrl) form.append(`image-${i}`, await urlToBlob(allPosts[i].imageUrl), `image-${i}.jpg`);
        if (allPosts[i].avatarUrl) form.append(`avatar-${i}`, await urlToBlob(allPosts[i].avatarUrl), `avatar-${i}.jpg`);
      }
      form.append("spec", JSON.stringify({ posts, dark, videoUrl: "/media/fake-text-gameplay/" + previewFile, posterUrl: "/media/fake-text-gameplay/" + previewFile.replace("-60.mp4", ".jpg") }));
      const response = await fetch("/api/reddit/render", { method: "POST", body: form });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || "Could not start the MP4 render.");
      while (renderRun.current === run) {
        const statusResponse = await fetch(`/api/reddit/render/${created.id}/status`);
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || "The render was interrupted.");
        if (status.state === "error") throw new Error(status.message || "The render failed.");
        if (status.state === "complete") {
          setRender({ progress: 100, status: status.message, url: status.resultUrl, view: status.viewUrl });
          announceProject({ name: title || "Reddit story", source: status.viewUrl });
          break;
        }
        setRender({ progress: status.progress, status: status.message });
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    } catch (cause) { if (renderRun.current === run) { setRender(null); setError(cause.message); } }
  };
  const pickImage = (target) => { imageFor.current = target; imageRef.current?.click(); };
  const takeImage = async (file) => {
    if (!file) return;
    const url = await fileToDataUrl(file);
    if (imageFor.current === "first") setPostImage(url);
    else patchPost(imageFor.current, { imageUrl: url });
  };
  const pasteMessages = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (value)
        setMessages(
          value
            .split("\n")
            .filter(Boolean)
            .map((text, i) => [i % 2 ? "right" : "left", text]),
        );
    } catch {}
  };
  const previewDuration = Math.max(0, messages.length * 2);
  return (
    <div className="sw-root">
      {render && (
        <div className="ftl-modal-shade"><div className="ftl-generating" role="status">
          <div className="ftl-progress-ring" style={{ "--progress": `${render.progress}%` }}><strong>{render.progress}%</strong></div>
          <h3>{render.url ? "Your MP4 is ready" : "Rendering your story"}</h3><p>{render.status}</p>
          <small>9:16 · 720 × 1280 · 60 fps · local render</small>
          {render.url && <><div className="ftl-export-viewer"><video className="ftl-export-main" src={render.view} controls playsInline autoPlay muted /></div>
            <div className="ftl-render-actions"><a href={render.url} download="reddit-story-60fps.mp4">Download MP4</a><button type="button" onClick={() => setRender(null)}>Close</button></div></>}
          {!render.url && <div className="ftl-render-actions"><button type="button" onClick={() => { renderRun.current++; setRender(null); }}>Cancel</button></div>}
        </div></div>
      )}
      {error && (
        <div className="sw-alert" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <div className="sw-steps">
        <div>
          {steps.map((stepName, i) => (
            <React.Fragment key={stepName}>
              <button
                type="button"
                className={step === i ? "active" : ""}
                onClick={() => move(i)}
              >
                <b>{i + 1}</b>
                <span>{stepName[0].toUpperCase() + stepName.slice(1)}</span>
              </button>
              {i < 3 && <ChevronRight size={16} />}
            </React.Fragment>
          ))}
        </div>
        {embed && step === 3 ? <EmbedAddButton /> : <button
          className="sw-next"
          onClick={() => (step === 3 ? generate() : move(step + 1))}
          disabled={progress !== null}
        >
          {progress !== null
            ? progress + "%"
            : step === 3
              ? "Generate ✨"
              : "Next ❯"}
        </button>}
      </div>
      {done && (
        <div className="sw-done">
          <Check size={17} />
          Mock generation complete — no video was rendered. Your choices remain
          available to edit.
          <button onClick={() => setDone(false)}>
            <X size={14} />
          </button>
        </div>
      )}
      {step === 0 && (
        <div className={"sw-script-grid" + (reddit ? " reddit" : " text")}>
          <section className="sw-card sw-script-card">
            <div className="sw-card-head">
              <h2>{reddit ? "Generate Story Video" : "Text Script"}</h2>
              <div>
                {!reddit && (
                  <>
                    <button
                      onClick={() =>
                        setMessages(
                          messages.map(([side, text]) => [
                            side === "left" ? "right" : "left",
                            text,
                          ]),
                        )
                      }
                    >
                      <Shuffle size={16} />
                      Swap
                    </button>
                    <button onClick={pasteMessages}>
                      <Clipboard size={16} />
                      Paste
                    </button>
                  </>
                )}
                <button onClick={setSample}>Sample Data</button>
                <button className="blue" onClick={aiScript} disabled={aiBusy}>
                  {aiBusy ? "Generating..." : "AI script"}
                </button>
              </div>
            </div>
            {reddit ? (
              <>
                <div className="sw-reddit-post-editor"><div className="sw-reddit-post-head"><strong>Post 1</strong><span>Shown from 0s to 5s</span></div>
                <div className="sw-reddit-top">
                  <button onClick={() => fileRef.current?.click()} className={avatar ? "sw-pfp has" : "sw-pfp"}>
                    {avatar ? <img src={avatar} alt="" /> : <Upload size={15} />}
                    Swap PFP
                  </button>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {votes.map((vote, i) => (
                    <input
                      aria-label={i ? "Comments" : "Votes"}
                      key={i}
                      value={vote}
                      onChange={(e) =>
                        setVotes(
                          votes.map((v, k) => (k === i ? e.target.value : v)),
                        )
                      }
                    />
                  ))}
                </div>
                <textarea
                  className="sw-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter Reddit post title..."
                />
                <div className="sw-reddit-options">
                  <button onClick={() => setDark(!dark)}>
                    {dark ? "Light Mode" : "Dark Mode"}
                  </button>
                  <PostImage url={postImage} onPick={() => pickImage("first")} onRemove={() => setPostImage("")} />
                </div>
                <textarea
                  className="sw-script-input"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="Enter video script content..."
                />
                </div>
                {extraPosts.map((post,index)=><div className="sw-reddit-post-editor" key={post.id}><div className="sw-reddit-post-head"><strong>Post {index+2}</strong><button aria-label={`Remove post ${index+2}`} onClick={()=>setExtraPosts(items=>items.filter(item=>item.id!==post.id))}><Trash2 size={15}/></button></div><div className="sw-reddit-top"><label>Author<input aria-label={`Post ${index+2} author`} value={post.author} onChange={e=>patchPost(post.id,{author:e.target.value})}/></label><label>Votes<input aria-label={`Post ${index+2} votes`} value={post.votes} onChange={e=>patchPost(post.id,{votes:e.target.value})}/></label><label>Comments<input aria-label={`Post ${index+2} comments`} value={post.comments} onChange={e=>patchPost(post.id,{comments:e.target.value})}/></label></div><textarea className="sw-title-input" aria-label={`Post ${index+2} title`} placeholder="Post title" value={post.title} onChange={e=>patchPost(post.id,{title:e.target.value})}/><div className="sw-reddit-options"><PostImage url={post.imageUrl} onPick={()=>pickImage(post.id)} onRemove={()=>patchPost(post.id,{imageUrl:''})}/></div><textarea className="sw-script-input" aria-label={`Post ${index+2} story`} placeholder="Story text" value={post.body} onChange={e=>patchPost(post.id,{body:e.target.value})}/></div>)}
                <button className="sw-add-reddit-post" onClick={()=>setExtraPosts(items=>[...items,{id:crypto.randomUUID(),author:'u/creator',title:'A new story',body:'Write the next post here.',votes:'0',comments:'0'}])}><Plus size={16}/> Add another post</button>
              </>
            ) : (
              <>
                <div className="sw-profile">
                  <span>
                    {avatar ? (
                      <img src={avatar} alt="Profile preview" />
                    ) : (
                      (name || "F").slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <div>
                    <strong>Upload Profile Picture</strong>
                    <small>Recommended: 400px x 400px, PNG or JPEG</small>
                  </div>
                  <button onClick={() => fileRef.current?.click()}>
                    <Upload size={16} />
                    Upload
                  </button>
                </div>
                <label>Enter a name</label>
                <input
                  className="sw-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className="sw-message-actions">
                  <button onClick={() => setMessages([])}>
                    <Trash2 size={15} />
                    Clear
                  </button>
                  <button onClick={() => addMessage("left")}>
                    <Plus size={15} />
                    Add Receiver
                  </button>
                  <button onClick={() => addMessage("right")}>
                    <Plus size={15} />
                    Add Sender
                  </button>
                </div>
                <div className="sw-message-edit">
                  {messages.map(([side, message], i) => (
                    <div key={i}>
                      <small>{side === "left" ? "Receiver" : "Sender"}</small>
                      <input
                        aria-label={side + " message " + (i + 1)}
                        value={message}
                        onChange={(e) => updateMessage(i, e.target.value)}
                      />
                      <button
                        aria-label="Remove message"
                        onClick={() =>
                          setMessages(messages.filter((_, k) => k !== i))
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void fileToDataUrl(file, 400).then(setAvatar);
                e.target.value = "";
              }}
            />
            <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void takeImage(e.target.files?.[0]); e.target.value = ""; }} />
          </section>
          <aside className="sw-card sw-preview-card">
            {reddit ? (
              <RedditLivePreview posts={allPosts} videoUrl={'/media/fake-text-gameplay/'+previewFile} posterUrl={'/media/fake-text-gameplay/'+previewFile.replace('-60.mp4','.jpg')} dark={dark}/>
            ) : (
              <>
                <h3>Message preview · ~{previewDuration}s estimated length</h3>
                <ImessagePreview
                  name={name}
                  messages={messages}
                  theme={theme}
                  avatar={avatar}
                  gameplayId={backgrounds[background].id}
                />
              </>
            )}
          </aside>
        </div>
      )}
      {step === 1 &&
        (reddit ? (
          <div className="sw-style">
            <h2>Select Subtitle Template</h2>
            <div className="sw-caption-mode">
              <span>One Word</span>
              <button
                role="switch"
                aria-checked={!oneWord}
                onClick={() => setOneWord(!oneWord)}
                className={oneWord ? "off" : ""}
              >
                <i />
              </button>
              <span>Lines</span>
            </div>
            <div className="sw-subtitles">
              {subtitleIds.map((id, i) => (
                <button
                  key={id}
                  className={subtitle === i ? "selected" : ""}
                  onClick={() => setSubtitle(i)}
                  aria-label={"Preview for template " + id}
                  aria-pressed={subtitle === i}
                >
                  <div>
                    <img
                      src={"/images/subtitles/" + id + ".png"}
                      alt={"Subtitle style " + id}
                    />
                  </div>
                  {subtitle === i && (
                    <i>
                      <Check size={13} />
                    </i>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="sw-theme-grid">
            <section className="sw-card">
              <h2>Choose theme</h2>
              <div>
                {Array.from({ length: 6 }, (_, i) => (
                  <ThemePreview
                    key={i}
                    theme={i}
                    selected={theme === i}
                    onClick={() => setTheme(i)}
                  />
                ))}
              </div>
            </section>
            <aside className="sw-card sw-preview-card">
              <h3>Message preview · ~{previewDuration}s estimated length</h3>
              <ImessagePreview
                name={name}
                messages={messages}
                theme={theme}
                avatar={avatar}
                gameplayId={backgrounds[background].id}
              />
            </aside>
          </div>
        ))}
      {step === 2 && (
        <div className="sw-background">
          <h2>Select Background Video</h2>
          <p>
            <b>Tip:</b> You can replace the background video after generation in
            the editor.
          </p>
          <div className="sw-background-grid">
            {backgrounds.map((item, i) => (
              <div
                key={item.id}
                className={
                  "sw-background-card" + (background === i ? " selected" : "")
                }
                role="button"
                tabIndex={0}
                aria-pressed={background === i}
                onClick={() => setBackground(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBackground(i);
                  }
                }}
              >
                <div className="sw-background-media">
                  <img
                    className="blur"
                    src={"/images/gameplay/" + item.id + ".webp"}
                    alt=""
                  />
                  <img
                    className="front"
                    src={"/images/gameplay/" + item.id + ".webp"}
                    alt={item.name}
                  />
                  <img
                    className="blur animated"
                    src={"/images/gameplay/" + item.id + ".gif"}
                    alt=""
                  />
                  <img
                    className="front animated"
                    src={"/images/gameplay/" + item.id + ".gif"}
                    alt={item.name + " animated preview"}
                  />
                  {background === i && (
                    <span className="sw-bg-check">
                      <Check size={13} />
                    </span>
                  )}
                </div>
                <div className="sw-background-details">
                  <div className="sw-background-heading">
                    <strong>{item.name}</strong>
                    <small>
                      <img src={"/images/gameplay/" + item.avatar} alt="" />
                      {item.by}
                    </small>
                  </div>
                  <div>
                    <span>{item.duration}</span>
                    <span>{item.size}</span>
                    <span>Free</span>
                  </div>
                  <a
                    href={"https://premiumgameplay.com/explore?id=" + item.id}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View in Premium Gameplay
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="sw-audio">
          <VoiceList
            title={reddit ? "Select Intro Voice" : "Receiver Voice (left)"}
            value={introVoice}
            onChange={setIntroVoice}
          />
          <VoiceList
            title={reddit ? "Select Script Voice" : "Sender Voice (right)"}
            value={scriptVoice}
            onChange={setScriptVoice}
          />
          <section className="sw-audio-panel">
            <h3>
              {reddit ? "Select Background Music" : "Language & Voice Settings"}
            </h3>
            {reddit ? (
              <div className="sw-audio-scroll sw-music">
                {musicNames.map((track, i) => (
                  <button
                    key={track}
                    className={track === music ? "selected" : ""}
                    onClick={() => setMusic(track)}
                  >
                    <span className="sw-music-line">
                      <Play size={12} fill="currentColor" />
                      <strong>{track}</strong>
                      <small>{musicLengths[i]} ♫</small>
                    </span>
                    {i === 0 ? (
                      <span className="sw-music-note">
                        Note: you can add your own music after generating your
                        video in the editor
                      </span>
                    ) : (
                      <span className="sw-waveform" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="sw-language">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {[
                    "Auto Detect Language",
                    "English",
                    "Spanish",
                    "French",
                    "German",
                    "Portuguese",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                {[
                  ["Style Exaggeration", exaggeration, setExaggeration],
                  ["Voice Stability", stability, setStability],
                  ["Voice Volume", volume, setVolume],
                ].map(([label, value, setter]) => (
                  <label key={label}>
                    {label}
                    <span>{value}%</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => setter(+e.target.value)}
                    />
                  </label>
                ))}
                <button
                  onClick={() => {
                    setExaggeration(50);
                    setStability(50);
                    setVolume(50);
                  }}
                >
                  Reset To Default
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {progress !== null && (
        <div className="sw-generating" role="status" aria-live="polite">
          <div className="sw-generating-card">
            <h2>Generating Your Video</h2>
            <p>
              Your video is being generated and will be
              <br />
              ready in under a minute
            </p>
            <strong>{progress}%</strong>
            <div className="sw-generation-track">
              <i style={{ width: progress + "%" }} />
            </div>
            <small>Please wait while we process your video...</small>
          </div>
        </div>
      )}
    </div>
  );
}
export default function StoryWizard({ kind, go, ...embed }) {
  return kind === "text" ? (
    <FakeTextWorkspace go={go} {...embed} />
  ) : (
    <LegacyStoryWizard kind={kind} go={go} {...embed} />
  );
}

/* a post's picture: add one, or see it and take it off */
function PostImage({ url, onPick, onRemove }) {
  return url ? (
    <span className="sw-post-image"><img src={url} alt="Post" /><button type="button" onClick={onPick}>Change</button><button type="button" aria-label="Remove image" onClick={onRemove}><X size={13} /></button></span>
  ) : (
    <button type="button" className="sw-add-image" onClick={onPick}><ImagePlus size={15} />Add image</button>
  );
}
