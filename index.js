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
            let answers = ret.get("answer", []);
            update_cache(answers);
            callback(answers);
        });
    });
}

let quest = function (questions, callback) {
    let answers = [];
    
    (function (questions) {
        if (!questions) {
            callback(answers);
            return;
        }

        x = questions[0];
        questions = questions.slice(1);

        for (let x of questions) {
            quest_cache(x, (ans, hit) => {
                if (hit) {
                    answers.concat(ans);
                    this.call(questions);
                } else {
                    quest_google(x, ans => {
                        if (ans) {
                            answers.concat(ans);
                            update_cache(ans);
                        }
                        this.call(questions);
                    });
                }
            });
        }
    }) (questions);
}

let to_native_dns_answers = function(google_answers) {
    let ret = []
    for (let x of google_answers) {
        if (x.type == 1) {
            ret.push()
        }
    }
}

server.on("request", (req, res) => {
    // console.log(req);
    quest(req.questions, (answers) => {
        res.answer = to_native_dns_answers(answers);
        res.send();
    });
});

server.serve(53);