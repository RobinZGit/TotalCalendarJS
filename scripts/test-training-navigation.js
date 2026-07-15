const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");

function extractFunction(name) {
  const start = html.indexOf("function " + name + "(");
  assert(start >= 0, "Function not found: " + name);
  const bodyStart = html.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    if (html[i] === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error("Unterminated function: " + name);
}

function makeListElement() {
  const list = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    querySelectorAll() {
      return [];
    },
  };
  Object.defineProperty(list, "innerHTML", {
    set() {
      this.children = [];
    },
  });
  return list;
}

function runBuild(items) {
  const currentT = makeListElement();
  let addActionCalls = 0;
  const context = {
    Gl_aRithmLisp: items,
    currentT,
    document: {
      createElement(tag) {
        return { tagName: tag, className: "", textContent: "" };
      },
    },
    addAction() {
      addActionCalls += 1;
      return "buttonCurrentTr" + arguments[3];
    },
  };
  vm.runInNewContext(extractFunction("buildTrainingNavigationList"), context);
  context.buildTrainingNavigationList();
  return { currentT, addActionCalls };
}

const normal = runBuild([1000, "первый", 2000, "второй"]);
assert.strictEqual(normal.addActionCalls, 2, "normal navigation must remain detailed");
assert.strictEqual(normal.currentT.children.length, 0);

const longTraining = [];
for (let i = 0; i < 7200; i += 1) {
  longTraining.push(i % 2 ? 30000 : 3000, i % 2 ? "пульс" : "время");
}
const capped = runBuild(longTraining);
assert.strictEqual(capped.addActionCalls, 0, "long training must not create thousands of buttons");
assert.strictEqual(capped.currentT.children.length, 1);
assert.match(capped.currentT.children[0].textContent, /7200 шагов/);

const buttons = [1, 3, 5].map((index) => ({
  id: "buttonCurrentTr" + index,
  className: "",
  style: {},
}));
const progressContext = {
  document: {
    getElementById(id) {
      assert.strictEqual(id, "currentT", "progress must not scan every rhythm index");
      return { querySelectorAll: () => buttons };
    },
  },
};
vm.runInNewContext(extractFunction("paintTrainingNavProgress"), progressContext);
progressContext.paintTrainingNavProgress(3);
assert.deepStrictEqual(
  buttons.map((button) => button.className),
  ["nav-ex-done", "nav-ex-current", "nav-ex-pending"]
);

console.log("training navigation regression tests passed");
