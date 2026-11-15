  // SCORE BODY — VoxEye 60s Sketchbook Story (Iteration 5 / v6 Master)
  // Warm acoustic plucks/pads on `m` + synchronized foley, stamp thuds,
  // eraser scrubs, checkmark chimes & accelerating 3-sector stereo Geiger sonar on `s`.
  const T = TIMELINE, cu = T.cues;
  to = 'm';

  // Warm D-major / A-major / G-major acoustic harmonic beds
  pad(0.0, 6.8, ['D3', 'A3', 'E4'], 0.028, { type: 'triangle', cut: 900, att: 0.08, rel: 0.25 });
  pad(6.8, 13.6, ['D3', 'Fs3', 'A3', 'E4'], 0.036, { type: 'triangle', cut: 1200, att: 0.1, rel: 0.3, send: 0.35 });
  pad(13.6, 21.8, ['G2', 'D3', 'A3', 'Fs4'], 0.035, { type: 'triangle', cut: 1100, att: 0.1, rel: 0.3, send: 0.3 });
  pad(21.8, 30.5, ['A2', 'E3', 'Cs4', 'A4'], 0.035, { type: 'triangle', cut: 1250, att: 0.1, rel: 0.3, send: 0.35 });
  pad(30.5, 38.2, ['G2', 'D3', 'B3', 'Fs4'], 0.038, { type: 'triangle', cut: 1300, att: 0.1, rel: 0.3, send: 0.35 });
  pad(38.2, 53.5, ['D2', 'A2', 'Fs3', 'D4', 'A4'], 0.042, { type: 'triangle', cut: 1400, att: 0.15, rel: 0.35, send: 0.4 });
  pad(53.5, 60.0, ['D2', 'A2', 'Fs3', 'E4', 'A4'], 0.045, { type: 'triangle', cut: 1500, att: 0.15, rel: 0.4, send: 0.45 });

  // Upbeat marimba-like plucks on every era reveal
  const revealTimes = [0.4, 7.1, 13.9, 22.1, 30.8, 38.5, 53.8];
  revealTimes.forEach((rt) => {
    [['D5', 0], ['Fs5', E16], ['A5', E8]].forEach(([n, dt], i) => {
      pluck(rt + dt, nz(n), 0.18 - i * 0.03, -0.15 + i * 0.15, 0.45, 3800, 0.35);
    });
  });

  // ---- SFX BUS (`to = 's'`) — Mixed alongside the upbeat music track & voice! ----
  to = 's';

  // 1. Pencil sketch write-ons in each scene
  [0.2, 1.0, 6.9, 7.9, 13.8, 22.0, 30.7, 38.3, 53.7].forEach((st) => {
    for (let i = 0; i < 10; i++) {
      noiseHit(st + i * E16, 0.055, 'bandpass', 3400 + (i % 3) * 320, 2.0, 0.04, -0.15 + (i % 2) * 0.3);
    }
  });

  // 2. Eraser scrub foley at t=22.9..23.6s (rubbing out street noise in Era 3)
  for (let i = 0; i < 8; i++) {
    noiseHit(22.95 + i * 0.08, 0.065, 'bandpass', 1800 + (i % 2) * 450, 1.2, 0.06, 0.05);
  }

  // 3. Rubber stamp thud SFX (2.2s, 38.8s, 54.4s)
  [2.2, 38.8, 54.4].forEach((st) => {
    noiseHit(st, 0.085, 'lowpass', 480, 1.4, 0.08, 0.0);
    blip(st, 150, 65, 0.075, 0.09, 0.0);
  });

  // 4. Green CheckMark 2-note chimes (9.2s, 16.35s, 23.9s, 34.2s, 49.0s)
  [9.2, 16.35, 23.9, 34.2, 49.0].forEach((ct) => {
    chime(ct, [nz('A5'), nz('E6')], 0.065, 0.15);
  });

  // 5. Era 2 (14.6 - 20.8s): Accelerating 3-Sector Stereo Geiger Sonar!
  //    Starts at 1.8m (slow 0.42s interval, 580Hz) -> 1.2m (0.25s, 740Hz) -> 0.8m (fast 0.12s, 920Hz)
  //    then pans to LEFT EAR (-0.75) as the green clear-path steering arrow opens!
  const sonarSchedule = [
    [14.60, 560, -0.75, 0.045],
    [15.02, 620,  0.00, 0.050],
    [15.38, 680,  0.00, 0.055],
    [15.68, 740,  0.00, 0.060],
    [15.92, 820,  0.00, 0.065],
    [16.10, 880,  0.00, 0.070],
    [16.24, 920,  0.00, 0.075],
    [16.38, 940,  0.00, 0.075],
    // Steer into clear LEFT EAR sector (-0.75 pan)
    [16.75, 660, -0.78, 0.055],
    [17.15, 660, -0.78, 0.050],
    [17.60, 520,  0.78, 0.045]
  ];
  sonarSchedule.forEach(([st, freq, pan, gain]) => {
    blip(st, freq, freq * 1.04, gain, 0.048, pan);
  });

  // 6. Era 5 (39.2 - 42.6s): Live Walk Stereo Sonar Obstacle Dodge inside P6_WIN
  [
    [39.30, 680,  0.00, 0.050],
    [39.58, 780,  0.00, 0.058],
    [39.80, 880,  0.00, 0.065],
    [39.96, 920,  0.00, 0.068],
    [40.25, 640, -0.75, 0.052],
    [40.65, 620, -0.75, 0.048]
  ].forEach(([st, freq, pan, gain]) => {
    blip(st, freq, freq * 1.04, gain, 0.045, pan);
  });

  // 7. Smooth whoosh sweeps into each shape-morph bridge
  [6.8, 13.6, 21.8, 30.5, 38.2, 53.5].forEach((tc) => {
    sweep(tc - 0.45, tc, 0.012, 480, 2400, 0);
    chime(tc, [nz('D5'), nz('A5'), nz('E6')], 0.055, 0);
  });
