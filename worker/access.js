// Access JWT verification is deliberately independent of the API and its database.
const certificates = new Map();
const decode = value => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid JWT encoding');
  const raw = atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
export async function verifyAccessJwt(token, {teamDomain, aud, fetchImpl = fetch, now = Date.now()}) {
  if (!teamDomain || !aud || typeof token !== 'string') throw new Error('Missing Access configuration or token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const json = part => JSON.parse(new TextDecoder().decode(decode(part)));
  const header = json(parts[0]), claims = json(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid signing algorithm');
  const seconds = Number(now)/1000;
  if (claims.iss !== teamDomain) throw new Error('Invalid issuer');
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(aud)) throw new Error('Invalid audience');
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp < seconds-60) throw new Error('Token expired');
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > seconds+60)) throw new Error('Token not active');
  if (typeof claims.email !== 'string' || !claims.email.trim()) throw new Error('Email required');
  async function refresh() {
    const response = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error('Could not load Access certificates');
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new Error('Invalid certificates');
    const entry = {keys:data.keys, expires:Number(now)+3600000};
    certificates.set(teamDomain,entry); return entry;
  }
  let entry = certificates.get(teamDomain);
  if (!entry || entry.expires <= Number(now)) entry = await refresh();
  let jwk = entry.keys.find(key=>key.kid===header.kid);
  if (!jwk) { entry = await refresh(); jwk = entry.keys.find(key=>key.kid===header.kid); }
  if (!jwk || jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) throw new Error('Unknown signing key');
  const algorithm = {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  const key = await crypto.subtle.importKey('jwk',jwk,algorithm,false,['verify']);
  if (!await crypto.subtle.verify(algorithm,key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid signature');
  return claims.email.trim().toLowerCase();
}
