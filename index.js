let dns = require("native-dns");
let geoip = require("geoip-lite");
let express = require("express");
let request = require("request");
let https = require("https");
let http = require("http");
let fs = require("fs");
let util = require("util");

let server = dns.createServer();
let web = express();

const CONFIG = require("./config");

http.globalAgent.maxSockets = CONFIG.HTTP_MAX_SOCKETS;
https.globalAgent.maxSockets = CONFIG.HTTP_MAX_SOCKETS;

// consts
const NOERROR = 0;
const SERVFAIL = 2;
const NOTFOUND = 3;

// global varibales
let cache = {};
let hosts = {};
let chain_domain_list = {};
let update_queue = [];
let dummping_cache = false;
let dummping_status = false;
let dummping_list = false;

let in_quest_google = 0;
let in_quest_udp = 0;
let request_count = 0;
let success_count = 0;
let failed_count = 0;
let notfound_count = 0;

function now() {
    return Date.now() / 1000;
}

function dump_cache(callback) {
    if (dummping_cache) return;
    dummping_cache = true;
    fs.writeFile("cache.txt", JSON.stringify(cache), err => {
        if (err) console.error(err);
        dummping_cache = false;

        if (callback) callback(err);
    });
}

function dump_status(callback) {
    if (dummping_status) return;
    dummping_status = true;

    status = {
        request_count: request_count,
        success_count: success_count,
        failed_count: failed_count,
        notfound_count: notfound_count
    }
    fs.writeFile("status.txt", JSON.stringify(status), err => {
        if (err) console.err(err);
        dummping_status = false;

        if (callback) callback(err);
    });
}

function dump_domain_list(callback) {
    if (dummping_list) return;
    dummping_list = true;

    let lists = {
        "chain_domain_list": chain_domain_list
    };
    fs.writeFile("domain_list.txt", JSON.stringify(lists), err => {
        if (err) console.err(err);
        dummping_list = false;

        if (callback) callback(err);
    });
}

function load_domain_list() {
    try {
        txt = fs.readFileSync("domain_list.txt");
        domain_list = JSON.parse(txt);
        chain_domain_list = domain_list["chain_domain_list"] || {};
        console.log("domain_list.txt loaded.");
    } catch (error) {
        console.error("Failed loading domain_list.txt");
    }
}

function load_cache() {
    try {
        cache_txt = fs.readFileSync("cache.txt");
        cache = JSON.parse(cache_txt);
        console.log("cache.txt loaded.");
    } catch (error) {
        console.error("Failed loading cache.txt");
    }
}

function load_status() {
    try {
        status_txt = fs.readFileSync("status.txt");
        status = JSON.parse(status_txt);
        request_count = status["request_count"] || 0;
        success_count = status["success_count"] || 0;
        failed_count = status["failed_count"] || 0;
        notfound_count = status["notfound_count"] || 0;
        console.log("status.txt loaded.");
    } catch (error) {
        console.error("Failed loading status.txt");
    }
}

function escape_comment(txt) {
    let p = txt.indexOf("#");
    if (p >= 0) {
        txt = txt.slice(0, p);
    }
    return txt;
}

function is_ipv4(ip) {
    return /^\d*.\d*.\d*.\d*$/.test(ip);
}

function is_chain_ip(ip) {
    let res = geoip.lookup(ip);
    return res && res.country == "CN";
}

function gen_answer_from_host(host) {
    try {
        let key = "";
        let value = {
            "Answer": [
                {
                    "name": "",
                    "type": 0,
                    "TTL": 600,
                    "data": ""
                }
            ],
            "Additional": [
            ]
        }

        let ip, name;
        host = host.split(" ");
        ip = host[0];
        name = host[1];
        if (name.endsWith(".")) {
            name = name.slice(0, -1);
        }

        key = name + "_";
        value["Answer"][0]["name"] = name + ".";
        value["Answer"][0]["data"] = ip;

        if (is_ipv4(ip)) {
            key += "1";
            value["Answer"][0]["type"] = 1;
        } else {
            key += "28";
            value["Answer"][0]["type"] = 28;
        }

        return [key, value];
    } catch (error) {
        console.error(error);
    }
}

function load_hosts() {
    let cnt = 0;
    try {
        hosts_txt = fs.readFileSync("hosts").toString();
        // console.log(hosts_txt);
        for (let host of hosts_txt.split("\n")) {
            host = escape_comment(host)
            if (host.length < 3) {
                continue
            }
            let key, value, ret;
            ret = gen_answer_from_host(host);
            key = ret[0];
            value = ret[1];
            // console.log(key, value);
            if (key) {
                hosts[key] = value;
                cnt += 1;
            }
        }
        console.log("Loaded " + cnt + " hosts.");
    } catch (error) {
        console.log("Faild loading hosts.");
        console.error(error);
    }
    // console.log(hosts);
}

function update_cache(que, content) {
    let key = que.name + "_" + que.type;

    let min_ttl = 9999999;
    let answers = content["Answer"] || [];
    let authoritys = content["Authority"] || [];

    for (let x of answers.concat(authoritys)) {
        if (x.TTL < min_ttl) min_ttl = x.TTL;
    }
    if (CONFIG.MIN_TTL > min_ttl) min_ttl = CONFIG.MIN_TTL;
    for (let x of answers.concat(authoritys)) {
        if (x.TTL < min_ttl) x.TTL = min_ttl;
    }

    if (min_ttl > CONFIG.MIN_TTL * 10) min_ttl = CONFIG.MIN_TTL * 10;

    cache[key] = [
        {
            "Answer": answers,
            "Authority": authoritys
        },
        min_ttl + now()
    ];
}

function quest_cache(que, callback) {
    let key = que.name + "_" + que.type;

    // console.log(key);

    if (!cache[key]) {
        callback([], [], false);
        return;
    }
    if (cache[key][1] < now()) {
        update_queue.push(que);
    }

    let ret = cache[key][0];
    let answers = ret["Answer"] || [];
    let authoritys = ret["Authority"] || [];

    // console.log("hitted!");

    callback(answers, authoritys, true);
}

function convert_native_to_google_answer(ans) {
    let data = "";
    if (ans.type == 1 || ans.type == 28) {
        data = ans.address;
    } else if (ans.type == 5) {
        data = ans.data;
    } else if (ans.type == 6) { // SOA
        data = [ans["primary"], ans["admin"], ans["serial"], ans["refresh"], ans["retry"], ans["expiration"], ans["minimum"]].join(" ");
    } else if (x.type == 15) { // MX
        data = [ans["priority"], ans["exchange"]].join(" ");
    }
    return {
        "name": ans.name + ".",
        "type": ans.type,
        "TTL": ans.ttl,
        "data": data
    };
}

function quest_udp_dns(que, callback) {
    let req = dns.Request({
        question: que,
        server: { address: '114.114.114.114', port: 53, type: 'udp' },
        timeout: 500
    });
    in_quest_udp += 1;
    req.on("message", (err, answer) => {
        //console.log(err);
        //console.log(answer);
        if (err) {
            callback(SERVFAIL, [], []);
            return;
        }

        let ret_ans = [];
        let ret_auth = [];
        for (let x of answer.answer) {
            ret_ans.push(convert_native_to_google_answer(x));
        }

        for (let x of answer.authority) {
            ret_auth.push(convert_native_to_google_answer(x));
        }

        callback(NOERROR, ret_ans, ret_auth);
    });

    req.on("end", (err) => {
        in_quest_udp -= 1;
    });

    req.send();
}


function quest_hosts(que, callback) {
    let key = que.name + "_" + que.type;
    if (!hosts[key]) {
        callback([], [], false);
        return;
    }

    let ret = hosts[key];
    let answers = ret["Answer"] || [];
    let authoritys = ret["Authority"] || [];

    callback(answers, authoritys, true);
}

function quest_google(que, callback) {
    // let agent = new https.Agent({keepAlive: true, maxSockets: 5});
    in_quest_google += 1;
    let p = "https://dns.google.com/resolve?name=" + que["name"] + "&type=" + que["type"] + "&edns_client_subnet=" + CONFIG.EDNS_IP;
    request(p, (err, res, body) => {
        in_quest_google -= 1;
        if (err) {
            console.error(err);
            if (callback) callback(SERVFAIL, [], []);
            return;
        }

        let ret = {};
        try {
            ret = JSON.parse(body);
        } catch (err) {
            console.error(err);
            if (callback) callback(SERVFAIL, [], []);
            return;
        }
        let answers = ret["Answer"] || [];
        let authoritys = ret["Authority"] || [];
        let additionals = ret["Additional"] || [];
        // if (additionals) console.log(additionals);

        if (ret["Status"] != 0) {
            if (callback) callback(ret["Status"], [], []);
            return;
        }
        update_cache(que, ret);
        if (callback) callback(NOERROR, answers, authoritys);
    });
}

function blocked(que, ans, sure) {
    // if sure is false, we can infer by the ans length
    if (!sure && (!ans || ans.length == 0)) {
        return !chain_domain_list[que.name];
    }

    if (ans.length > 0 && (ans[0].type == 1 || ans[0].type == 28) && !is_chain_ip(ans[0].data)) {
        return true;
    }

    return false;
}

function quest_net(x, callback) {
    if (chain_domain_list[x.name] !== false || x.udp_first) {
        quest_udp_dns(x, (err_code, ans, auth) => {
            if (err_code || blocked(x, ans)) { // maybe banned by gfw
                console.log("foreign: ", x);
                quest_google(x, callback);

                if (x.type == 1 && blocked(x, ans, true)) {
                    chain_domain_list[x.name] = false;
                }
                return;
            } else {
                if (x.type == 1) chain_domain_list[x.name] = true;

                update_cache(x, { "Answer": ans, "Authority": auth });
                if (callback) callback(err_code, ans, auth);
            }
        });
    } else {
        quest_google(x, callback);
    }
}

function quest(questions, callback) {
    let answers = [];
    let authoritys = [];
    // console.log("questions: " + JSON.stringify(questions));

    (function func(questions) {
        if (questions.length == 0) {
            callback(NOERROR, answers, authoritys);
            return;
        }

        x = questions[0];
        questions = questions.slice(1);

        quest_hosts(x, (ans, auth, hit) => {
            if (hit) {
                answers = answers.concat(ans);
                authoritys = authoritys.concat(auth);
                func(questions);
            } else {
                quest_cache(x, (ans, auth, hit) => {
                    if (hit) {
                        answers = answers.concat(ans);
                        authoritys = authoritys.concat(auth);
                        func(questions);
                    } else {
                        quest_net(x, (err_code, ans, auth) => {
                            if (err_code) {
                                callback(err_code, [], []);
                                return;
                            }
                            answers = answers.concat(ans);
                            authoritys = authoritys.concat(auth);
                            func(questions);
                        });
                    }
                });
            }
        });
    })(questions);
}

function to_native_dns_answers(google_answers) {
    // console.log("google_answers: " + JSON.stringify(google_answers));
    let ret = [];
    for (let x of google_answers) {
        //console.log(x);
        let item = { name: x["name"], ttl: x["TTL"], type: x["type"], class: 1 };

        if (x.type == 1) { // A
            item["address"] = x["data"];
            ret.push(dns.A(item));
        } else if (x.type == 28) { // AAAA
            item["address"] = x["data"];
            ret.push(dns.AAAA(item));
        } else if (x.type == 5) { // CNAME
            item["data"] = x["data"];
            ret.push(dns.CNAME(item));
        } else if (x.type == 6) { // SOA
            data = x["data"].split(" ");
            item["primary"] = data[0];
            item["admin"] = data[1];
            item["serial"] = parseInt(data[2]);
            item["refresh"] = parseInt(data[3]);
            item["retry"] = parseInt(data[4]);
            item["expiration"] = parseInt(data[5]);
            item["minimum"] = parseInt(data[6]);
            ret.push(dns.SOA(item));
        } else if (x.type == 15) { // MX
            data = x["data"].split(" ");
            item["priority"] = parseInt(data[0])
            item["exchange"] = data[1];
            ret.push(dns.MX(item));
        }
    }
    // console.log("native_return: " + JSON.stringify(ret));
    return ret;
}

server.on("request", (req, res) => {
    // console.log(req);ue
    request_count += 1;

    console.log("qustions: " + JSON.stringify(req.question));
    quest(req.question, (err_code, answers, authoritys) => {
        if (err_code) {
            console.log(util.format("ERROR: %d", err_code));
            console.log(answers);
            console.log(authoritys);
            if (err_code == NOTFOUND) notfound_count += 1;
            else failed_count += 1;
            res.rcode = err_code;
            res.send();
        } else {
            success_count += 1;
            res.answer = res.answer.concat(to_native_dns_answers(answers));
            res.authority = res.authority.concat(to_native_dns_answers(authoritys));
            res.send();
        }
    });
});


function process_cache_queue() {
    if (in_quest_google + in_quest_udp >= 3) return;
    if (update_queue.length == 0) return;

    que = update_queue.pop();
    let key = que.name + "_" + que.type;
    if (cache[key][1] < now()) {
        que.udp_first = true;
        quest_net(que);
    }

    if (update_queue.length) process_cache_queue();
}

function clean_cache() {
    // console.log("in clean_cache");
    let experied_time = now() + CONFIG.CACHE_EXPERIED_TIME;
    for (let key of Object.keys(cache)) {
        if (cache[key][1] >= experied_time) {
            delete cache[key];
            console.log("deleted " + key);
        }
    }
    // console.log("done");
}

setInterval(dump_cache, CONFIG.DUMP_PERIOD * 1000);
setInterval(dump_status, CONFIG.DUMP_PERIOD * 1000);
setInterval(dump_domain_list, CONFIG.DUMP_PERIOD * 1000);
setInterval(process_cache_queue, CONFIG.LAZY_UPDATE_PERIOD * 1000);
setInterval(clean_cache, CONFIG.CLEAN_CACHE_PERIOD * 1000);

process.on('SIGINT', function () {
    dump_cache((err) => {
        dump_status((err) => {
            dump_domain_list((err) => {
                process.exit();
            });
        });
    });
});

web.get("/", (req, res) => {
    status = util.format("request_count:\t%d\nsuccess_count:\t%d\nfailed_count\t%d\nnotfound_count:\t%d\nin_quest_google:\t%d\nin_quest_udp:\t%d\nupdate_queue_size:\t%d\n", request_count, success_count, failed_count, notfound_count, in_quest_google, in_quest_udp, update_queue.length);
    res.send(status);
});

load_cache();
load_status();
load_hosts();
load_domain_list();

server.serve(53, CONFIG.IP);
web.listen(5353, CONFIG.IP);
