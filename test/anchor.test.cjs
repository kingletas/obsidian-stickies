const { captureAnchor, reanchor } = require("./anchor.build.cjs");
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } };

// 1. Unchanged document: offsets hold.
let doc = "The quick brown fox jumps over the lazy dog.";
let a = captureAnchor(doc, 4, 9); // "quick"
check("stable doc keeps offsets", reanchor(a, doc).start === 4);

// 2. Text inserted above: anchor follows.
let doc2 = "A new opening line.\n" + doc;
let r = reanchor(a, doc2);
check("insertion above shifts anchor", doc2.slice(r.start, r.end) === "quick");

// 3. Text deleted above.
let doc3 = doc.slice(4);
r = reanchor(a, doc3);
check("deletion above shifts anchor", doc3.slice(r.start, r.end) === "quick");

// 4. Anchored text removed entirely -> orphaned, not lost.
r = reanchor(a, "Nothing of the sort remains here.");
check("missing text marks orphaned", r.orphaned === true);
check("orphaned keeps its text", r.text === "quick");

// 5. Ambiguity: the right one of several identical hits, chosen by context.
const amb = "alpha TARGET omega\n".repeat(5);
const third = amb.indexOf("TARGET", amb.indexOf("TARGET", amb.indexOf("TARGET") + 1) + 1);
let ambAnchor = captureAnchor(amb, third, third + 6);
// Rewrite the context around the third occurrence only, then confirm it still lands there.
const edited = amb.slice(0, third - 6) + "BRAVO " + amb.slice(third);
r = reanchor(ambAnchor, edited);
check("ambiguous match uses context", edited.slice(r.start, r.end) === "TARGET" && Math.abs(r.start - third) < 12);

// 6. An orphaned anchor recovers if the text comes back (undo).
let orphan = reanchor(a, "gone");
r = reanchor(orphan, doc);
check("orphan recovers on undo", r.orphaned === false && doc.slice(r.start, r.end) === "quick");

// 7. Context is refreshed so drift keeps tracking.
r = reanchor(a, doc2);
check("context refreshed after move", r.before.endsWith("The "));

// 8. Pathological repetition does not hang.
const many = "x".repeat(50000);
const t0 = Date.now();
reanchor(captureAnchor(many, 10, 11), many);
check("repeated text stays fast", Date.now() - t0 < 500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
