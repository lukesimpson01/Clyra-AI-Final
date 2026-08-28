import Database from "better-sqlite3";
import path from "node:path";
import { promises as fs } from "node:fs";

const dataRoot = path.join(process.cwd(), "data", "notes");
const dbPath = path.join(dataRoot, "clyra-notes.db");
let db: Database.Database;

export async function initNotesStore() {
  await fs.mkdir(dataRoot, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#5474e8', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, title TEXT NOT NULL, markdown TEXT DEFAULT '', class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL, favorite INTEGER DEFAULT 0, inbox INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS page_revisions(id INTEGER PRIMARY KEY, page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE, title TEXT, markdown TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS wiki_links(page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE, target_title TEXT, UNIQUE(page_id,target_title));
  CREATE TABLE IF NOT EXISTS class_sessions(id INTEGER PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE, title TEXT, transcript TEXT DEFAULT '', live_notes TEXT DEFAULT '', final_notes TEXT DEFAULT '', started_at TEXT DEFAULT CURRENT_TIMESTAMP, ended_at TEXT);
  CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL, class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL, title TEXT, type TEXT, url TEXT, content TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS flashcards(id INTEGER PRIMARY KEY, page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE, question TEXT, answer TEXT, topic TEXT, difficulty REAL DEFAULT 2.5, due_at TEXT DEFAULT CURRENT_TIMESTAMP, last_reviewed TEXT, review_count INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS flashcard_reviews(id INTEGER PRIMARY KEY, flashcard_id INTEGER REFERENCES flashcards(id) ON DELETE CASCADE, rating INTEGER, reviewed_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, markdown, content='pages', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN INSERT INTO notes_fts(rowid,title,markdown) VALUES(new.id,new.title,new.markdown); END;
  CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,markdown) VALUES('delete',old.id,old.title,old.markdown); END;
  CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,markdown) VALUES('delete',old.id,old.title,old.markdown); INSERT INTO notes_fts(rowid,title,markdown) VALUES(new.id,new.title,new.markdown); END;`);
  if (!(db.prepare("SELECT 1 FROM classes LIMIT 1").get())) {
    const c = Number(db.prepare("INSERT INTO classes(name) VALUES(?)").run("Business Studies").lastInsertRowid);
    db.prepare("INSERT INTO pages(title,markdown,class_id,favorite) VALUES(?,?,?,1)").run("Operations Management", "# Operations Management\n\nOperations turns inputs into goods and services.\n\n## Quality management\n\n- **Quality control** checks outputs.\n- **Quality assurance** improves the process.\n\n> Review the Apple vertical integration case study.\n\n[[Quality Management]]", c);
    db.prepare("INSERT INTO pages(title,markdown,class_id) VALUES(?,?,?)").run("Quality Management", "# Quality Management\n\nQuality is built through control, assurance and continuous improvement.", c);
  }
}

const links = (id:number, md:string) => { db.prepare("DELETE FROM wiki_links WHERE page_id=?").run(id); const add=db.prepare("INSERT OR IGNORE INTO wiki_links(page_id,target_title) VALUES(?,?)"); for(const m of md.matchAll(/\[\[([^\]]+)\]\]/g)) add.run(id,m[1].trim()); };
export function notesApi() {
  return {
    bootstrap(){ return { classes:db.prepare("SELECT * FROM classes ORDER BY name").all(), pages:db.prepare("SELECT * FROM pages ORDER BY updated_at DESC").all(), due:db.prepare("SELECT count(*) n FROM flashcards WHERE due_at<=CURRENT_TIMESTAMP").get(), sources:db.prepare("SELECT * FROM sources ORDER BY created_at DESC LIMIT 20").all() }; },
    page(id:number){ const page:any=db.prepare("SELECT p.*,c.name class_name FROM pages p LEFT JOIN classes c ON c.id=p.class_id WHERE p.id=?").get(id); if(!page)return null; return {...page,backlinks:db.prepare("SELECT p.id,p.title FROM wiki_links w JOIN pages p ON p.id=w.page_id WHERE lower(w.target_title)=lower(?)").all(page.title),revisions:db.prepare("SELECT id,created_at FROM page_revisions WHERE page_id=? ORDER BY id DESC LIMIT 20").all(id)}; },
    createPage(v:any){ const r=db.prepare("INSERT INTO pages(title,markdown,class_id,inbox) VALUES(?,?,?,?)").run(v.title||"Untitled",v.markdown||"",v.classId||null,v.inbox?1:0); links(Number(r.lastInsertRowid),v.markdown||""); return this.page(Number(r.lastInsertRowid)); },
    savePage(id:number,v:any){ const old:any=db.prepare("SELECT * FROM pages WHERE id=?").get(id); if(!old)return null; if(old.markdown!==v.markdown||old.title!==v.title) db.prepare("INSERT INTO page_revisions(page_id,title,markdown) VALUES(?,?,?)").run(id,old.title,old.markdown); db.prepare("UPDATE pages SET title=?,markdown=?,class_id=?,favorite=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.title||old.title,v.markdown??old.markdown,v.classId??old.class_id,v.favorite?1:0,id); links(id,v.markdown??old.markdown); return this.page(id); },
    removePage(id:number){ return db.prepare("DELETE FROM pages WHERE id=?").run(id).changes>0; },
    search(q:string){ if(!q.trim())return []; const safe=q.trim().split(/\s+/).map(x=>`"${x.replaceAll('"','')}"*`).join(" OR "); return db.prepare("SELECT p.id,p.title,p.markdown,p.updated_at,snippet(notes_fts,1,'<mark>','</mark>','…',18) snippet FROM notes_fts JOIN pages p ON p.id=notes_fts.rowid WHERE notes_fts MATCH ? ORDER BY rank LIMIT 30").all(safe); },
    createClass(name:string){ return db.prepare("INSERT INTO classes(name) VALUES(?) RETURNING *").get(name); },
    startSession(classId:number){ return db.prepare("INSERT INTO class_sessions(class_id,title) VALUES(?,?) RETURNING *").get(classId,`Class · ${new Date().toLocaleDateString()}`); },
    endSession(id:number, transcript:string){ const lines=transcript.split(/(?<=[.!?])\s+/).filter(Boolean); const important=lines.filter(x=>/important|exam|remember|homework|definition|means|formula/i.test(x)); const final=`# Class notes\n\n## Summary\n${lines.slice(0,3).join(' ')}\n\n## Key ideas\n${(important.length?important:lines.slice(0,5)).map(x=>`- ${x}`).join('\n')}\n\n## Review next\n- Clarify any unfamiliar terms\n- Turn the key ideas into retrieval questions`;
      db.prepare("UPDATE class_sessions SET transcript=?,final_notes=?,ended_at=CURRENT_TIMESTAMP WHERE id=?").run(transcript,final,id); const s:any=db.prepare("SELECT * FROM class_sessions WHERE id=?").get(id); const p=this.createPage({title:s.title,markdown:final,classId:s.class_id}); return {...s,final_notes:final,page:p}; },
    addSource(v:any){ return db.prepare("INSERT INTO sources(page_id,class_id,title,type,url,content) VALUES(?,?,?,?,?,?) RETURNING *").get(v.pageId||null,v.classId||null,v.title||v.url||"Source",v.type||"web",v.url||null,v.content||""); },
    cards(pageId?:number){ return pageId?db.prepare("SELECT * FROM flashcards WHERE page_id=? ORDER BY due_at").all(pageId):db.prepare("SELECT * FROM flashcards ORDER BY due_at").all(); },
    addCards(pageId:number,cards:any[]){ const s=db.prepare("INSERT INTO flashcards(page_id,question,answer,topic) VALUES(?,?,?,?)"); db.transaction(()=>cards.forEach(c=>s.run(pageId,c.question,c.answer,c.topic||"General")))(); return this.cards(pageId); },
    reviewCard(id:number,rating:number){ const days=[0,1,3,7,14][rating]||1; db.prepare("UPDATE flashcards SET last_reviewed=CURRENT_TIMESTAMP,review_count=review_count+1,difficulty=max(1.3,difficulty+(?-3)*.12),due_at=datetime('now',?) WHERE id=?").run(rating,`+${days} days`,id); db.prepare("INSERT INTO flashcard_reviews(flashcard_id,rating) VALUES(?,?)").run(id,rating); return db.prepare("SELECT * FROM flashcards WHERE id=?").get(id); },
    async exportAll(){ const root=path.join(process.cwd(),"exports"); await fs.mkdir(root,{recursive:true}); for(const p of db.prepare("SELECT p.*,coalesce(c.name,'Notes') class_name FROM pages p LEFT JOIN classes c ON c.id=p.class_id").all() as any[]){ const dir=path.join(root,p.class_name.replace(/[^\w -]/g,"")); await fs.mkdir(dir,{recursive:true}); const file=p.title.replace(/[^\w -]/g,"")||`Note ${p.id}`; await fs.writeFile(path.join(dir,`${file}.md`),`---\ntitle: "${p.title.replaceAll('"','\\"')}"\nupdated: ${p.updated_at}\n---\n\n${p.markdown}`); } return root; }
  };
}
export { dbPath };
