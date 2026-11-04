// Bundle the deployed site into one offline-shareable HTML file.
const fs = require('node:fs');
const path = require('node:path');

const output = process.argv[2];
if (!output) {
    console.error('Usage: node scripts/build-standalone.cjs /absolute/path/output.html');
    process.exit(1);
}
const root = path.join(__dirname, '..');
const asset = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let html = asset('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${asset(href)}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
    const code = asset(src).replace(/<\/script/gi, '<\\/script');
    return `<script>\n${code}\n</script>`;
});
fs.writeFileSync(output, html);
console.log(`Wrote ${output} (${Buffer.byteLength(html)} bytes)`);
