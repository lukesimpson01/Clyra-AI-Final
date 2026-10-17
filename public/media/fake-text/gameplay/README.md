# Fake Text Story gameplay library

These local editing assets are silent, 720 x 1280 H.264 clips prepared from the user-supplied sources below:

- Subway Surfers (40s clips): https://youtu.be/QPW3XwBoQlw
- Minecraft (`minecraft-01`..`minecraft-05`, 40s clips): https://youtu.be/u7kdVe8q5zs
- GTA: https://youtu.be/ZtLrNBdXT7M

`minecraft-06` through `minecraft-09` (60s clips) and `trackmania/trackmania-01` (60s) were cut directly from gameplay recordings the user uploaded to this project rather than downloaded via `yt-dlp`; same processing (vertical crop, 30fps, silent) applied by hand.

The source videos identify themselves as no-copyright gameplay. Source audio is removed so it cannot conflict with message narration. Rebuild the yt-dlp-sourced categories with:

```bash
./tools/prepare-fake-text-gameplay.sh
```

The creator stores only a library clip ID in imported project data and resolves it against `lib/shorts/faketext-gameplay.ts`, which scans this folder fresh on every request. This prevents imported project files from injecting arbitrary media paths.
