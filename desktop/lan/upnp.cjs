function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function makeUpnpDeviceXml({ ip, port, uuid, friendlyName, version = "" }) {
  const baseUrl = `http://${ip}:${port}/`;
  const presentationUrl = `${baseUrl}?remote=1${version ? `&v=${encodeURIComponent(version)}` : ""}`;
  return `<?xml version="1.0" encoding="utf-8"?>\r\n<root xmlns="urn:schemas-upnp-org:device-1-0">\r\n  <specVersion><major>1</major><minor>0</minor></specVersion>\r\n  <URLBase>${xmlEscape(baseUrl)}</URLBase>\r\n  <device>\r\n    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>\r\n    <friendlyName>${xmlEscape(friendlyName)}</friendlyName>\r\n    <manufacturer>DK</manufacturer>\r\n    <modelDescription>PyDroid Node LAN Web Interface</modelDescription>\r\n    <modelName>PyDroid Node</modelName>\r\n    <modelNumber>1.0</modelNumber>\r\n    <UDN>uuid:${xmlEscape(uuid)}</UDN>\r\n    <presentationURL>${xmlEscape(presentationUrl)}</presentationURL>\r\n  </device>\r\n</root>\r\n`;
}

module.exports = { makeUpnpDeviceXml };
