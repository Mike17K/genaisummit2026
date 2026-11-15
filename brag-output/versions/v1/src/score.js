  // SCORE BODY — VoxEye Sketchbook (60.0s @ 120 BPM)
  const T = TIMELINE, cu = T.cues;
  to = 'm';
  // Warm, upbeat acoustic-style pad + plucks across the 7 eras
  const chords = [
    [0.0,  6.8,  ['D3', 'A3', 'E4', 'Fs4']],
    [6.8,  13.6, ['G3', 'D4', 'G4', 'B4']],
    [13.6, 21.8, ['A3', 'E4', 'A4', 'Cs5']],
    [21.8, 30.5, ['Bm3', 'Fs4', 'B4', 'D5'].map(n => n === 'Bm3' ? 'B2' : n)],
    [30.5, 38.2, ['G3', 'D4', 'G4', 'B4']],
    [38.2, 53.5, ['D3', 'A3', 'D4', 'Fs4']],
    [53.5, 60.0, ['G3', 'D4', 'A4', 'Fs5']],
  ];
  for (const [t0, t1, notes] of chords) {
    pad(t0, t1, notes, 0.032, { type: 'triangle', cut: 1050, att: 0.15, rel: 0.25, send: 0.35 });
  }
  // Upbeat melodic plucks on downbeats
  const melody = ['D5', 'Fs5', 'A5', 'E5', 'Fs5', 'D5', 'B4', 'A4'];
  for (let bar = 0; bar < 30; bar++) {
    const bt = bar * 2.0;
    pluck(bt, nz(melody[bar % melody.length]), 0.14, -0.15, 0.4, 3400, 0.3);
    pluck(bt + BEAT, nz(melody[(bar + 2) % melody.length]), 0.11, 0.15, 0.35, 3000, 0.25);
  }

  to = 's';
  // Pencil sketch scratches on era starts
  for (const t0 of [0.2, 7.0, 13.8, 22.0, 30.7, 38.4, 53.7]) {
    for (let i = 0; i < 8; i++) noiseHit(t0 + i * E16, 0.06, 'bandpass', 3400 + (i % 3) * 300, 2, 0.035, -0.15);
  }
  // Stereo Geiger sonar beeps in Era 2 (15.0 - 20.5s): left, center, right
  for (let i = 0; i < 16; i++) {
    const st = 15.2 + i * 0.28;
    blip(st, 880, 920, 0.045, 0.045, 0.0); // Center hazard 0.78m (both ears)
    if (i % 2 === 0) blip(st + 0.12, 520, 540, 0.04, 0.03, -0.65); // Left ear 1.85m
    if (i % 3 === 0) blip(st + 0.18, 460, 480, 0.04, 0.025, 0.65); // Right ear 2.10m
  }
  // Shape-morph whooshes & chimes at bridge times
  for (const tc of T.morphs) {
    sweep(tc - 0.35, tc + 0.1, 0.012, 480, 2400, 0);
    chime(tc + 0.05, [nz('D5'), nz('A5'), nz('Fs6')], 0.055, 0);
  }
