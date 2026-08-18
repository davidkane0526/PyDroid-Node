package com.dk.pydroidflow;

final class UpnpDeviceDescription {
    static String build(String ip, int port, LanDeviceIdentity identity) {
        String base = "http://" + ip + ":" + port + "/";
        String presentation = base + "?remote=1";
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n" +
            "<root xmlns=\"urn:schemas-upnp-org:device-1-0\">\r\n" +
            "  <specVersion><major>1</major><minor>0</minor></specVersion>\r\n" +
            "  <URLBase>" + xml(base) + "</URLBase>\r\n" +
            "  <device>\r\n" +
            "    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>\r\n" +
            "    <friendlyName>" + xml(identity.friendlyName) + "</friendlyName>\r\n" +
            "    <manufacturer>DK</manufacturer>\r\n" +
            "    <modelDescription>PyDroid Node LAN Web Interface</modelDescription>\r\n" +
            "    <modelName>PyDroid Node</modelName>\r\n" +
            "    <modelNumber>1.0</modelNumber>\r\n" +
            "    <UDN>uuid:" + xml(identity.uuid) + "</UDN>\r\n" +
            "    <presentationURL>" + xml(presentation) + "</presentationURL>\r\n" +
            "  </device>\r\n" +
            "</root>\r\n";
    }

    private static String xml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }
}
