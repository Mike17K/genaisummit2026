// Microphone gate. Decides which audio chunks are sent and how they are tagged.
//  - A turn opens only after about ONSET_MS of sustained sound above the gate (ignores clicks, coughs, noise bursts).
//  - After the voice stops, HANG_MS of real audio is still sent but tagged "quiet", so word endings are not cut and the
//    server does not count that tail as speech (it measures the pause from the true end of your voice).
//  - Below the gate, silence (zeros) is sent so the server keeps a steady clock.
// Each result is [Int16Array pcm, flag]: flag 1 = voice, 0 = quiet.
(function (root) {
  class MicGate {
    constructor({
      onsetMs = 250,
      hangMs = 500,
      rate = 16000,
      grace = 1,
      sustainFactor = 0.65,
      adaptiveFloor = false,
      peakDropFactor = 0,
      maxOpenMs = 0,
    } = {}) {
      this.onsetMs = onsetMs; this.hangMs = hangMs; this.rate = rate; this.grace = grace;
      this.sustainFactor = sustainFactor;
      this.adaptiveFloor = adaptiveFloor;
      this.peakDropFactor = peakDropFactor;
      this.maxOpenMs = maxOpenMs;
      this.noiseFloor = 0;
      this.reset();
    }
    reset(keepFloor = false) {
      this.open = false; this.hangUntil = 0; this.aboveSince = 0;
      this.openedAt = 0; this.forceQuietUntil = 0; this.turnPeak = 0; this.lastOpenThresh = 0;
      this.onset = []; this.miss = 0; this.prev = null;
      if (!keepFloor) this.noiseFloor = 0;
    }
    process(pcm, level, now, gate) {
      const durMs = (pcm.length / this.rate) * 1000;
      if (this.forceQuietUntil && now < this.forceQuietUntil) {
        if (this.adaptiveFloor) {
          this.noiseFloor = Math.min(0.08, 0.70 * this.noiseFloor + 0.30 * level);
        }
        this.open = false;
        this.prev = pcm;
        return [[new Int16Array(pcm.length), 0]];
      }
      if (this.adaptiveFloor) {
        if (this.noiseFloor === 0) {
          this.noiseFloor = Math.min(level, 0.035);
        } else if (level < this.noiseFloor) {
          this.noiseFloor = 0.78 * this.noiseFloor + 0.22 * level;
        } else if (!this.open && this.onset.length === 0) {
          this.noiseFloor = Math.min(0.08, 0.96 * this.noiseFloor + 0.04 * level);
        }
      }
      const floorOpen = this.adaptiveFloor ? this.noiseFloor * 1.45 : 0;
      const floorSustain = this.adaptiveFloor ? this.noiseFloor * 1.25 : 0;
      const openThresh = Math.max(gate, floorOpen);
      this.lastOpenThresh = openThresh;
      const aboveOpen = level > openThresh;
      const out = [];
      if (this.open) {
        if (this.maxOpenMs > 0 && now - this.openedAt >= this.maxOpenMs) {
          this.open = false;
          this.turnPeak = 0;
          this.forceQuietUntil = now + 520;
          this.prev = pcm;
          return [[new Int16Array(pcm.length), 0]];
        }
        const peakSustain = this.peakDropFactor > 0
          ? Math.min(this.turnPeak * this.peakDropFactor, openThresh * 0.90)
          : 0;
        const sustainThresh = Math.max(gate * this.sustainFactor, floorSustain, peakSustain);
        const aboveSustain = level > sustainThresh;
        if (aboveSustain) {
          this.turnPeak = Math.max(this.turnPeak * 0.992, level);
          this.hangUntil = now + this.hangMs;
          out.push([pcm, 1]);
        } else if (now < this.hangUntil) {
          out.push([pcm, 0]);
        } else {
          this.open = false;
          this.turnPeak = 0;
          out.push([new Int16Array(pcm.length), 0]);
        }
      } else {
        const aboveSustain = level > Math.max(gate * this.sustainFactor, floorSustain);
        if (aboveOpen || (this.onset.length && this.miss < this.grace)) {
          // Building up to an opening. Quiet chunks up to `grace` in the middle are tolerated (speech dips between syllables).
          if (aboveOpen) this.miss = 0; else this.miss++;
          if (!this.aboveSince) this.aboveSince = now;
          this.onset.push(pcm);
          if ((aboveOpen || aboveSustain) && now - this.aboveSince + durMs >= this.onsetMs) {
            this.open = true; this.openedAt = now; this.turnPeak = level;
            this.hangUntil = now + this.hangMs; this.aboveSince = 0; this.miss = 0;
            if (this.prev) out.push([this.prev, 0]);            // the chunk just before the voice began
            for (const p of this.onset) out.push([p, 1]);
            this.onset = [];
          }
        } else {
          this.aboveSince = 0; this.onset = []; this.miss = 0;
          out.push([new Int16Array(pcm.length), 0]);
        }
      }
      this.prev = pcm;
      return out;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { MicGate };
  else root.MicGate = MicGate;
})(typeof window !== "undefined" ? window : globalThis);
