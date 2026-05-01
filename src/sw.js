// Disable the following settings controlled through `chrome.privacy.*`:
const privacySettings = {
  "network": [
    "networkPredictionEnabled",
    "webRTCIPHandlingPolicy",
  ],
  "services": [
    "alternateErrorPagesEnabled",
    "autofillAddressEnabled",
    "autofillCreditCardEnabled",
    "passwordSavingEnabled",
    "spellingServiceEnabled",
    "translationServiceEnabled",
  ],
  "websites": [
    "adMeasurementEnabled",
    "doNotTrackEnabled",
    "fledgeEnabled",
    "hyperlinkAuditingEnabled",
    "relatedWebsiteSetsEnabled",
    "thirdPartyCookiesAllowed",
    "topicsEnabled"
  ],
};

chrome.runtime.onInstalled.addListener(async (_) => {
  for (const category in privacySettings) {
    for (const setting of privacySettings[category]) {
      const value = setting === "webRTCIPHandlingPolicy" ? "disable_non_proxied_udp" : false;
      const obj = chrome.privacy[category][setting];
      const detail = await obj.get({});
      if (detail?.levelOfControl === "controlled_by_this_extension" ||
          detail?.levelOfControl === "controllable_by_this_extension") {
        obj.set({ "value": value });
      } else {
        console.warn(`Failed to set 'chrome.privacy.${category}.${setting}'.`);
      }
    }
  }
});


// And set reasonable defaults for the following settings controlled through
// `chrome.contentSettings.*`. For me, a reasonable default for most things is
// "block", as I find prompts more annoying than using the page info bubble to
// explicitly allow something for a given site. But I'm a Chromium developer
// who was responsible for the Permissions team for a time, so I'm weird.
const settingsToBlockEverywhere = [
  "automaticDownloads",
  // Not blocking "autoVerify": it's a reasonable tradeoff, IMO. 
  "camera",
  "clipboard",
  // Not blocking "cookies" given the 3P setting above: I'm fine with 1P data.
  // Not blocking "images" because I like pretty pictures.
  // Not blocking "javascript" here, will limit it below.
  "location",
  "microphone",
  "notifications",
  "popups",
  "sound"

  // Things that are missing (that I care about):
  //
  // "autoPictureInPicture",
  // "capturedSurfaceControl",
  // "federatedIdentityApi",
  // "hidDevices",
  // "idleDetection",
  // "localFonts",
  // "midiDevices",
  // "paymentHandler",
  // "usbDevices",
  // "v8",
  // "vr",
  // "sensors",
  // "serialPorts",
  // "windowManagement"
  //
  // Filed https://crbug.com/441665280 to discuss.
];

const setSettingFor = async (pattern, type, value) => {
  return chrome.contentSettings[type]?.set({
    "primaryPattern": pattern,
    "setting": value
  });
};

// Clicking the extension icon toggles these three settings on a per-origin basis.
const TOGGLEABLE = ["automaticDownloads", "sound", "javascript"];

// The contentSettings API has no "remove one rule" primitive: clear({}) wipes
// ALL rules for a type. So disabling an origin requires clearing everything,
// re-applying the global defaults, and re-enabling any other active origins.
// We track the enabled set in storage to make that round-trip possible.
const getEnabledOrigins = async () => {
  const { enabledOrigins = [] } = await chrome.storage.local.get("enabledOrigins");
  return enabledOrigins;
};

// Re-applies the global content-settings defaults for the given types, derived
// from settingsToBlockEverywhere and the javascript special-case. Used both on
// install and when clearing per-origin overrides in disableOrigin.
const applyGlobalRulesFor = async (types) => {
  for (const type of types) {
    if (settingsToBlockEverywhere.includes(type)) {
      await setSettingFor("<all_urls>", type, "block");
    }
  }
  if (types.includes("javascript")) {
    await setSettingFor("<all_urls>", "javascript", "block");
    await setSettingFor("https://*/*", "javascript", "allow");
  }
};

chrome.runtime.onInstalled.addListener(async (_) => {
  for (const type of settingsToBlockEverywhere) {
    await setSettingFor("<all_urls>", type, "block");
  }

  // For JavaScript, it would be a sad web indeed if JS wasn't allowed period, but
  // there's no good reason to expose ourselves to origins other than the ones we
  // intend to visit. That, of course, excludes HTTP sites, which are really anyone
  // on the network between you and the server. Let's special-case that here.
  await setSettingFor("<all_urls>", "javascript", "block");
  await setSettingFor("https://*/*", "javascript", "allow");

  // On a clean reinstall Chrome wipes content settings but storage survives,
  // so re-apply any per-origin enables that are still recorded there.
  for (const origin of await getEnabledOrigins()) {
    const pattern = `${origin}/*`;
    for (const type of TOGGLEABLE) {
      await setSettingFor(pattern, type, "allow");
    }
  }
});

// Clicking the extension icon toggles automaticDownloads, sound, and javascript
// for the current tab's origin. Uses `sound` as the indicator of toggle state.

const enableOrigin = async (origin) => {
  const origins = await getEnabledOrigins();
  if (!origins.includes(origin)) {
    await chrome.storage.local.set({ enabledOrigins: [...origins, origin] });
  }
  const pattern = `${origin}/*`;
  for (const type of TOGGLEABLE) {
    await setSettingFor(pattern, type, "allow");
  }
};

const disableOrigin = async (origin) => {
  const origins = await getEnabledOrigins();
  const remaining = origins.filter(o => o !== origin);
  await chrome.storage.local.set({ enabledOrigins: remaining });

  for (const type of TOGGLEABLE) {
    await chrome.contentSettings[type].clear({});
  }
  await applyGlobalRulesFor(TOGGLEABLE);

  for (const o of remaining) {
    const pattern = `${o}/*`;
    for (const type of TOGGLEABLE) {
      await setSettingFor(pattern, type, "allow");
    }
  }
};

const updateBadgeForTab = async (tab) => {
  if (!tab?.url || !tab?.id) return;
  let enabled = false;
  try {
    const origin = new URL(tab.url).origin;
    if (origin.startsWith("http")) {
      const { setting } = await chrome.contentSettings.sound.get({ primaryUrl: tab.url });
      enabled = setting === "allow";
    }
  } catch (_) { /* non-navigable URL, leave badge cleared */ }

  if (enabled) {
    await chrome.action.setBadgeBackgroundColor({ color: "#338833", tabId: tab.id });
    await chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
  } else {
    await chrome.action.setBadgeText({ text: "", tabId: tab.id });
  }
};

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  updateBadgeForTab(await chrome.tabs.get(tabId));
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") updateBadgeForTab(tab);
});

chrome.action.onClicked.addListener(async (tab) => {
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch (_) {
    return;
  }
  if (!origin.startsWith("http")) return;

  const { setting } = await chrome.contentSettings.sound.get({ primaryUrl: tab.url });
  const enabling = setting !== "allow";

  if (enabling) {
    await enableOrigin(origin);
    await chrome.action.setBadgeBackgroundColor({ color: "#338833", tabId: tab.id });
    await chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
  } else {
    await disableOrigin(origin);
    await chrome.action.setBadgeText({ text: "", tabId: tab.id });
  }
});
