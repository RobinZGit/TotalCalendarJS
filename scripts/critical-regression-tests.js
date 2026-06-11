#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const indexPath = path.join(__dirname, "..", "index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "\"" || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  throw new Error("No matching brace found");
}

function extractFunction(name) {
  const match = new RegExp("function\\s+" + name + "\\s*\\(").exec(indexHtml);
  if (!match) throw new Error("Function not found: " + name);
  const openIndex = indexHtml.indexOf("{", match.index);
  const closeIndex = findMatchingBrace(indexHtml, openIndex);
  return indexHtml.slice(match.index, closeIndex + 1);
}

function runSnippet(functionNames, snippet) {
  const sandbox = { assert, console };
  const source = functionNames.map(extractFunction).join("\n") + "\n" + snippet;
  vm.runInNewContext(source, sandbox, { filename: "critical-regression-tests.vm.js" });
}

runSnippet(
  ["normalizeTrainingSyncName", "trainingNamesMatch", "getTrainIndexByName"],
  `
  var Gl_aMetaRithm = [
    [[], ["<FIRST>=<body>"]],
    [[], ["<SECOND> = <body>"]],
    [[], ["THIRD> = <body>"]]
  ];

  assert.strictEqual(getTrainIndexByName("<FIRST>"), 0);
  assert.strictEqual(getTrainIndexByName("FIRST"), 0);
  assert.strictEqual(getTrainIndexByName("<SECOND>"), 1);
  assert.strictEqual(getTrainIndexByName("SECOND"), 1);
  assert.strictEqual(getTrainIndexByName("THIRD"), 2);
  `
);

runSnippet(
  ["pickTrainListItem"],
  `
  var calls = [];
  var selectAllTrain = {
    selectedIndex: -1,
    options: [{ value: "1" }, { value: "7" }]
  };
  function syncTrainPickListSelection(){}
  function updateTrainPickTriggerFromSelection(){}
  function closeTrainPickDropdown(){}
  function onSelectTrain(){ calls.push(Array.prototype.slice.call(arguments)); }

  pickTrainListItem(7);

  assert.strictEqual(selectAllTrain.selectedIndex, 1);
  assert.deepStrictEqual(calls, [[7]]);
  `
);

runSnippet(
  ["fetchTrainingsRithmFromRemoteIndex"],
  `
  var Gl_aMetaRithm = [];
  function fetchRemoteIndexHtml(done){
    done("<html></html>", null);
  }
  function snapshotRithmFromIndexHtml(){
    return [[[], ["<REMOTE>=<body>"], [["calendar"]]]];
  }

  var callbackValue = null;
  fetchTrainingsRithmFromRemoteIndex(function(fromLocal){
    callbackValue = fromLocal;
  });

  assert.strictEqual(callbackValue, false);
  assert.strictEqual(Gl_aMetaRithm[0][1][0], "<REMOTE>=<body>");
  `
);

console.log("critical regression tests passed");
