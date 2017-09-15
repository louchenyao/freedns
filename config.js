module.exports = {
    IP: "0.0.0.0",
    SECONDARY_UPSTREAM_TYPE: "udp",
    SECONDARY_UPSTREAM_SERVER: "8.8.8.8", // it only be used  when the SECONDARY_UPSTREAM_TYPE is "udp"
    EDNS_IP: "165.227.17.124",

    MIN_TTL: 600,
    DUMP_PERIOD: 50,
    LAZY_UPDATE_PERIOD: 0.1,
    CACHE_EXPERIED_TIME: 60 * 60 * 24 * 15, // seconds // 15 days
    CLEAN_CACHE_PERIOD: 60 * 60, // seconds // 1 hours
    HTTP_MAX_SOCKETS: 15
}
