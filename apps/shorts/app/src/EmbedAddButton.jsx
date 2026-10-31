import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';

/* The last step of a story tool inside the advanced editor: one clear button that puts the story on the timeline.
   It asks the editor (src/EmbedTool.jsx → the editor's StoryEmbed) and shows the add as it happens: a spinner while
   the story is written and placed, then "Added". */
export function requestAdd() {
  window.parent?.postMessage({ type: 'shorts-embed-add' }, '*');
}
export function useAddState() {
  const [state, setState] = useState('idle');
  useEffect(() => {
    const on = (e) => {
      if (e.data?.type !== 'shorts-embed-added') return;
      setState(e.data.phase === 'start' ? 'adding' : e.data.phase === 'done' ? 'added' : 'idle');
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  useEffect(() => { if (state !== 'added') return undefined; const t = setTimeout(() => setState('idle'), 2400); return () => clearTimeout(t); }, [state]);
  return [state, setState];
}

export default function EmbedAddButton() {
  const [state, setState] = useAddState();
  return (
    <button type="button" className={`sw-next sw-add ${state}`} disabled={state === 'adding'} onClick={() => { setState('adding'); requestAdd(); }}>
      {state === 'adding' ? <><Loader2 size={15} className="sw-add-spin" />Adding to timeline…</> : state === 'added' ? <><Check size={15} />Added to timeline</> : <><Plus size={15} />Add to timeline</>}
    </button>
  );
}
