// Regression tests for Gemini 3.8 Flash. No API calls or credentials.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
let scripts = 0;
for (const match of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) { new vm.Script(match[1]); scripts++; }
}
assert.ok(scripts > 0);
function extract(from, to, offset=0) {
  const a = src.indexOf(from, offset), b = src.indexOf(to, a+from.length);
  assert.ok(a>=0&&b>a, "not found: "+from);
  return src.slice(a,b);
}
const messages = new Function(
 "apiMessages","selectedApiProvider","modelNameToUse","contextEnableDummyUser",
 "contextDummyUser","contextEnableDummyModel","contextDummyModel",
 "contextTemperature","contextMaxTokens","contextTopP",
 "contextPresencePenalty","contextFrequencyPenalty","contextGeminiTopK",
 "contextGeminiThinkingBudget","contextGeminiThinkingLevel38",
 "contextGeminiIncludeThoughts",
 extract("const dummyUserTextToUse =", "let systemInstructionForProvider =") +
 "\nreturn {apiMessages,commonGenerationConfig};"
);
function m(model,level,thoughts=false){
 return messages([{role:"user",parts:[{text:"Test"}]}],"gemini",model,
 true,"dummy user",true,"dummy model",0.7,1024,0.9,0,0,40,777,level,thoughts);
}
const req = new Function(
 "model","generationConfig","messagesForApi","systemInstruction",
 "state",extract("const finalGenerationConfig = { ...generationConfig };",
 "const tools = [];",src.indexOf("async callGeminiApi("))+
 "\nreturn requestBody;"
);
const state={settings:{geminiThinkingBudget:777,geminiIncludeThoughts:true}};
function request(model,x) {
 return req(model,x.commonGenerationConfig,x.apiMessages,{parts:[{text:"System"}]},state);
}
for(const level of ["low","medium","high"]){
 const input=m("gemini-3.8-flash",level,true);
 assert.deepEqual(input.apiMessages.map(x=>x.role),["user","user"]);
 const body=request("gemini-3.8-flash",input);
 assert.deepEqual(body.generationConfig.thinkingConfig,
  {thinkingLevel:level.toUpperCase(),includeThoughts:true});
 for(const key of ["temperature","topP","topK","presencePenalty",
  "frequencyPenalty","candidateCount"]) {
  assert.ok(!(key in body.generationConfig),key);
 }
 assert.equal(body.safetySettings.length,4);
}
const standard=request("gemini-3.8-flash",m("gemini-3.8-flash",""));
assert.ok(!standard.generationConfig?.thinkingConfig?.thinkingBudget);
assert.ok(!standard.generationConfig?.thinkingConfig?.thinkingLevel);
const legacy=m("gemini-2.5-pro","low");
assert.deepEqual(legacy.apiMessages.map(x=>x.role),["user","user","model"]);
assert.equal(request("gemini-2.5-pro",legacy).generationConfig.thinkingConfig.thinkingBudget,777);
assert.equal((src.match(/id="gemini-thinking-level-38"/g)||[]).length,1);
assert.match(src,/contextConcatDummyModel && dummyModelTextToUse && !isGemini38FlashRequest/);
console.log("PASS Gemini 3.8, 2.5 legacy and inline JavaScript");
