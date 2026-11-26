// Mengenali model HP, sistem operasi, dan browser dari data yang diizinkan browser.
// Catatan: browser tidak memberi akses ke MAC address / IMEI.

export type DeviceInfo = { model: string; os: string; browser: string };

type UAData = {
  brands?: { brand: string; version: string }[];
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    model?: string;
    platform?: string;
    platformVersion?: string;
    fullVersionList?: { brand: string; version: string }[];
  }>;
};

function browserFromUA(ua: string): string {
  const m =
    ua.match(/SamsungBrowser\/(\d+)/) ? `Samsung Internet ${ua.match(/SamsungBrowser\/(\d+)/)![1]}` :
    ua.match(/EdgA?\/(\d+)/) ? `Edge ${ua.match(/EdgA?\/(\d+)/)![1]}` :
    ua.match(/OPR\/(\d+)/) ? `Opera ${ua.match(/OPR\/(\d+)/)![1]}` :
    ua.match(/Firefox\/(\d+)/) || ua.match(/FxiOS\/(\d+)/) ? `Firefox ${(ua.match(/Firefox\/(\d+)/) || ua.match(/FxiOS\/(\d+)/))![1]}` :
    ua.match(/CriOS\/(\d+)/) ? `Chrome ${ua.match(/CriOS\/(\d+)/)![1]}` :
    ua.match(/Chrome\/(\d+)/) ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}` :
    ua.match(/Version\/(\d+).*Safari/) ? `Safari ${ua.match(/Version\/(\d+)/)![1]}` :
    "";
  return m;
}

function fromUA(ua: string): DeviceInfo {
  let model = "";
  let os = "";
  const ios = ua.match(/(iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/);
  if (ios) {
    model = ios[1];
    os = `iOS ${ios[2]}.${ios[3]}`;
  } else {
    const and = ua.match(/Android (\d+(?:\.\d+)?)(?:;\s*([^;)]+))?/);
    if (and) {
      os = `Android ${and[1]}`;
      const raw = (and[2] || "").replace(/\s*Build\/.*$/, "").trim();
      if (raw && raw !== "K" && !/^(wv|mobile|tablet|rv:.*)$/i.test(raw)) model = raw.replace(/^SAMSUNG\s+/i, "Samsung ");
    } else if (/Windows NT/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Linux/.test(ua)) os = "Linux";
  }
  return { model, os, browser: browserFromUA(ua) };
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const ua = navigator.userAgent;
  const base = fromUA(ua);
  const uad = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const h = await uad.getHighEntropyValues(["model", "platform", "platformVersion", "fullVersionList"]);
      if (h.model) base.model = h.model;
      if (h.platform === "Android" && h.platformVersion) base.os = `Android ${h.platformVersion.split(".")[0]}`;
      if (!base.browser && h.fullVersionList?.length) {
        const b = h.fullVersionList.find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand));
        if (b) base.browser = `${b.brand} ${b.version.split(".")[0]}`;
      }
    } catch {
      /* browser menolak, pakai data user agent */
    }
  }
  if (!base.model && /Android/.test(ua)) base.model = "HP Android";
  return base;
}
