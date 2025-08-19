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
  // "windowManagement",
];

const setSettingFor = async (pattern, type, value) => {
  chrome.contentSettings[type]?.set({
    "primaryPattern": pattern,
    "setting": value
  });
};

chrome.runtime.onInstalled.addListener(async (_) => {
  for (const type of settingsToBlockEverywhere) {
    await setSettingFor("<all_urls>", type, "block");
  }

  // For JavaScript, it would be a sad web indeed if JS wasn't allowed period, but
  // there's no good reason to expose ourselves to origins other than the ones we
  // intend to visit. That, of course, excludes HTTP sites, which are really anyone
  // on the network between you and the server. Let's special-case that here.
  setSettingFor("<all_urls>", "javascript", "block");
  setSettingFor("https://*/*", "javascript", "allow");
});
