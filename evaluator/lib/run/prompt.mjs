// THE PROMPT: the task's issue text as it is, and ONE fixed closing paragraph, the same for every arm and every task --
// so what an agent says about its own work is observable (EVAL_STATUS), and nothing else differs between arms.
export const CLOSING = [
  "---",
  "",
  "Make the change this issue asks for in the repository in your current working directory, by editing the files in its working tree. When you have finished, end your last message with a line that says `EVAL_STATUS: DONE`, or, if you could not complete it, `EVAL_STATUS: BLOCKED <the reason>`.",
].join("\n");

export const promptOf = (issue) => `${String(issue).trim()}\n\n${CLOSING}\n`;
