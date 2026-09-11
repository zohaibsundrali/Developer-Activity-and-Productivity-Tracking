const endpoint='/api/organizations/delete';
export async function readDeletionStatus({ authenticatedFetch, publicFetch, receipt }) {
  let response;
  try { response=await authenticatedFetch(endpoint); } catch(error) { if(!receipt&&error?.status===403)return null; if(!receipt)throw error; }
  if(receipt&&(!response||response.status===401||response.status===403)) {
    response=await publicFetch(`${endpoint}?receipt=${encodeURIComponent(receipt)}`,{cache:'no-store'});
  }
  const data=await response.json().catch(()=>({}));
  if(response.status===403&&!receipt)return null;
  if(!response.ok)throw Object.assign(new Error(data.error||'Could not load deletion status.'),{status:response.status});
  return data;
}
export function createDeletionRequestGuard(getScope) {
  let version=0;
  return {
    begin(){return {version:++version,scope:getScope()};},
    current(ticket){return ticket.version===version&&ticket.scope===getScope();},
    invalidate(){version++;},
  };
}
