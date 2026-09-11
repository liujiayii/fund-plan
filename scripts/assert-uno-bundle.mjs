/**
 * 生产 CSS 回归闸门：挡住「构建成功但工具类全丢」的静默失败。
 *
 * 旧坑：unocss/vite 在 RR8 Environment API 下找不到 vite:css-post，
 * 只甩一行警告，产物 CSS 只剩 ~48 字节占位符 `#--unocss--{layer:...}`。
 * 本脚本在 `react-router build` 之后跑，检查 client 产物里真有工具类。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CLIENT_ASSETS = path.resolve("build/client/assets");
const MIN_CSS_BYTES = 10_000;
const REQUIRED = [".text-ink", "--fp-primary", ".font-num"];
const FORBIDDEN = ["#--unocss--", "@unocss-placeholder"];

function fail(msg) {
  console.error(`[assert-uno-bundle] ${msg}`);
  process.exit(1);
}

let files;
try {
  files = readdirSync(CLIENT_ASSETS)
    .filter(name => name.endsWith(".css"))
    .map(name => path.join(CLIENT_ASSETS, name));
}
catch {
  fail(`找不到 ${CLIENT_ASSETS}，是不是还没跑 pnpm build？`);
}

if (files.length === 0)
  fail("build/client/assets 里没有任何 .css");

const css = files.map(f => readFileSync(f, "utf8")).join("\n");
const maxBytes = Math.max(...files.map(f => statSync(f).size));

if (maxBytes < MIN_CSS_BYTES) {
  fail(
    `最大 CSS 只有 ${maxBytes} 字节（门槛 ${MIN_CSS_BYTES}）。`
    + ` 旧坑的占位符大约 48 字节，工具类几乎肯定丢了。`,
  );
}

for (const needle of FORBIDDEN) {
  if (css.includes(needle))
    fail(`产物里出现占位符 ${needle}，vite:css-post 注入失败`);
}

for (const needle of REQUIRED) {
  if (!css.includes(needle))
    fail(`产物里找不到 ${needle}，UnoCSS 工具类没进包`);
}

console.log(
  `[assert-uno-bundle] ok：${files.length} 个 CSS，最大 ${maxBytes} 字节，工具类在。`,
);
