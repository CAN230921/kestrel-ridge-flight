// Kestrel Ridge — make.fun entry packager (Node 22, standard library only).
// Copies the static WebGL2 flight game (game/) and browser captures (screenshots/)
// into the output directory and generates dossier.json via the vendored helper.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const PROJECT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function packageEntry(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  cpSync(join(PROJECT_ROOT, 'game'), join(OUTPUT_DIR, 'game'), { recursive: true });

  const shotsSrc = join(PROJECT_ROOT, 'screenshots');
  const shotsDst = join(OUTPUT_DIR, 'screenshots');
  mkdirSync(shotsDst, { recursive: true });
  if (existsSync(shotsSrc)) {
    cpSync(shotsSrc, shotsDst, { recursive: true });
  }

  const dossierPayload = buildDossier(OUTPUT_DIR, DOSSIER_LIMITS);
  writeFileSync(join(OUTPUT_DIR, 'dossier.json'), dossierPayload);
}

packageEntry();
