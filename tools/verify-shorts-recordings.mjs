import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SFX_CATALOG } from "../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js";
import { BROWSE_CATALOG } from "../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/musicLibrary.js";
import {recordingIssue,soundRecordingSource} from '../apps/shorts/openfilm/packages/openfilm/src/recording-identity.mjs';
const exec = promisify(execFile),
  manifest = JSON.parse(
    await readFile("shorts-library/recordings.json", "utf8"),
  ),
  queue = [...SFX_CATALOG, ...BROWSE_CATALOG],
  results = [];
await Promise.all(
  [0, 1].map(async () => {
    while (queue.length) {
      const entry = queue.shift(),
        saved = manifest[entry.id];
      if (!saved) throw Error(`Missing ${entry.id}`);
      const path = "shorts-library/" + saved.file,
        bytes = await readFile(path);
      if (createHash("sha256").update(bytes).digest("hex") !== saved.sha256)
        throw Error(`Wrong bytes for ${entry.id}`);
      const issue=recordingIssue(entry.id,saved,entry.name??entry.title),source=soundRecordingSource(entry.id);
      if(source?.status==='verified'&&issue)throw Error(issue);
      if(source?.status==='unresolved'&&saved.identity?.status!=='unresolved')throw Error(`Unresolved source is not flagged: ${entry.id}`);
      await exec("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], {
        timeout: 120000,
      });
      results.push({
        id: entry.id,
        duration: saved.duration,
        bytes: bytes.length,
        source: saved.sourceUrl,
        playable:!issue,
      });
    }
  }),
);
console.log(
  JSON.stringify({
    downloaded: results.length,
    music: results.filter((e) => e.id.startsWith("mx-")).length,
    sfx: results.filter((e) => !e.id.startsWith("mx-")).length,
    verifiedSounds:results.filter(e=>!e.id.startsWith('mx-')&&e.playable).length,
    unresolvedSounds:results.filter(e=>!e.id.startsWith('mx-')&&!e.playable).length,
    playableRecordings:results.filter(e=>e.playable).length,
    decodedCompletely: true,
    allHashesMatch: true,
  }),
);
