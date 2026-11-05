// What a prompt is ABOUT, as data: a few broad intents, and the requirements
// each one implies. No model is asked -- this runs on every prompt, before the
// host has answered anything, so it is a table and a Set lookup.
//
// Broad on purpose. An intent is the question "which kind of help is this",
// and there are sixteen; which RESOURCE helps is decided downstream by what each
// resource says it provides (src/routing/select.mjs), never here. So a cue is a
// generic English word, and never a product, a vendor or a
// resource's name: those arrive as a resource's own `signals`, from the
// catalogs the plugin ships.
//
// A cue is at most three terms (src/routing/terms.mjs GRAM_LIMIT). The intent
// with the most cues in the prompt wins, the first row winning a tie; two cues
// or more is `high` confidence, one is `low`. None is `general`, which requires
// nothing -- and a prompt that requires nothing is routed nowhere.
//
// `autonomous-engineering` sits right before `investigation`: "fix the refund rule autonomously
// with autonomous engineering" carries the investigation cue "autonomous" inside its own words, and a
// change driven to verified is not an investigation -- while "autonomous qa on the orders screen"
// has no engineering cue at all and stays one. "autonomously" alone is one cue, so a prompt with more
// words of another intent ("explore the screen autonomously and find bugs") stays that intent.
//
// `investigation` sits right before `qa`: "find out why Save sends two
// requests" or "can tenant B read tenant A's data" is a question for an
// investigation, and on a tie with a test word it stays one -- while "write a
// test case" or "run the regression" has no investigation word at all, so an
// ordinary QA question never pays for an autonomous exploration.
//
// `requirements` sits after `qa` and `investigation` and BEFORE `development`: "implement PBI
// 4312" has one development word and one requirement word, and on that tie a work item is settled
// before it is built -- while "write a test plan for PBI 4312" has two QA words and stays a QA
// question. Its cues are the generic words for a work item. A bare "issue" is not one: "there is
// an issue with the handler" is about code, and "issue number" or "issue id" is about an item.
//
// `environment` sits after `qa`, `investigation` and `reporting` and BEFORE `database`,
// `browser`, `mcp-tooling`, `development` and `documentation`: "how do I run the app" has one
// documentation word and one environment phrase, and on that tie running it is the question --
// while "run the project tests" has a test word of its own and stays a QA question, and
// "implement the handler and run the app" keeps its change because `development` has more words.
// Its cues are the generic phrases for running a project and for the place it runs in. Not one
// names a language, a package manager or a vendor: which tool a project needs is what its own
// files say, discovered, never a cue here.
//
// `development` sits after `qa`, so "fix the failing test" stays a test
// question, and before `documentation`, so "how do I implement ..." is a change
// to make rather than a page to read. "fix" and "bugs" are its words too (1.8.6): "fix the two refund
// bugs so their tests pass" asks for a change to the code, and the tests it must pass do not make it a QA
// question -- while in "find bugs" or "identify bugs" the word is part of an investigation's own phrase, and a cue
// inside another intent's longer cue counts for that intent alone (src/routing/classify.mjs, 1.8.7). `reporting` sits right after `qa`, so a
// "test report" stays a test question on the tie, while "the PO report on PR
// review time" has more of its own words than code review has.
//
// `security` (0.5.0) sits after `development` and before `documentation`: "add authorization to the endpoint" is a
// change on the tie, and "is our API protected against OWASP" a security question. Its cues are the words of an
// assessment and of a control, never a standard's catalog: which catalog is in effect is a person's, in Orbit Control.
// It is also one of the verification owners a change can span (src/routing/strategy.mjs, `several-owners`).
//
// REFINEMENTS within `*` reach what no broad intent asks for (0.5.0): a system graph, a playbook's improvement, a
// specification's acceptance criteria and a mission. Each requirement is one a resource's own signals still gate, so
// the refinement asks and the resource's own words decide -- "our mission statement" asks for no mission.

export const GENERAL = "general";

export const INTENTS = [
  { id: "code-review", cues: ["review", "reviews", "pr", "pull request", "merge request", "diff", "code review", "review code", "rà soát code", "rà soát mã", "xem lại code", "đánh giá code"], requires: ["code.review", "repository.read"] },
  { id: "architecture", cues: ["architecture", "architectural", "boundary", "boundaries", "layering", "dependency direction", "module structure", "made of", "belong", "belongs", "already exists", "already exist", "already handle", "already handles", "reverse engineer", "reverse engineering", "system graph", "topology", "talks to what", "kiến trúc", "ranh giới", "phân tầng", "đặt ở đâu", "thuộc về đâu", "cấu trúc module"], requires: ["architecture.context", "technology.context"] },
  { id: "engineering", cues: ["convention", "conventions", "coding style", "code style", "best practice", "best practices", "how we build", "quy ước", "quy chuẩn", "phong cách code", "cách viết code"], requires: ["engineering.context"] },
  { id: "autonomous-engineering", cues: ["autonomous engineering", "autonomously", "until verified", "implement autonomously", "fix autonomously", "on your own", "verified commit", "tự làm", "tự động làm", "tự xử lý"], requires: ["engineering.execution"] },
  { id: "investigation", cues: ["investigate", "investigation", "find bugs", "find bug", "find a bug", "identify bugs", "hunt for bugs", "look for bugs", "bug hunt", "autonomous", "autonomous qa", "explore", "tenant", "tenants", "cross tenant", "tenant isolation", "duplicate request", "duplicate requests", "two requests", "two api requests", "requests twice", "ui to database", "database record", "điều tra", "tìm lỗi", "tìm bug", "săn lỗi", "khám phá"], requires: ["qa.investigation"] },
  { id: "qa", cues: ["test", "tests", "testing", "regression", "test case", "test cases", "test plan", "qa", "qc", "e2e", "end to end", "smoke test", "smoke tests", "ui map", "kiểm thử", "hồi quy", "ca kiểm thử", "kịch bản test", "viết test", "chạy test"], requires: ["qa.execution"] },
  { id: "reporting", cues: ["report", "reports", "reporting", "po", "po report", "product owner", "project report", "status report", "sprint report", "weekly report", "monthly report", "burndown", "velocity", "throughput", "cycle time", "lead time", "aging", "forecast", "báo cáo", "báo cáo sprint", "dự báo"], requires: ["project.reporting"] },
  { id: "environment", cues: ["dev container", "devcontainer", "dev environment", "development environment", "local environment", "runtime environment", "run locally", "start locally", "run the app", "start the app", "run this app", "start this app", "run the application", "start the application", "run the project", "start the project", "run this project", "start this project", "port conflict", "port in use", "get it running", "get this running", "running locally", "run it locally", "on my machine", "on this machine", "needs to run", "need to run", "how to run", "run here", "operating systems", "will not start", "won't start", "doesn't start", "fails to start", "already in use", "chạy ứng dụng", "chạy app", "chạy dự án", "chạy local", "môi trường dev", "xung đột cổng", "trên máy này", "chạy trên máy", "máy này chạy", "không start được", "không chạy được"], requires: ["runtime.discovery"] },
  { id: "database", cues: ["sql", "database", "db", "query", "queries", "row", "rows", "stored procedure", "csdl", "truy vấn", "bản ghi", "câu truy vấn"], requires: ["database.query"] },
  { id: "browser", cues: ["browser", "screenshot", "web page", "headless", "trình duyệt", "chụp màn hình"], requires: ["browser.automation", "browser.session"] },
  { id: "release", cues: ["release", "ship", "publish", "version bump", "bump the version", "changelog", "phát hành", "xuất bản", "tăng phiên bản"], requires: ["release.gate"] },
  { id: "mcp-tooling", cues: ["mcp", "mcp server", "mcp servers", "cli tool", "install tool", "runtime", "control panel", "Orbit Control", "cài công cụ", "bảng điều khiển"], requires: ["mcp.management", "tool.management", "control.panel"] },
  { id: "requirements", cues: ["requirement", "requirements", "pbi", "work item", "user story", "backlog item", "ticket", "issue number", "issue id", "acceptance criteria", "acceptance criterion", "as a user", "đặc tả", "nghiệm thu"], requires: ["requirement.snapshot"] },
  { id: "development", cues: ["implement", "implementation", "implementing", "feature", "new feature", "refactor", "refactoring", "rename", "method", "function", "class", "endpoint", "handler", "backend", "frontend", "bug", "bugs", "bug fix", "bugfix", "fix", "fixes", "fixing", "write code", "code change", "develop", "webhook", "add support", "add a rule", "add the rule", "add that rule", "add a field", "add validation", "rework", "sửa", "sửa lỗi", "sửa bug", "thêm tính năng", "tính năng", "đổi tên", "tái cấu trúc", "viết code", "triển khai", "thêm quy tắc", "cập nhật code"], requires: ["development.implementation"] },
  { id: "security", cues: ["security", "security audit", "security assessment", "security controls", "access control", "authorization", "owasp", "asvs", "bảo mật", "phân quyền", "quyền truy cập", "lỗ hổng"], requires: ["security.assessment"] },
  { id: "documentation", cues: ["how does", "how do", "how to", "what does", "what is", "what are", "difference between", "documentation", "docs", "explain", "api reference", "giải thích", "làm sao", "như thế nào", "là gì", "tài liệu", "khác nhau"], requires: ["documentation.search", "technology.context"] },
];

// Narrower requirements a cue adds, but only inside the intents it names
// (`*`: any intent, `general` included). "plan" means a test plan inside a QA
// prompt; inside a release prompt it means nothing this table knows.
export const REFINEMENTS = [
  { within: ["qa"], cues: ["plan", "test plan", "scenario", "scenarios", "coverage", "acceptance criteria", "what to test", "should test", "should we test", "kế hoạch", "kịch bản", "độ bao phủ"], requires: ["qa.planning"] },
  { within: ["qa"], cues: ["failed", "failing", "failure", "flaky", "why did", "fail", "fails", "bị fail", "thất bại", "vì sao", "tại sao"], requires: ["failure.classification"] },
  { within: ["qa"], cues: ["write", "author", "new case", "add a case", "viết", "thêm case"], requires: ["qa.authoring"] },
  { within: ["qa", "browser"], cues: ["map", "locator", "selector", "drift", "drifted"], requires: ["ui.mapping", "ui.map-repair"] },
  { within: ["qa", "browser", "investigation"], cues: ["explore", "exploratory", "khám phá"], requires: ["ui.exploration"] },
  { within: ["qa"], cues: ["lesson", "lessons", "learned", "bài học", "rút ra"], requires: ["qa.lessons"] },
  { within: ["qa"], cues: ["invalid", "invalid case", "query check", "dsl", "không hợp lệ"], requires: ["qa.case-repair"] },
  { within: ["engineering"], cues: ["taught", "teach", "this session", "phiên này"], requires: ["engineering.observation"] },
  { within: ["development", "qa", "investigation"], cues: ["pbi", "work item", "user story", "backlog item", "ticket", "issue number", "issue id"], requires: ["requirement.snapshot"] },
  { within: ["development"], cues: ["docs", "documentation", "api reference", "sample", "samples", "tài liệu"], requires: ["documentation.search"] },
  { within: ["development", "requirements"], cues: ["autonomously", "autonomous engineering", "until verified", "on your own", "tự làm"], requires: ["engineering.execution"] },
  { within: ["*"], cues: ["where to start", "where do i", "what next", "should i start", "đầu từ đâu"], requires: ["workflow.navigation"] },
  { within: ["*"], cues: ["reverse engineer", "reverse engineering", "talks to what", "system graph", "topology"], requires: ["architecture.reverse"] },
  { within: ["*"], cues: ["playbook", "playbooks", "self-improvement", "improvement campaign"], requires: ["improvement.campaign"] },
  { within: ["*"], cues: ["acceptance criteria", "acceptance criterion", "nghiệm thu"], requires: ["goal.orchestration"] },
  { within: ["*"], cues: ["multi-agent", "multi agent", "orbit satellite", "satellite mission", "use satellite", "with satellite", "as a mission", "run a mission", "start a mission", "nhiều agent"], requires: ["mission.orchestration"] },
];

// What a prompt MARKS about Orbit itself (0.5.0, B22, B5), as data the strategy table reads (src/routing/strategy.mjs):
// a person opting out of Orbit, asking to continue the work they have, halting it, or asking how something stands. A
// mark is not an intent and asks for nothing. `at` is how far into the prompt its cue counts: `opening`, the first
// words a person typed (src/routing/terms.mjs OPENING_LIMIT) -- "continue" that opens a prompt asks to go on, while one
// in the middle of a request is part of the request -- or the whole `head`.
export const MARKS = [
  { id: "opt-out", at: "head", cues: ["without orbit", "without using orbit", "no orbit", "skip orbit", "not use orbit", "t use orbit", "không dùng orbit", "không cần orbit", "đừng dùng orbit", "khỏi dùng orbit", "khong dung orbit"] },
  { id: "continue", at: "opening", cues: ["continue", "resume", "carry on", "keep going", "pick up where", "go on with", "tiếp tục", "làm tiếp", "tiếp đi", "chạy tiếp", "tiep tuc"] },
  { id: "halt", at: "opening", cues: ["stop", "wait", "pause", "hold on", "halt", "dừng", "dừng lại", "tạm dừng", "chờ đã", "đợi đã", "khoan"] },
  { id: "status", at: "head", cues: ["how far", "any progress", "done yet", "finished yet", "ready yet", "it going", "where are we", "s the status", "is the status", "tới đâu rồi", "đến đâu rồi", "xong chưa", "thế nào rồi", "sao rồi"] },
];
