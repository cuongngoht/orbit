// Local-only controls. All case actions read the one visible JSON block.
const actionStatus = document.getElementById("report-action-status");
const say = (message) => { actionStatus.textContent = message; };

async function copyText(button) {
  try {
    await navigator.clipboard.writeText(button.closest(".copyable").querySelector("pre").textContent);
    say("Copied.");
  } catch {
    say("Clipboard unavailable. Select the text and copy it manually.");
  }
}

function downloadCase() {
  const text = document.getElementById("orbit-case").textContent;
  const name = String(JSON.parse(text).id || "case").replace(/[^a-zA-Z0-9_.-]/g, "-");
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  download(url, `${name}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(url, name) {
  const link = document.createElement("a");
  Object.assign(link, { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
}

const modal = document.getElementById("shot-viewer");
let opener;

function showShot(button) {
  opener = button;
  modal.querySelector(".viewer-image").replaceChildren(button.querySelector("img").cloneNode());
  modal.querySelector(".viewer-caption").textContent = button.querySelector("img").alt;
  modal.showModal();
}

function closeShot() {
  modal.querySelector(".viewer-image").replaceChildren();
  opener?.focus();
}

const expandShots = (open) => document.querySelectorAll(".shot-card").forEach((card) => { card.open = open; });
const revealTarget = (link) => { document.getElementById(link.hash.slice(1)).open = true; };

document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b)));
document.querySelector("[data-download-case]")?.addEventListener("click", downloadCase);
document.querySelectorAll("[data-shot]").forEach((b) => b.addEventListener("click", () => showShot(b)));
document.querySelectorAll("[data-expand-shots]").forEach((b) => b.addEventListener("click", () => expandShots(b.dataset.expandShots === "true")));
document.querySelectorAll('a[href^="#shot-"]').forEach((a) => a.addEventListener("click", () => revealTarget(a)));
modal.querySelector("button").addEventListener("click", () => modal.close());
modal.addEventListener("close", closeShot);
