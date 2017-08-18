let dns = require("native-dns");
let server = dns.createServer();

let https = require('https');

let con_path = function (questions) {
    p = ""
    for (let x of questions) {
    }
    return p;
}

let quest = function (questions, callback) {
    let answers = [];

    quest_cache()
    
    let options = {
        hostname: "dns.google.com",
        port: 443,
        path: con_path(questions)
    }

    https.request(options, (res) => {
        let buf = Buffer.alloc(0);
        res.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk]);
        });
        res.on("end", () => {
            let ret = JSON.parse(buf.toString("utf8"));
            let https_answers = ret.get("answer", []);
            update_cache(https_answers);

            // turn to native-dns answer format
            for (let x in https_answers) {
                answers.push(x); // todo
            }
            callback(answers);
        });
    });
}

server.on("request", (req, res) => {
    // console.log(req);
    quest(req.questions, (answers) => {
        res.answer.concat(answers);
        res.send();
    });
});

server.serve(53);