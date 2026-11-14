// Microphone gate. Decides which audio chunks are sent and how they are tagged.
//  - A turn opens only after about ONSET_MS of sustained sound above the gate (ignores clicks, coughs, noise bursts).
//  - After the voice stops, HANG_MS of real audio is still sent but tagged "quiet", so word endings are not cut and the
//    server does not count that tail as speech (it measures the pause from the true end of your voice).
//  - Below the gate, silence (zeros) is sent so the server keeps a steady clock.
// Each result is [Int16Array pcm, flag]: flag 1 = voice, 0 = quiet.
(function (root) {
  class MicGate {
    constructor({ onsetMs = 250, hangMs = 500, rate = 16000, grace = 1 } = {}) {
      this.onsetMs = onsetMs; this.hangMs = hangMs; this.rate = rate; this.grace = grace;
      this.reset();
    }
    reset() {
      this.open = false; this.hangUntil = 0; this.aboveSince = 0;
      this.onset = []; this.miss = 0; this.prev = null;
    }
    process(pcm, level, now, gate) {
      const durMs = (pcm.length / this.rate) * 1000;
      const above = level > gate;
      const out = [];
      if (this.open) {
        if (above) { this.hangUntil = now + this.hangMs; out.push([pcm, 1]); }
        else if (now < this.hangUntil) out.push([pcm, 0]);
        else { this.open = false; out.push([new Int16Array(pcm.length), 0]); }
      } else if (above || (this.onset.length && this.miss < this.grace)) {
        // Building up to an opening. One quiet chunk in the middle is tolerated (speech dips between syllables).
        if (above) this.miss = 0; else this.miss++;
        if (!this.aboveSince) this.aboveSince = now;
        this.onset.push(pcm);
        if (above && now - this.aboveSince + durMs >= this.onsetMs) {
          this.open = true; this.hangUntil = now + this.hangMs; this.aboveSince = 0; this.miss = 0;
          if (this.prev) out.push([this.prev, 0]);            // the chunk just before the voice began
          for (const p of this.onset) out.push([p, 1]);
          this.onset = [];
        }
      } else {
        this.aboveSince = 0; this.onset = []; this.miss = 0;
        out.push([new Int16Array(pcm.length), 0]);
      }
      this.prev = pcm;
      return out;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { MicGate };
  else root.MicGate = MicGate;
})(typeof window !== "undefined" ? window : globalThis);
