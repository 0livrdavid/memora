const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PREFIX='--memora-transcribe-experimental=';
function fail(code){const error=Error(code);error.code=code;throw error;}
function parseRequest(argv){const flags=argv.filter(a=>typeof a==='string'&&a.startsWith('--memora-transcribe-experimental'));if(!flags.length)return null;if(flags.length!==1||!flags[0].startsWith(PREFIX))fail('INVALID_REQUEST');const id=flags[0].slice(PREFIX.length);if(!UUID.test(id))fail('INVALID_SESSION');return id;}
async function performRequest(store,id){if(!UUID.test(id))fail('INVALID_SESSION');if(store.active||store.job)fail('BUSY');if(store.config.backend!=='experimental')fail('EXPERIMENTAL_NOT_SELECTED');if(!store.sessions.has(id))fail('UNKNOWN_SESSION');return store.transcribe(id);}
module.exports={parseRequest,performRequest,PREFIX};
