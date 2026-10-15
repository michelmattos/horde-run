// Renders the game's music and effects to WAV files offline, for listening and for
// level checks: `node scripts/render-audio.mjs <outdir> [loops]`. Starts the Vite dev
// server, opens headless Chromium on it and imports the real src/audio modules there,
// so what you hear is exactly the game's code (same instruments, songs, recipes,
// recorded takes, levels and reverb), at the default Music and Effects volumes.
// Writes music-<song>.wav (each loop `loops` times, default 1), sfx-<sound>.wav for
// every effect, and sfx-reel.wav (all effects in a row). ffmpeg can turn them into
// MP3s or measure loudness (ebur128).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? 'audio-render';
const loops = Number(process.argv[3] ?? 1);
const PORT = Number(process.env.PORT ?? 4198);
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && resolve());
  server.on('exit', () => reject(new Error('vite exited')));
});

function wav(channels, rate) {
  const n = channels[0].length;
  const buf = Buffer.alloc(44 + n * channels.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * channels.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels.length, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels.length * 2, 28);
  buf.writeUInt16LE(channels.length * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * channels.length * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[i])) * 32767), o);
      o += 2;
    }
  }
  return buf;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`http://localhost:${PORT}/audio/CREDITS.md`);
  const results = await page.evaluate(async (loopCount) => {
    const rate = 44100;
    const audio = await import('/src/audio/index.ts');
    const { createMusicPlayer } = await import('/src/audio/music.ts');
    const { SONGS, songSeconds } = await import('/src/audio/songs.ts');
    const { makeNoise, makeReverbImpulse } = await import('/src/audio/dsp.ts');
    const { SAMPLES } = await import('/src/audio/samples.ts');
    const { RECIPES, recipeKey } = await import('/src/audio/synth.ts');
    const { defaultSettings } = await import('/src/core/settings.ts');
    const s = defaultSettings();
    const musicGain = audio.masterGain(true, false, s.musicVolume) * audio.MUSIC_LEVEL;
    const sfxGain = audio.masterGain(true, false, s.sfxVolume) * audio.SFX_LEVEL;

    // The game's output stage: limiter, effects compressor and the shared reverb.
    function stage(oc) {
      const limiter = oc.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 2;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      limiter.connect(oc.destination);
      const comp = oc.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(limiter);
      const reverb = oc.createConvolver();
      reverb.buffer = makeReverbImpulse(oc);
      reverb.connect(limiter);
      const bus = (to, v) => {
        const g = oc.createGain();
        g.gain.value = v;
        g.connect(to);
        return g;
      };
      return {
        sfx: bus(comp, sfxGain),
        sfxSend: bus(reverb, sfxGain),
        music: bus(limiter, musicGain),
        musicSend: bus(reverb, musicGain),
      };
    }
    const pack = (b) => Array.from({ length: b.numberOfChannels }, (_, i) => Array.from(b.getChannelData(i)));

    const out = {};
    for (const id of Object.keys(SONGS)) {
      const len = songSeconds(SONGS[id]) * loopCount + 2.5;
      const oc = new OfflineAudioContext(2, Math.ceil(len * rate), rate);
      const st = stage(oc);
      const player = createMusicPlayer(oc, st.music, st.musicSend, makeNoise(oc), true);
      player.play(id, { fadeIn: 0.01 });
      player.pump(len - 2.5);
      out[`music-${id}`] = pack(await oc.startRendering());
    }

    // Effects: a recorded take where the game has one, else the recipe, at its rule volume.
    const takes = {};
    for (const [id, set] of Object.entries(SAMPLES)) {
      takes[id] = [];
      for (const f of set.files) {
        const data = await (await fetch(`/${f}`)).arrayBuffer();
        takes[id].push(await new OfflineAudioContext(1, 1, rate).decodeAudioData(data));
      }
    }
    const playSfx = (oc, st, id, t) => {
      const g = oc.createGain();
      g.gain.value = audio.SOUND_RULES[id].volume;
      g.connect(st.sfx);
      const send = audio.SEND[id] ?? 0;
      if (send) {
        const sg = oc.createGain();
        sg.gain.value = send;
        g.connect(sg);
        sg.connect(st.sfxSend);
      }
      const set = SAMPLES[id];
      if (set) {
        g.gain.value *= set.gain;
        (set.hits ?? [0]).forEach((at, i) => {
          const src = oc.createBufferSource();
          src.buffer = takes[id][i % takes[id].length];
          src.playbackRate.value = (set.rate[0] + set.rate[1]) / 2;
          src.connect(g);
          src.start(t + at);
        });
        return;
      }
      RECIPES[recipeKey(id)].play({ ctx: oc, out: g, noise: makeNoise(oc) }, t);
    };
    const reelGap = 0.35;
    let reelLen = 0;
    for (const id of audio.SOUND_IDS) reelLen += RECIPES[recipeKey(id)].dur + reelGap;
    const reel = new OfflineAudioContext(2, Math.ceil((reelLen + 2) * rate), rate);
    const reelStage = stage(reel);
    let t = 0.2;
    for (const id of audio.SOUND_IDS) {
      const oc = new OfflineAudioContext(2, Math.ceil((RECIPES[recipeKey(id)].dur + 1.5) * rate), rate);
      playSfx(oc, stage(oc), id, 0.05);
      out[`sfx-${id}`] = pack(await oc.startRendering());
      playSfx(reel, reelStage, id, t);
      t += RECIPES[recipeKey(id)].dur + reelGap;
    }
    out['sfx-reel'] = pack(await reel.startRendering());
    return out;
  }, loops);
  for (const [name, chans] of Object.entries(results)) {
    writeFileSync(join(outDir, `${name}.wav`), wav(chans, 44100));
  }
  console.log(`wrote ${Object.keys(results).length} files to ${outDir}`);
} finally {
  await browser.close();
  server.kill();
}
