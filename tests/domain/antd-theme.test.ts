import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { Button, Card, ConfigProvider, Form, Input, InputNumber, Pagination, Progress, Segmented, Select, Table, Tabs, Tag } from "antd";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANTD_THEME_CSS, getAntdTheme } from "~/theme-antd";

function renderControls(id: "ceramic" | "graphite") {
  const cache = createCache();
  const controls = [
    h(Button, { key: "button", type: "text" }, "文字"),
    h(Form, { key: "form" }, h(Form.Item, { label: "用户名", required: true }, h(Input))),
    h(Card, { key: "card", extra: "更多" }),
    h(Segmented, { key: "segmented", options: ["一月", "三月"] }),
    h(Tabs, { key: "tabs", items: [{ key: "1", label: "总览" }] }),
    h(Select, { key: "select", value: "x", options: [{ value: "x" }] }),
    h(InputNumber, { key: "number", value: 1 }),
    h(Table, { key: "table", pagination: false, columns: [{ title: "基金", dataIndex: "name" }], dataSource: [] }),
    h(Pagination, { key: "page", total: 40, showSizeChanger: false }),
    h(Progress, { key: "progress", percent: 40 }),
    h(Tag, { key: "tag", color: "purple" }, "定投"),
  ];
  const html = renderToString(h(StyleProvider, { cache }, h(ConfigProvider, { theme: getAntdTheme(id) }, ...controls)));
  const css = extractStyle(cache);
  const variables = new Map([...css.matchAll(/(--ant-[a-z0-9-]+):([^;{}]+)/g)].map(match => [match[1], match[2].trim()]));
  return { html, css, variables };
}

describe("antd 首屏主题变量", () => {
  const a = renderControls("ceramic");
  const b = renderControls("graphite");

  it.each([
    "--ant-form-label-color",
    "--ant-card-extra-color",
    "--ant-table-header-color",
    "--ant-tabs-item-color",
    "--ant-segmented-item-color",
    "--ant-button-text-text-color",
    "--ant-select-selector-bg",
    "--ant-pagination-item-active-color",
    "--ant-progress-default-color",
  ])("%s 在真实 SSR 样式中保留变量，不锁死服务端颜色", (name) => {
    expect(a.variables.get(name)).toContain("var(");
    expect(b.variables.get(name)).toBe(a.variables.get(name));
  });

  it("首屏覆盖命中 antd 真正输出的变量作用域", () => {
    const config = getAntdTheme("ceramic").cssVar;
    const key = typeof config === "object" ? config.key : undefined;
    expect(typeof key).toBe("string");
    expect(a.html).toContain(key);
    expect(b.html).toContain(key);
    expect(ANTD_THEME_CSS).toContain(`:root .${key}{`);
  });

  it("预设标签实际引用的颜色变量也有明暗定义，数字色阶沿用官方命名", () => {
    const references = [...a.css.matchAll(/var\((--ant-purple-\d+)\)/g)].map(match => match[1]);
    expect(references.length).toBeGreaterThan(0);
    for (const name of new Set(references)) expect(ANTD_THEME_CSS).toContain(`${name}:`);
    expect(ANTD_THEME_CSS).toContain("--ant-control-item-bg-hover:");
    expect(ANTD_THEME_CSS).toContain("--ant-control-item-bg-active-disabled:");
    expect(ANTD_THEME_CSS).toContain(":root[data-theme=\"graphite\"]");
    expect(ANTD_THEME_CSS).toContain(":root:not([data-theme])");
  });
});
