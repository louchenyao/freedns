let dns = require("native-dns");
let https = require('https');

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
    let p = "/resolve?name=" + que["name"] + "type=" + que["type"];
    console.log(p);
    let options = {
        hostname: "dns.google.com",
        port: 443,
        path: p
    }

    https.request(options, res => {
        let buf = Buffer.alloc(0);
        res.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk]);
        });
        res.on("end", () => {
            let ret = JSON.parse(buf.toString("utf8"));
            let answers = ret.get("Answer", []);
            let authoritys = ret.get("Authority", []);
            update_cache(answers, "answer");
            update_cache(authoritys, "authorith");
            callback(answers, authoritys);
        });
    });
}

let quest = function (questions, callback) {
    let answers = [];
    let authoritys = [];
    
    (function (questions) {
        if (!questions) {
            callback(answers, authoritys);
            return;
        }

        x = questions[0];
        questions = questions.slice(1);

        quest_cache(x, (ans, auth, hit) => {
            if (hit) {
                answers.concat(ans);
                authoritys.concat(auth);
                this.call(questions);
            } else {
                quest_google(x, (ans, auth) => {
                    if (ans) {
                        answers.concat(ans);
                        authoritys.concat(auth);
                        update_cache(ans);
                    }
                    this.call(questions);
                });
            }
        });
    }) (questions);
}

let to_native_dns_answers = function(google_answers) {
    let ret = [];
    for (let x of google_answers) {
        let item = {name: x["name"], ttl: x["TTL"], address: x["data"], class: x["type"]};
        if (x.type == 1) {
            ret.push(dns.A(item));
        } else if (x.type == 28) {
            ret.push(dns.AAAA(item));
        } else if (x.type == 6) {
            ret.push(dns.CNAME(item));
        } else if (x.type == 15) {
            ret.push(dns.MX(item));
        }
    }
}

server.on("request", (req, res) => {
    // console.log(req);
    quest(req.questions, (answers, authoritys) => {
        res.answer = to_native_dns_answers(answers);
        res.authority = to_native_dns_answers(authoritys);
        res.send();
    });
});

server.serve(53);