import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

export async function launchCaptureBrowser() {
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!executablePath && !existsSync(chromium.executablePath()) && process.env.LOCALAPPDATA) {
    const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    const installed = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse() : [];
    executablePath = installed.map(name => path.join(cache, name, 'chrome-win64/chrome.exe')).find(existsSync);
  }
  return chromium.launch(executablePath ? { executablePath } : {});
}
