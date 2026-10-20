// The page-side script that reads the CLAIMS of every signed-in token.
//
// The persona chip is rendered by the client from whatever it has lying around;
// authorization happens on the token. It searches by SHAPE, in BOTH storages,
// because the key name is not stable between auth libraries: one keeps a bare
// JWT in localStorage, the next wraps it as `{secret: "<jwt>"}` in
// sessionStorage. Anything that decodes to a payload naming a subject is one.
//
// It returns them ALL, and CHOOSING is identity/select.mjs's job against what
// the project declared. It used to choose here, by "most roles wins", which is
// a guess about whose authority a permission case is observing.
//
// Only claims come back, never the token: a token is a live credential and
// belongs in no log, artifact or commit. `aud`, `iss` and `exp` are claims too,
// and they are what makes choosing possible without guessing.
//
// Which claim carries the roles is the provider's word, so the project's names
// are injected as DATA rather than assumed here.
export const claimsScript = (declared = {}) => `(()=>{
  const R=${JSON.stringify(declared.rolesClaim ?? "roles")},U=${JSON.stringify(declared.upnClaim ?? "upn")};
  const dec=t=>{try{const s=String(t).split('.');if(s.length!==3)return null;
    return JSON.parse(atob(s[1].replace(/-/g,'+').replace(/_/g,'/')))}catch(e){return null}};
  const jwt=v=>{const d=dec(v);if(d)return d;
    try{const o=JSON.parse(v);return o&&typeof o.secret==='string'?dec(o.secret):null}catch(e){return null}};
  const all=[];
  for(const st of [sessionStorage,localStorage])
    for(const k of Object.keys(st)){const p=jwt(st[k]); if(p&&(p.sub||p.oid))all.push(p);}
  return JSON.stringify(all.map(p=>({
    upn:p[U]||p.upn||p.preferred_username||p.email||p.unique_name||null,
    tid:p.tid||null,oid:p.oid||p.sub||null,roles:p[R]||[],name:p.name||null,
    aud:Array.isArray(p.aud)?p.aud:(p.aud?[p.aud]:[]),iss:p.iss||null,exp:p.exp||null})))})()`;
