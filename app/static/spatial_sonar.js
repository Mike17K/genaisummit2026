// Stereo depth sonar for earphones: the view is split into LEFT / CENTER / RIGHT sectors, and the closest surface
// in each sector becomes a beep train placed in that ear. Closer = louder in both ears (per its side) and faster.
//
// UX limits so it stays informative instead of noisy:
// - silent beyond the range limit (default 2.5 m); every limit is user-tunable per ear (see DEFAULTS / LIMITS);
//   during a hold scan a very soft "alive" tick every 1.5 s when nothing is near
// - paused while the user talks (beeps must not leak into the mic), ducked while the assistant speaks
// - readings older than STALE_MS are dropped, so a stale obstacle never keeps beeping
// - at most MAX_VOICES (2) sectors beep at once, and only sectors within FOCUS_M of the closest one
// - beeps never overlap (MIN_GAP_MS), fastest repeat 130 ms, short 70 ms envelopes without clicks
// - master volume capped and passed through a limiter; vibration only for something very close straight ahead
//
// `sonarVoice` / `planVoices` are pure (testable in Node); `SpatialSonar` drives Web Audio.
(function (root) {
  const NEAR_M = 0.35;
  const FOCUS_M = 0.8;
  const MAX_VOICES = 2;
  const MIN_GAP_MS = 70;
  const ALIVE_TICK_MS = 1500;
  const STALE_MS = 1500;
  const FAR_INTERVAL_MS = 650;  // slowest repeat, for a surface at the edge of the range
  const SECTORS = ["left", "center", "right"];
  const EARS = ["left", "right"];
  // Ear routing per sector [left ear, right ear]: strict, no bleed. Left only in the left ear, right only in the
  // right ear, center in both; each scaled by that ear's own max volume.
  const EAR = { left: [1, 0], center: [1, 1], right: [0, 1] };

  // All tunable settings. Each EAR is independent:
  //   pitchHz     base pitch of that ear (its own register)
  //   maxVolume   loudest that ear ever gets (0..1, reached when a surface is touching)
  //   maxRateHz   fastest beep repeat for sounds on that side (beeps per second when touching)
  // Shared:
  //   rangeM        silent beyond this distance
  //   sideOffset    semitones: left sector shifts both ears down, right sector up
  //   centerSplit   semitones: a center obstacle pulls the two ears apart so it sounds "wide"
  //   proximityRise semitones the pitch climbs as a surface gets closer
  // ear frequency = pitchHz * 2^((sectorShift + centerSplit(ear) + closeness * proximityRise) / 12)
  const DEFAULTS = {
    ears: {
      left: { pitchHz: 440, maxVolume: 0.3, maxRateHz: 7.7 },
      right: { pitchHz: 587, maxVolume: 0.3, maxRateHz: 7.7 },
    },
    rangeM: 2.5,
    sideOffset: 3,
    centerSplit: 1,
    proximityRise: 5,
    pitchSmoothing: 0.2,  // light: big jumps settle in ~4-5 beeps, small ones in ~2 (0 = instant .. 0.95 = slow glide)
  };
  // Hard limits every setting is clamped to (also used by the settings UI sliders)
  const LIMITS = {
    pitchHz: [150, 1500, 1],
    maxVolume: [0, 1, 0.01],
    maxRateHz: [1.5, 12, 0.1],
    rangeM: [0.8, 5, 0.1],
    sideOffset: [0, 12, 0.5],
    centerSplit: [0, 6, 0.5],
    proximityRise: [0, 12, 0.5],
    pitchSmoothing: [0, 0.95, 0.05],
  };
  const MIN_HZ = 120, MAX_HZ = 2400;

  const clone = (c) => ({ ...c, ears: { left: { ...c.ears.left }, right: { ...c.ears.right } } });
  const clamp = (key, v) => Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], v));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let CFG = clone(DEFAULTS);

  // Merge any subset of settings; non-numbers are ignored and every value is clamped to LIMITS.
  function setSettings(over = {}) {
    const next = clone(CFG);
    for (const ear of EARS) {
      const o = over.ears && over.ears[ear];
      if (!o) continue;
      for (const k of ["pitchHz", "maxVolume", "maxRateHz"]) if (num(o[k]) !== null) next.ears[ear][k] = clamp(k, o[k]);
    }
    for (const k of ["rangeM", "sideOffset", "centerSplit", "proximityRise", "pitchSmoothing"]) {
      if (num(over[k]) !== null) next[k] = clamp(k, over[k]);
    }
    CFG = next;
    return getSettings();
  }
  const getSettings = () => clone(CFG);
  const resetSettings = () => { CFG = clone(DEFAULTS); return getSettings(); };

  function earFreq(ear, sector, p) {
    const shift = sector === "left" ? -CFG.sideOffset : sector === "right" ? CFG.sideOffset : 0;
    const split = sector === "center" ? (ear === "left" ? -CFG.centerSplit : CFG.centerSplit) : 0;
    const hz = CFG.ears[ear].pitchHz * Math.pow(2, (shift + split + p * CFG.proximityRise) / 12);
    return Math.round(Math.max(MIN_HZ, Math.min(MAX_HZ, hz)));
  }

  function proximity(distM) {
    const range = CFG.rangeM;
    if (typeof distM !== "number" || !Number.isFinite(distM) || distM <= 0 || distM >= range) return 0;
    return Math.max(0, Math.min(1, (range - distM) / Math.max(0.1, range - NEAR_M)));
  }

  // Repeat interval for a sector: its side's ear sets the fastest rate; center uses the average of both ears.
  function intervalFor(sector, p) {
    const rate = sector === "center"
      ? (CFG.ears.left.maxRateHz + CFG.ears.right.maxRateHz) / 2
      : CFG.ears[sector].maxRateHz;
    const fastest = 1000 / rate;
    const slowest = Math.max(FAR_INTERVAL_MS, fastest);
    return Math.round(slowest - (slowest - fastest) * p);
  }

  // One sector's sound for a distance: null = silent.
  function sonarVoice(sector, distM) {
    const p = proximity(distM);
    if (p <= 0 || !EAR[sector]) return null;
    const curve = 0.2 + 0.8 * Math.pow(p, 1.4);  // 20% of the ear's max at the range edge .. 100% touching
    const [wl, wr] = EAR[sector];
    if (CFG.ears.left.maxVolume * wl <= 0 && CFG.ears.right.maxVolume * wr <= 0) return null; // muted on both ears
    return {
      sector,
      distM: Number(distM.toFixed(2)),
      p: Number(p.toFixed(3)),
      gainL: Number((CFG.ears.left.maxVolume * curve * wl).toFixed(4)),
      gainR: Number((CFG.ears.right.maxVolume * curve * wr).toFixed(4)),
      freqL: earFreq("left", sector, p),
      freqR: earFreq("right", sector, p),
      intervalMs: intervalFor(sector, p),
    };
  }

  // Pitch smoothing: one-pole low-pass in LOG frequency (semitones), plus a cap on how far one beep may move,
  // so a sudden distance change becomes a short glide instead of a jump. Returns the next frequency to play.
  const FRESH_AFTER_MS = 1500;  // a side silent this long starts again at its target pitch
  function smoothFreq(prevHz, targetHz, smoothing = CFG.pitchSmoothing) {
    if (!(prevHz > 0) || smoothing <= 0) return targetHz;
    const semis = 12 * Math.log2(targetHz / prevHz);
    const maxStep = 0.5 + 4 * (1 - smoothing);          // 4.5 st/beep at 0 .. 0.7 st/beep at 0.95
    const step = Math.max(-maxStep, Math.min(maxStep, semis * (1 - smoothing)));
    const next = prevHz * Math.pow(2, step / 12);
    return Math.abs(12 * Math.log2(targetHz / next)) < 0.05 ? targetHz : Math.round(next * 10) / 10;
  }

  // Which sectors should sound now, closest first (focus + voice limits applied).
  function planVoices(sectors) {
    const all = SECTORS.map((s) => sonarVoice(s, sectors && sectors[s])).filter(Boolean);
    if (!all.length) return [];
    all.sort((a, b) => a.distM - b.distM);
    const nearest = all[0].distM;
    return all.filter((v) => v.distM - nearest <= FOCUS_M).slice(0, MAX_VOICES);
  }

  class SpatialSonar {
    // opts.isMuted(): true while the user is talking; opts.duck(): 0..1 volume factor (e.g. 0.45 while assistant speaks)
    constructor(getCtx, opts = {}) {
      this.getCtx = getCtx;     // () => AudioContext (shared with the app)
      this.isMuted = opts.isMuted || (() => false);
      this.duck = opts.duck || (() => 1);
      this.aliveTick = false;   // hold scan turns this on
      this.lastUpdateAt = 0;
      this.pitch = {};          // per sector: { L, R, at } last played (smoothed) frequencies
      this.sectors = { left: null, center: null, right: null };
      this.nextAt = { left: 0, center: 0, right: 0 };
      this.lastBeepAt = 0;
      this.lastSoundAt = 0;
      this.lastVibeAt = 0;
      this.timer = null;
      this.running = false;
      this.master = null;
      this.voices = [];
    }

    // Stereo output graph pinned to 2 discrete channels so the browser never up/down-mixes the ears together.
    _graph(ctx) {
      if (this.master && this.master.context === ctx) return this.master;
      const stereo = (node) => {
        node.channelCount = 2;
        node.channelCountMode = "explicit";
        node.channelInterpretation = "discrete";
        return node;
      };
      try {
        if (ctx.destination.maxChannelCount >= 2) ctx.destination.channelCount = 2;
      } catch (_) {}
      const limiter = stereo(ctx.createDynamicsCompressor());
      limiter.threshold.value = -12; limiter.knee.value = 6; limiter.ratio.value = 12;
      limiter.attack.value = 0.002; limiter.release.value = 0.12;
      const master = stereo(ctx.createGain());
      master.gain.value = 0.9;
      master.connect(limiter).connect(ctx.destination);
      this.master = master;
      return master;
    }

    // sectors: {left, center, right} distances in metres (null = nothing valid)
    update(sectors) {
      for (const s of SECTORS) {
        const d = sectors ? sectors[s] : null;
        this.sectors[s] = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
      }
      this.voices = planVoices(this.sectors);
      this.lastUpdateAt = performance.now();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.nextAt = { left: 0, center: 0, right: 0 };
      this.lastSoundAt = performance.now();
      this.timer = setInterval(() => this._tick(), 20);
    }

    stop() {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      this.voices = [];
      try { navigator.vibrate?.(0); } catch (_) {}
    }

    // One beep = one oscillator per ear (each ear has its own pitch), shared click-free envelope.
    _beep(ctx, freqL, freqR, gainL, gainR, durS = 0.07, from = null) {
      const t0 = ctx.currentTime + 0.005;
      const merger = ctx.createChannelMerger(2);
      merger.channelInterpretation = "discrete";
      merger.connect(this._graph(ctx));
      let pending = 0;
      const ear = (freq, gain, channel, fromHz) => {
        if (!(gain > 0)) return;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        if (fromHz > 0 && Math.abs(fromHz - freq) > 0.5) {
          osc.frequency.setValueAtTime(fromHz, t0);
          osc.frequency.exponentialRampToValueAtTime(freq, t0 + Math.min(0.025, durS * 0.4));
        } else {
          osc.frequency.setValueAtTime(freq, t0);
        }
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(gain, t0 + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
        osc.connect(env).connect(merger, 0, channel);
        osc.start(t0);
        osc.stop(t0 + durS + 0.01);
        pending++;
        osc.onended = () => { if (--pending === 0) { try { merger.disconnect(); } catch (_) {} } };
      };
      ear(freqL, gainL, 0, from && from.L);
      ear(freqR, gainR, 1, from && from.R);
    }

    _tick() {
      if (!this.running) return;
      const ctx = this.getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = performance.now();
      if (this.voices.length && now - this.lastUpdateAt > STALE_MS) this.voices = []; // depth source stalled
      if (this.isMuted()) { this.lastSoundAt = now; return; }
      if (now - this.lastBeepAt < MIN_GAP_MS) return;
      // Most urgent due voice first (voices are sorted closest first)
      const due = this.voices.find((v) => now >= this.nextAt[v.sector]);
      if (due) {
        const k = Math.max(0, Math.min(1, this.duck()));
        const prev = this.pitch[due.sector];
        const fresh = !prev || now - prev.at > FRESH_AFTER_MS;
        const fl = fresh ? due.freqL : smoothFreq(prev.L, due.freqL);
        const fr = fresh ? due.freqR : smoothFreq(prev.R, due.freqR);
        // each beep also glides from the previous pitch to the new one (no audible step inside the beep)
        this._beep(ctx, fl, fr, due.gainL * k, due.gainR * k, 0.07, fresh ? null : prev);
        this.pitch[due.sector] = { L: fl, R: fr, at: now };
        this.nextAt[due.sector] = now + due.intervalMs;
        this.lastBeepAt = this.lastSoundAt = now;
        if (due.sector === "center" && due.p > 0.85 && now - this.lastVibeAt > 400) {
          this.lastVibeAt = now;
          try { navigator.vibrate?.(40); } catch (_) {}
        }
        return;
      }
      if (this.aliveTick && !this.voices.length && now - this.lastSoundAt > ALIVE_TICK_MS) {
        this._beep(ctx, CFG.ears.left.pitchHz, CFG.ears.right.pitchHz, 0.012, 0.012, 0.03); // "still scanning, nothing near"
        this.lastBeepAt = this.lastSoundAt = now;
      }
    }

    // Settings UI: play one sample beep for a sector as if a surface were at distM
    test(sector, distM = 0.8) {
      const ctx = this.getCtx();
      const v = sonarVoice(sector, Math.min(distM, CFG.rangeM - 0.05));
      if (!ctx || !v) return null;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      this._beep(ctx, v.freqL, v.freqR, v.gainL, v.gainR);
      return v;
    }

    summary() {
      const f = (d) => (d == null ? "-" : `${d.toFixed(2)}m`);
      const active = this.voices.map((v) => v.sector[0].toUpperCase()).join("") || "none";
      return `L ${f(this.sectors.left)} · C ${f(this.sectors.center)} · R ${f(this.sectors.right)} (beeping: ${active})`;
    }
  }

  const api = {
    SpatialSonar, sonarVoice, planVoices, proximity, smoothFreq, setSettings, getSettings, resetSettings, DEFAULTS, LIMITS,
    NEAR_M, FOCUS_M, MAX_VOICES, SECTORS, STALE_MS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { SpatialSonarLib: api, SpatialSonar });
})(typeof window !== "undefined" ? window : globalThis);
