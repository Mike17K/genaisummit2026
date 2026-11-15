// brag: launch Playwright's bundled Chromium, or fall back to an installed Google Chrome / Edge when the
// bundled browser isn't downloaded (e.g. `npx playwright install` couldn't reach its CDN).
export function withFallback(chromium) {
  const launch = chromium.launch.bind(chromium);
  return new Proxy(chromium, {
    get(target, key) {
      if (key !== 'launch') { const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v; }
      return async (opts = {}) => {
        try { return await launch(opts); } catch (e) {
          if (opts.channel || !/Executable doesn't exist|browserType\.launch/.test(e.message)) throw e;
          for (const channel of ['chrome', 'msedge']) { try { return await launch({ ...opts, channel }); } catch {} }
          throw e;
        }
      };
    },
  });
}
