import {verifyAccessJwt} from './access.js';
import {handleApi,json} from './api.js';
export default {
  async fetch(request,env) {
    try {
      const cookie=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('CF_Authorization='));
      const token=request.headers.get('Cf-Access-Jwt-Assertion') || (cookie?decodeURIComponent(cookie.slice('CF_Authorization='.length)):null);
      const email=await verifyAccessJwt(token,{teamDomain:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD});
      const allowed=(env.ALLOWED_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if(env.ALLOWED_EMAILS?.trim()&&!allowed.includes(email))throw new Error('Email not allowed');
      return handleApi(request,env,email,env.GARDEN_OWNER?.trim()||email);
    }catch{return json({error:'Sign in to your garden again.'},401);}
  }
};
