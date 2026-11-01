import React from 'react';
import { Check, Clapperboard, FolderOpen, ListChecks, MessagesSquare, RotateCcw, Scissors, Trash2, X } from 'lucide-react';
import { cancelJob, clearFinished, dismissJob, retryJob, useJobs } from './generationQueue.js';
import { etaText } from './clipProgress.js';
import './queue-panel.css';

/* The generation queue, as the advanced editor's export queue shows its renders: what is being made, how far along,
   how long is left, and where it lands. It is live (generationQueue.js) and the work goes on in the background. */
const KIND = { clip: [Scissors, 'Clips'], 'fake-text': [MessagesSquare, 'Fake text'] };

function Row({ job, go }) {
  const [Icon, label] = KIND[job.kind] || [Clapperboard, 'Video'];
  const live = job.status === 'running', waiting = job.status === 'queued', done = job.status === 'done', failed = job.status === 'error', stopped = job.status === 'cancelled';
  return <li className={`qp-row is-${job.status}`}>
    <span className="qp-glyph" aria-hidden>{live ? <i className="qp-spin"/> : done ? <Check size={14} strokeWidth={3}/> : failed ? <X size={14} strokeWidth={3}/> : <Icon size={14}/>}</span>
    <div className="qp-body">
      <div className="qp-line"><strong title={job.title}>{job.title}</strong>{live && <b className="qp-pct">{Math.round(job.percent)}%</b>}</div>
      <small className={live ? 'qp-shimmer' : ''}>{failed ? job.error || job.step : waiting ? `${label} · waiting its turn` : stopped ? 'Cancelled' : done && job.kind === 'clip' ? `${job.result?.clips?.length || 0} clip${job.result?.clips?.length === 1 ? '' : 's'} saved to Projects` : done ? 'Saved to Projects' : `${job.step}${job.eta != null ? ` · ${etaText(job.eta).replace(' left', '')} left` : ''}`.replace('Almost done · Almost done left', 'Almost done')}</small>
      {live && <i className="qp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.percent)} aria-label={`${job.title} progress`}><b style={{ transform: `scaleX(${Math.max(0.02, job.percent / 100)})` }}/></i>}
    </div>
    <div className="qp-actions">
      {done && <button type="button" className="qp-text" onClick={() => go('/projects')}><FolderOpen size={13}/>Open</button>}
      {failed && <button type="button" className="qp-text" onClick={() => retryJob(job.id)}><RotateCcw size={13}/>Retry</button>}
      {(live || waiting) ? <button type="button" aria-label={`Cancel ${job.title}`} onClick={() => cancelJob(job.id)}><X size={14}/></button> : <button type="button" aria-label={`Remove ${job.title}`} onClick={() => dismissJob(job.id)}><Trash2 size={13}/></button>}
    </div>
  </li>;
}

export default function QueuePanel({ go, title = 'Queue', empty = true }) {
  const jobs = useJobs();
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length, finished = jobs.length - active;
  if (!jobs.length && !empty) return null;
  return <section className="qp" aria-label={title}>
    <header><span className="qp-title"><ListChecks size={15}/>{title}</span>{active > 0 ? <em>{active} in progress</em> : null}{finished > 0 && <button type="button" onClick={clearFinished}>Clear finished</button>}</header>
    {jobs.length ? <ul>{jobs.map((job) => <Row key={job.id} job={job} go={go}/>)}</ul>
      : <div className="qp-empty"><ListChecks size={20}/><b>Nothing in the queue</b><small>Ask the Brainstormer to make a video and it appears here, running in the background.</small></div>}
  </section>;
}
