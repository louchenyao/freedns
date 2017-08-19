let dns = require("native-dns");
let https = require("https");
let request = require("request");

let server = dns.createServer();

let cache = {};

let update_cache = function(answers) {
    for (let x of answers) {
        // todo
    }
}

let quest_cache = function(que, callback) {
    callback([], false);
}

let quest_google = function(que, callback) {
    let p = "https://dns.google.com/resolve?name=" + que["name"] + "&type=" + que["type"] + "&edns_client_subnet=59.66.130.20";
    console.log("requst_url: " + p);
    request(p, (err, res, body) => {
        // console.log(body);
        let ret = JSON.parse(body);
        let answers = ret["Answer"] || [];
        let authoritys = ret["Authority"] || [];
        let additionals = ret["Additional"] || [];

        // if (additionals) console.log(additionals);

        update_cache(answers, "answer");
        update_cache(authoritys, "authority");

        // console.log(answers);
        callback(answers, authoritys);
    });
}

let quest = function (questions, callback) {
    let answers = [];
    let authoritys = [];
    console.log("questions: " + JSON.stringify(questions));
    
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
    console.log("google_answers: " + JSON.stringify(google_answers));
    let ret = [];
    for (let x of google_answers) {
        let item = {name: x["name"], ttl: x["TTL"], type: x["type"], class: 1};

        if (x.type == 1) { // A
            item["address"] = x["data"];
            ret.push(dns.A(item));
        } else if (x.type == 28) { // AAA
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
        } else if (x.type == 15) { // mx
            data = x["data"].split(" ");
            item["priority"] = parseInt(data[0])
            item["exchange"] = data[1];
            ret.push(dns.MX(item));
        }
    }
    console.log("native_return: " + JSON.stringify(ret));
    return ret;
}

server.on("request", (req, res) => {
    // console.log(req);
    quest(req.question, (answers, authoritys) => {
        res.answer = res.answer.concat(to_native_dns_answers(answers));
        res.authority = res.authority.concat(to_native_dns_answers(authoritys));
        res.send();
        console.log("===");
    });
});

server.serve(53);