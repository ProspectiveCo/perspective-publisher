import * as fs from "node:fs";
import showdown from "showdown";
import cheerio from "cheerio";
import perspective from "@finos/perspective";
import {
    S3Client,
    PutObjectCommand
} from "@aws-sdk/client-s3";

let IS_AWS = false;
const args = process.argv.slice(2).filter(x => {
    if (x === "--aws") {
        IS_AWS = true;
        return false
    } else {
        return true
    }

});

const filename = args[0];
const input = fs.readFileSync(filename);
const converter = new showdown.Converter();
const html = converter.makeHtml(input.toString());
const dom = cheerio.load(html);
let id_gen = 0;
let script = "";

for (const x of dom("perspective-viewer")) {
    let url = dom(x).attr("data");
    if (IS_AWS) {
        const data = 
            url.endsWith(".arrow") ? fs.readFileSync(url) 
                : url.endsWith(".csv") ? fs.readFileSync(url).toString() 
                : JSON.parse(fs.readFileSync(url).toString());

        const table = await perspective.table(data);
        const view = await table.view();
        const arrow = await view.to_arrow();
        if (url.endsWith(".json")) {
            url.replace(".json", ".arrow");
        } else if (url.endsWith(".json")) {
            url.replace(".json", ".arrow");
        }

        view.delete();
        table.delete();

        const client = new S3Client({
            "endpoint": "https://us-east-1.linodeobjects.com",
            "region": "us-east-1",
            "credentials": {
                "accessKeyId": process.env["AWS_ACCESS_KEY"],
                "secretAccessKey": process.env["AWS_SECRET_KEY"],
            }
        });;

        await client.send(
            new PutObjectCommand({
                ACL: "public-read",
                Bucket: "prospective-test",
                Key: `thoughtmerchants/${url}`,
                Body: new Uint8Array(arrow),
            })
        );

        console.log( `Uploaded thoughtmerchants/${url} to object storage`);
        url = `https://prospective-test.us-east-1.linodeobjects.com/thoughtmerchants/${url}`
    }

    const config = JSON.parse(fs.readFileSync(dom(x).attr("config")).toString());
    const id = `viewer-${id_gen++}`;
    dom(x).attr("id", id);
    const method = url.endsWith(".arrow") ? "arrayBuffer" : url.endsWith(".csv") ? "text" : "json";
    script += `
        var viewer = document.querySelector("#${id}");
        var req = await fetch("${url}");
        var data = await req.${method}();
        var table = await worker.table(data);
        viewer.load(table);
        viewer.restore(${JSON.stringify(config)});
    `;

    dom(x).replaceWith(`<perspective-viewer id="${id}"></div>`);
}

dom("head").append(`
    <link rel="stylesheet" crossorigin="anonymous" href="/node_modules/@finos/perspective-viewer/dist/css/pro.css" />
    <script type="module" src="/node_modules/@finos/perspective-viewer/dist/cdn/perspective-viewer.js"></script>
    <script type="module" src="/node_modules/@finos/perspective-viewer-datagrid/dist/cdn/perspective-viewer-datagrid.js"></script>
    <script type="module" src="/node_modules/@finos/perspective-viewer-d3fc/dist/cdn/perspective-viewer-d3fc.js"></script>
    <script type="module" src="/node_modules/@finos/perspective-viewer-openlayers/dist/cdn/perspective-viewer-openlayers.js"></script>
    <style>
        perspective-viewer {
            display: block;
            width: 100%;
            height: 600px;
        }
    </style>
`);

dom("body").append(`
    <script type="module"> 
        import perspective from "/node_modules/@finos/perspective/dist/cdn/perspective.js";
        const worker = perspective.worker();
        ${script}
    </script>
`);

fs.writeFileSync(filename.replace(".md", ".html"), dom.html());
console.log(`Wrote "${filename.replace(".md", ".html")}"`);