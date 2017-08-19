let dns = require("native-dns");
let https = require("https");
let request = require("request");
let fs = require("fs");

let server = dns.createServer();

let cache = {};
let MIN_TTL = 3600;

let now = function() {
    return Date.now() / 1000;
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

    // fs.writeFileSync("cache.txt", JSON.stringify(cache));
}

let quest_cache = function(que, callback) {
    let key = que.name + "_" + que.type;

    // console.log(key);

    if (!cache[key]) {
        callback([], [], false);
        return ;
    }
    if (cache[key] < now()) {
        quest_google(que);
    }

    let ret = cache[key][0];
    let answers = ret["Answer"] || [];
    let authoritys = ret["Authority"] || [];

    // console.log("hitted!");

    callback(answers, authoritys, true);
}

let quest_google = function(que, callback) {
    let p = "https://dns.google.com/resolve?name=" + que["name"] + "&type=" + que["type"] + "&edns_client_subnet=59.66.130.20";
    // console.log("requst_url: " + p);
    request(p, (err, res, body) => {
        if (err) {
            console.log(err);
            // todo: try to record err...
            callback([], []);
            return;
        }

        // console.log(body);
        let ret = {};
        try {
            ret = JSON.parse(body);
        } catch (err) {
            console.log(err)
            // todo: try to record err...
            callback([], []);
            return;
        }
        let answers = ret["Answer"] || [];
        let authoritys = ret["Authority"] || [];
        let additionals = ret["Additional"] || [];

        // if (additionals) console.log(additionals);

        if (ret["Status"] != 0) {
            // todo: try to record err...
            callback([], []);
            return;
        }
        update_cache(que, ret);

        // console.log(answers);
        callback(answers, authoritys);
    });
}

let quest = function (questions, callback) {
    let answers = [];
    let authoritys = [];
    // console.log("questions: " + JSON.stringify(questions));
    
    (function func(questions) {
        if (questions.length == 0) {
            callback(answers, authoritys);
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
                quest_google(x, (ans, auth) => {
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
    quest(req.question, (answers, authoritys) => {
        // todo: if error ocurs, response error qrcode
        res.answer = res.answer.concat(to_native_dns_answers(answers));
        res.authority = res.authority.concat(to_native_dns_answers(authoritys));
        res.send();
        console.log("qustions: " + JSON.stringify(req.question) + "\nanswers: " + JSON.stringify(answers) + "\nauthoritys: " + JSON.stringify(authoritys));
    });
});

/*
try {
    cache_txt = fs.readFileSync("cache.txt");
    cache = JSON.parse(cache_txt);
    console.log("cache.txt loaded.");
} catch (error) {
    console.log("Failed loading cache.txt");
}*/
server.serve(53);
