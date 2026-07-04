import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import "./generate-assets.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const builds = [
  { browser: "firefox", outdir: "dist-firefox", target: "firefox115" },
  { browser: "chrome", outdir: "dist-chrome", target: "chrome120" }
];

const chromeBrowserPolyfill = String.raw`
(() => {
  if (typeof globalThis.browser !== "undefined" || typeof globalThis.chrome === "undefined") return;
  const chromeApi = globalThis.chrome;
  const promisify = (fn, receiver) => (...args) =>
    new Promise((resolve, reject) => {
      fn.call(receiver, ...args, (result) => {
        const lastError = chromeApi.runtime?.lastError;
        if (lastError) reject(new Error(lastError.message));
        else resolve(result);
      });
    });
  const wrapEvent = (event) => ({
    addListener(listener) {
      event.addListener((...args) => {
        const sendResponse = args.at(-1);
        try {
          const result = listener(...args.slice(0, -1));
          if (result && typeof result.then === "function") {
            result.then(sendResponse, (error) => sendResponse({ error: error?.message ?? String(error) }));
            return true;
          }
          return result;
        } catch (error) {
          if (typeof sendResponse === "function") sendResponse({ error: error?.message ?? String(error) });
          return false;
        }
      });
    }
  });
  globalThis.browser = {
    action: chromeApi.action ? { onClicked: chromeApi.action.onClicked } : undefined,
    alarms: chromeApi.alarms
      ? {
          clear: promisify(chromeApi.alarms.clear, chromeApi.alarms),
          create: (...args) => chromeApi.alarms.create(...args),
          onAlarm: chromeApi.alarms.onAlarm
        }
      : undefined,
    runtime: {
      sendMessage: promisify(chromeApi.runtime.sendMessage, chromeApi.runtime),
      openOptionsPage: promisify(chromeApi.runtime.openOptionsPage, chromeApi.runtime),
      onMessage: wrapEvent(chromeApi.runtime.onMessage)
    },
    storage: {
      local: {
        get: promisify(chromeApi.storage.local.get, chromeApi.storage.local),
        set: promisify(chromeApi.storage.local.set, chromeApi.storage.local),
        remove: promisify(chromeApi.storage.local.remove, chromeApi.storage.local),
        clear: promisify(chromeApi.storage.local.clear, chromeApi.storage.local)
      }
    },
    tabs: {
      create: promisify(chromeApi.tabs.create, chromeApi.tabs),
      get: promisify(chromeApi.tabs.get, chromeApi.tabs),
      query: promisify(chromeApi.tabs.query, chromeApi.tabs),
      sendMessage: promisify(chromeApi.tabs.sendMessage, chromeApi.tabs)
    }
  };
})();
`;

function chromeManifestFromFirefox(manifest) {
  const { browser_specific_settings: _browserSpecificSettings, background: _background, ...chromeManifest } = manifest;
  chromeManifest.background = {
    service_worker: "background/serviceWorker.js"
  };
  return chromeManifest;
}

async function writeManifest(browser, outdir) {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const outputManifest = browser === "chrome" ? chromeManifestFromFirefox(manifest) : manifest;
  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(outputManifest, null, 2)}\n`);
}

async function copyStaticAssets(outdir) {
  await cp("src/assets", `${outdir}/assets`, { recursive: true });
  await cp("src/options/options.html", `${outdir}/options/options.html`);
  await cp("src/options/options.css", `${outdir}/options/options.css`);
}

async function buildBrowser({ browser, outdir, target }) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await writeManifest(browser, outdir);
  await copyStaticAssets(outdir);

  const common = {
    bundle: true,
    target,
    sourcemap: true,
    logLevel: "info",
    ...(browser === "chrome" ? { banner: { js: chromeBrowserPolyfill } } : {})
  };

  await build({
    ...common,
    format: "iife",
    entryPoints: ["src/background/serviceWorker.ts"],
    outfile: `${outdir}/background/serviceWorker.js`
  });

  await build({
    ...common,
    format: "esm",
    entryPoints: ["src/content/pageScanner.ts"],
    outfile: `${outdir}/content/pageScanner.js`
  });

  await build({
    ...common,
    format: "iife",
    entryPoints: ["src/content/assistedSessionBridge.ts"],
    outfile: `${outdir}/content/assistedSessionBridge.js`
  });

  await build({
    ...common,
    format: "esm",
    entryPoints: ["src/options/options.ts"],
    outfile: `${outdir}/options/options.js`
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function zipBuild(browser, outdir) {
  await mkdir("packages", { recursive: true });
  const stableName = `lootcheck-${browser}.zip`;
  const versionedName = `lootcheck-${browser}-v${version}.zip`;
  await rm(`packages/${stableName}`, { force: true });
  await rm(`packages/${versionedName}`, { force: true });
  await run("zip", ["-qr", `../packages/${stableName}`, "."], { cwd: outdir });
  await cp(`packages/${stableName}`, `packages/${versionedName}`);
}

for (const buildConfig of builds) {
  await buildBrowser(buildConfig);
  await zipBuild(buildConfig.browser, buildConfig.outdir);
}
