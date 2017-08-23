let dns = require("native-dns");
let express = require("express");
let request = require("request");
let https = require("https");
let http = require("http");
let fs = require("fs");
let util = require("util");

let server = dns.createServer();
let web = express();

// configures
const MIN_TTL = 600;
const DUMP_PERIOD = 60; // seconds
const LAZY_UPDATE_PERIOD = 0.1; // seconds
const EDNS_IP = "59.66.0.0/16"

http.globalAgent.maxSockets = 20;
https.globalAgent.maxSockets = 20;


// consts
const NOERROR = 0;
const SERVFAIL = 2;
const NOTFOUND = 3;

// global varibales
let cache = {};
let update_queue = [];
let dummping_cache = false;
let dummping_status = false;

let in_quest_google = 0;
let request_count = 0;
let success_count = 0;
let failed_count = 0;
let notfound_count = 0;

let now = function() {
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

let update_cache = function(que, content) {
    let key = que.name + "_" + que.type;

    let min_ttl = 9999999;
    let answers = content["Answer"] || [];
    let authoritys = content["Authority"] || [];

    for (let x of answers.concat(authoritys)) {
        if (x.TTL < min_ttl) min_ttl = x.TTL;
    }
    if (MIN_TTL > min_ttl) min_ttl = MIN_TTL;
    for (let x of answers.concat(authoritys)) {
        if (x.TTL < min_ttl) x.TTL = min_ttl;
    }

    cache[key] = [content, min_ttl + now()];
}

let quest_cache = function(que, callback) {
    let key = que.name + "_" + que.type;

    // console.log(key);

    if (!cache[key]) {
        callback([], [], false);
        return ;
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

let quest_google = function(que, callback) {
    // let agent = new https.Agent({keepAlive: true, maxSockets: 5});
    in_quest_google += 1;
    let p = "https://dns.google.com/resolve?name=" + que["name"] + "&type=" + que["type"] + "&edns_client_subnet=" + EDNS_IP;
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

let quest = function (questions, callback) {
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

        quest_cache(x, (ans, auth, hit) => {
            if (hit) {
                answers = answers.concat(ans);
                authoritys = authoritys.concat(auth);
                func(questions);
            } else {
                quest_google(x, (err_code, ans, auth) => {
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
    }) (questions);
}

let to_native_dns_answers = function(google_answers) {
    // console.log("google_answers: " + JSON.stringify(google_answers));
    let ret = [];
    for (let x of google_answers) {
        let item = {name: x["name"], ttl: x["TTL"], type: x["type"], class: 1};

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
    // console.log(req);
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
    if (in_quest_google >= 3) return;
    if (update_queue.length == 0) return;

    que = update_queue.pop();
    let key = que.name + "_" + que.type;
    if (cache[key][1] < now()) {
        quest_google(que);
    }

    if (update_queue.length) process_cache_queue();
}


setInterval(dump_cache, DUMP_PERIOD * 1000);
setInterval(dump_status, DUMP_PERIOD * 1000);
setInterval(process_cache_queue, LAZY_UPDATE_PERIOD * 1000);

process.on('SIGINT', function() {
    dump_cache((err) => {
        dump_status((err) => {
            process.exit();
        });
    });
});

web.get("/", (req, res) => {
    status = util.format("request_count:\t%d\nsuccess_count:\t%d\nfailed_count\t%d\nnotfound_count:\t%d\nin_quest_google:\t%d\nupdate_queue_size:\t%d\n", request_count, success_count, failed_count, notfound_count, in_quest_google, update_queue.length);
    res.send(status);
});

load_cache();
load_status();

server.serve(53);
web.listen(5353);
