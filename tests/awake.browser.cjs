// Run with Playwright available on NODE_PATH. Uses isolated browser profiles;
// never reads or writes the user's normal Z Note browser storage.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const appUrl = pathToFileURL(path.resolve(__dirname, '..', 'Z Note.html')).href;
const output = process.env.ZNOTE_TEST_OUTPUT;
const headed = process.env.ZNOTE_TEST_HEADED === '1';

(async () => {
  for (const channel of (process.env.ZNOTE_TEST_BROWSERS || 'chrome').split(',')) {
    const browser = await chromium.launch({ channel, headless: !headed });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(appUrl);
      await page.getByRole('button', { name: 'Use browser storage', exact: true }).click();
      const button = page.locator('.awake-toggle');
      await button.waitFor();
      assert.equal(await button.innerText(), 'Keep Awake');
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => ZN.awake.state().supported), true);

      await button.click();
      await page.waitForFunction(() => ZN.awake.state().active);
      assert.equal(await button.innerText(), 'Awake on');
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      if (output) {
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, channel + '-awake-on.png') });
      }

      // Hash routing rebuilds the top bar without dropping the lock.
      await page.locator('.side-nav [data-to="tasks"]').click();
      assert.equal(await button.innerText(), 'Awake on');
      assert.equal(await page.evaluate(() => ZN.awake.state().active), true);

      // A real minimized window should release and restore the native lock.
      if (headed) {
        const cdp = await context.newCDPSession(page);
        // Playwright forces focus/visibility by default, which masks minimize.
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        try {
          await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
          await page.waitForFunction(() => document.visibilityState === 'hidden' && !ZN.awake.state().active);
          assert.equal(await page.evaluate(() => ZN.awake.state().enabled), true);
        } finally {
          await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
          await page.bringToFront();
        }
        await page.waitForFunction(() => document.visibilityState === 'visible' && ZN.awake.state().active);
        await cdp.detach();
      }

      await page.evaluate(() => document.documentElement.setAttribute('data-paper', 'night'));
      if (output) await page.screenshot({ path: path.join(output, channel + '-awake-night.png') });
      await page.setViewportSize({ width: 660, height: 760 });
      assert.equal(await button.isVisible(), true);
      assert.equal(await button.locator('.awake-label').isVisible(), false);
      assert.ok((await button.boundingBox()).width >= 28);
      if (output) await page.screenshot({ path: path.join(output, channel + '-awake-compact.png') });
      await button.click();
      await page.waitForFunction(() => !ZN.awake.state().active && !ZN.awake.state().enabled);
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await button.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => ZN.awake.state().active);
      await page.reload();
      await button.waitFor();
      assert.equal(await page.evaluate(() => ZN.awake.state().enabled), false);
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.deepEqual(errors, []);
      console.log(channel + ': native wake lock, navigation, stop, keyboard, reload, themes, compact layout' + (headed ? ', minimize/resume' : '') + ' passed');
      await context.close();
    } finally {
      await browser.close();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
