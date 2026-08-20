import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

function desktopDataDirectory() {
  if (platform() === "darwin") return path.join(homedir(), "Library", "Application Support", "Clyra");
  if (platform() === "win32") return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "Clyra");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "Clyra");
}

const destinationDirectory = desktopDataDirectory();
await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });

for (const filename of [".env.local", ".env.fish.local"]) {
  const source = path.resolve(filename);
  const destination = path.join(destinationDirectory, filename);

  try {
    await stat(source);
  } catch {
    continue;
  }

  try {
    await stat(destination);
    // A user-managed desktop key file always wins. Do not overwrite it with a
    // developer checkout or embed either file in the distributable application.
    console.log(`Desktop runtime config already exists: ${destination}`);
  } catch {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
    console.log(`Installed local desktop runtime config: ${destination}`);
  }
}
