# Just Enough

**A Game About Context Engineering.**

[Play at murch.org/justenough](https://murch.org/justenough/) · [The story](https://murch.org/enough/) · [Mike Murchison](https://murch.org/)

Help Pip, a friendly delivery robot, carry pastries through Toronto’s Riverside and Leslieville. Choose up to four facts, send Pip, and revise the brief when the task or street changes. Three deliveries take roughly 8–12 minutes; you can also explore the neighbourhood.

This began with a conversation between Mike Murchison and Rinoc Johnson at Ada about compression, context windows, and task-dependent information. Intelligence involves choosing useful context, not simply maximizing it. The game uses deterministic planning rules, not a live AI model; its four-memory limit is a teaching device.

Mike built the game with Astra over a weekend, using his own photo library, recorded street videos, public geography, architectural references and iterative playtesting. Original personal photographs, footage, transcripts and private research are not part of this repository.

## Run it

Requires Node.js 20.19+ or 22.12+ and a browser with WebGL2.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No API keys, accounts or runtime model service are needed.

```sh
npm test
npm run eval:matrix
npm run build:site
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist-site
```

The complete static website is in `dist-site/`; the game is at `/justenough/`. The older `/enough/play/` address redirects to it. `npm run build` also produces a standalone game in `dist/`.

## Controls

WASD/arrows move; Shift rolls faster. Drag to look around, scroll to zoom, R to recenter. E inspects nearby clues; B/Tab opens the brief. The question mark explains the premise and controls. The map offers quick visits. Progress is saved in the browser.

## Rush: a hidden race mode

Off by default, and nothing in the game links to it. Type `rush` while playing (or open `?garage`) to reach the Garage, where each part switches on separately:

- **Rush mode**: you are the human operator. While Pip walks her route, she hands you urgent bundles: meet her, then make three drops across the neighbourhood before the clock runs out. A race car with Rocket League-style handling (jumps, double jumps, dodge flips, air control, boost, powerslide) and boost pads on the side streets. **C** swaps between Pip and the car.
- **Mini-map**: Pip, her delivery, your targets and the big boost pads. **M** enlarges it.
- **Downtown and the Tower Run**: drive west past River Street and keep going. The City roof outlines the game already uses as a distant backdrop become lit, solid buildings on an OpenStreetMap street grid, all the way to the CN Tower. Crossing into downtown starts a timer to the foot of the tower; your best time is saved.
- **Supersonic**, **Phase through buildings** and **Moon gravity** for blasting through the city.

Car controls: WASD drive (and pitch/yaw in the air), Space jump, Shift or left mouse boost, X powerslide, Q/E air roll, R reset. A standard gamepad works too (triggers drive, A jump, B boost, X slide, Y swap). The car, pads and map load only once switched on; settings are saved in the browser. Code lives in `src/rush/`; car models are CC BY 4.0, credited in `public/models/race/CREDITS.txt`.

## Graphics

The pause menu and the opening screen offer four tiers. **Low** turns off shadows and post-processing and shortens the draw distance (level of detail); **Balanced** drops the contact-shadow pass and halves the shadow map; **High** is the authored look; **Cinematic** adds resolution and distance. `?quality=low|balanced|high|cinematic` also works.

The map's finishing pass (fitting streets and buildings to the terrain and batching them for the GPU) runs per map tile, nearest first: the area around the player is ready before the first frame and the rest fills in during play. The finished city is identical to a one-shot build.

## Expand Toronto

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the runnable [route example](examples/new-neighbourhood.ts).

- Add a block: geography, terrain, building outlines and individually observed facades.
- Add a story: a task, limited information, changing world conditions, and a useful lesson.
- Improve the craft: movement, accessibility, materials, sound or performance.

The route planner accepts new node names and access rules. A general neighbourhood-pack loader and visual editor are future work. Current chapters and UI still have Queen East-specific rules.

## How it fits together

- `src/game.ts`: world truth, facts, three missions and delivery evaluation.
- `src/context-planner.ts`: generic planner that sees only the supplied access rules.
- `src/geography.ts`, `src/data/`: projected maps, streets, buildings and terrain.
- `src/geo-world.ts`, architectural modules: authored neighbourhood geometry.
- `src/scene.ts`, `src/motion.ts`, `src/physics.ts`: camera, movement, cart and Rapier collision.
- `src/main.ts`, `src/style.css`: game UI and saved progress.
- `site/`: personal homepage, project post and contribution page.
- `scripts/capture-film.mjs`: fixed-timestep in-game film capture (requires FFmpeg).

## A familiar place, with a glimpse of the future

The world covers King & River through Queen & Carlaw, with parts of De Grassi and Boulton. Mapped outlines and terrain are grounded in public data; many facades, heights and unseen details remain interpretations. This is a stylized reconstruction, not a survey or photogrammetric scan.

The Ontario Line and Leslieville Station appear completed, based on Metrolinx’s published artistic renderings, which remain subject to change. The game’s closed passage and winter conditions are fictional puzzle states, not live navigation information.

## Credits and licences

Original code is MIT licensed. **That licence does not cover every media asset.** Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `public/materials/CREDITS.txt`, `public/geography/CREDITS.txt`, and bundled font licences before reusing assets.

Mike Murchison’s own photo library and recorded videos are credited as inputs. Third-party mural art and documentary imagery retain their creators’ rights; they are not offered under MIT or CC0. Replace or obtain permission for those images when required for your reuse. Attribution is not a substitute for permission.

[Mike Murchison](https://murch.org/) · [@mimurchison](https://x.com/mimurchison)

### Trailer

The post features a 29-second, 1080p30 loop captured from the running game at 4K internal resolution. It shows genuine brief editing, route travel, and a successful delivery. The existing Skip travel control shortens the trip between edits. Cinematic lenses, larger presentation of the real UI, and captions are recording-only; they do not change game rules or player controls.

With the development server on port 5178, Chrome installed, and FFmpeg on your PATH:

```sh
node scripts/capture-film.mjs
node scripts/capture-gameplay-film.mjs
node scripts/assemble-trailer.mjs
node scripts/verify-trailer.mjs
```

Review `evidence/trailer/` before publishing. `PUBLISH_TRAILER=1 node scripts/assemble-trailer.mjs` copies the approved web video and poster to `site/assets/`. `DESKTOP_COPY` can specify a separate high-quality MP4 path. The output is silent for looping web and sound-off social playback. The ending and opening use consecutive frames of the same hero take, with a continuous title instead of a scene dissolve.

The title uses the same self-hosted Bricolage Grotesque face as the game, with Source Serif 4 as its companion. The scorecard measures composition, rhythm, gameplay clarity, visual integrity, typography and loop finish; scores are editorial judgments rather than audience testing or survey accuracy claims.

The personal site uses four 960px transparent AVIF paint textures. `scripts/build-paint.mjs` embeds them and the homepage fonts in a content-hashed, render-blocking stylesheet so they appear together without late asset requests. `node scripts/verify-paint.mjs` checks cold-load filmstrip frames, request timing, Retina rendering, mobile layout and fixed paint positioning.
