import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/**
 * Builds real test images and audio from files that ship inside the @vladmandic/human npm package
 * (MIT licence): a webcam photo of one man, crops of other photos of the same man, and photos of other
 * people. Nothing is downloaded. A clearly labelled SPECIMEN test card is drawn with ffmpeg.
 */
export interface Fixtures {
  dir: string;
  webcam: string;
  same: string[];
  others: string[];
  specimen: string;
  speech: (text: string) => string;
  noise: string;
  photoFrames: (opts: { name: string; warps: string[] }) => string[];
}

function ff(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
}

export function makeFixtures(): Fixtures {
  const require = createRequire(import.meta.url);
  const assets = path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..', 'assets');
  const dir = path.join(os.tmpdir(), 'liveid-fixtures');
  mkdirSync(dir, { recursive: true });
  const p = (n: string) => path.join(dir, n);
  const grid = path.join(assets, 'screenshot-facematch.jpg');

  if (!existsSync(p('webcam.jpg'))) ff(['-i', path.join(assets, 'screenshot-faceid.jpg'), '-vf', 'crop=139:139:14:142,scale=480:480', p('webcam.jpg')]);
  const same = [1, 2, 3, 4].map((i) => {
    const out = p(`same${i}.jpg`);
    if (!existsSync(out)) ff(['-i', grid, '-vf', `crop=104:104:${2 + Math.floor((i * 1066) / 10)}:286,scale=312:312`, out]);
    return out;
  });
  const others = [0, 2, 3, 5].map((i) => {
    const out = p(`other${i}.jpg`);
    if (!existsSync(out)) ff(['-i', grid, '-vf', `crop=104:104:${2 + Math.floor((i * 1066) / 10)}:624,scale=312:312`, out]);
    return out;
  });

  const specimen = p('id-specimen.jpg');
  if (!existsSync(specimen)) {
    const bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    const reg = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const text = (t: string, x: number, y: number, size: number, color: string, font = bold) =>
      `drawtext=fontfile=${font}:text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`;
    ff([
      '-f', 'lavfi', '-i', 'color=c=0x2b2b2b:s=1280x960',
      '-i', p('webcam.jpg'),
      '-filter_complex',
      [
        '[1]crop=300:380:90:60,scale=250:316[face]',
        '[0]drawbox=x=134:y=161:w=1012:h=638:color=0xe8eef7:t=fill,drawbox=x=134:y=161:w=1012:h=110:color=0x1565d8:t=fill[card]',
        `[card][face]overlay=170:310,${[
          text('SPECIMEN TEST CARD', 180, 185, 40, 'white'),
          text('NOT A REAL ID - LIVE ID TEST FIXTURE', 180, 232, 22, 'white', reg),
          text('NOM / NAME', 470, 320, 24, '0x333333'),
          text('SPECIMEN, JEAN', 470, 352, 36, 'black'),
          text('DATE DE NAISSANCE / DOB', 470, 420, 24, '0x333333'),
          text('1981-04-12', 470, 452, 36, 'black'),
          text('EXPIRATION', 470, 520, 24, '0x333333'),
          text('2030-04-12', 470, 552, 36, 'black'),
          text('NO  S1234-567890-12', 470, 640, 30, 'black'),
        ].join(',')}`,
      ].join(';'),
      '-frames:v', '1', '-q:v', '3', specimen,
    ]);
  }

  const speech = (t: string) => {
    const out = p(`speech-${t.replace(/\W+/g, '_')}.wav`);
    if (!existsSync(out)) ff(['-f', 'lavfi', '-i', `flite=text='${t}':voice=slt`, '-ar', '16000', '-ac', '1', out]);
    return out;
  };
  const noise = p('noise.wav');
  if (!existsSync(noise)) ff(['-f', 'lavfi', '-i', 'anoisesrc=d=3:a=0.05', '-ar', '16000', '-ac', '1', noise]);

  /** Frames of a still photo, optionally warped (ffmpeg perspective) to imitate tilting a printed photo. */
  const photoFrames = ({ name, warps }: { name: string; warps: string[] }) =>
    warps.map((w, i) => {
      const out = p(`${name}-${i}.jpg`);
      if (!existsSync(out)) ff(['-i', p('webcam.jpg'), '-vf', `scale=480:480${w ? ',' + w : ''},pad=640:480:80:0`, '-q:v', '4', out]);
      return out;
    });

  return { dir, webcam: p('webcam.jpg'), same, others, specimen, speech, noise, photoFrames };
}
