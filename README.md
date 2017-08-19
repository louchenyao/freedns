# free-dns

A high-efficient-cache and anti-spoofing DNS Server.

The upstream base on the Google's DNS-Over-HTTPS.

# Setup Up

## Server

```bash
git clone https://github.com/Chenyao2333/freedns.git
cd freedns
npm install
sudo node index.js
```

You can set the `EDNS_IP` in index.js to your subnet, to utilize EDNS optimize upstream results.

And you can open [http://localhost:5353/](http://localhost:5353/) in browser to check internal status.

## Client

Change the DNS server ip to your setuped freedns ip address. Different OS has different way to change DNS server, you can get help through Baidu or Google. Or just change your router's DHCP DNS to freedns is an alternative way.

# Cache

freedns uses "Lazy Update" as cache policy. If a requst is experied, it just returns a old results and add this request to queue and update results when connecting is idle.
