// Two waits after a launch, and the second is the one people miss.
//
// (1) The SPA may bounce through the sign-in host to refresh a token; a single
//     read right after launch catches that bounce and calls it a sign-out.
// (2) Then wait for the shell to PAINT: an admin app builds its routes from a
//     menu payload, so a deep link issued before that lands falls back to the
//     home route and the case fails on its very first goto.
export function awaitShell(browser, host, say = console.log) {
  const s = backOnHost(browser, host);
  if (s !== host) return s;
  reportPaint(browser.settle("document.body.innerText.length>0", 40), host, say);
  return host;
}

function reportPaint(painted, host, say) {
  say(`session : ${host} — signed in${painted ? `, shell painted after ${painted} poll(s)` : ""}`);
  if (!painted) console.error("! the shell never painted — a deep link may fall back to the home route");
}

function backOnHost(browser, host) {
  let s = "NONE";
  for (let i = 0; i < 60 && s !== host; i++) s = browser.settled();
  return s;
}
