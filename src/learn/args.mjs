// argv, read the way the rest of the CLIs read it.
export const flag = (args, name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export const has = (args, name) => args.includes(`--${name}`);

export const words = (args) => args.filter((a) => !a.startsWith("--"));
