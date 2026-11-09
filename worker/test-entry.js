// Deploy only to an isolated, temporary workers.dev script with a throwaway D1 DB.
// Production never imports this module.
import {handleApi,json} from './api.js';
export default {
  fetch(request,env) {
    const email=request.headers.get('X-Test-Email')?.trim().toLowerCase();
    return email?handleApi(request,env,email):json({error:'X-Test-Email required'},401);
  }
};
