export const assets = {
  sizes: {}, records: new Map(), listener: null,
  configure(sizes, listener) {
    this.sizes = sizes;
    this.listener = listener;
    for (const [path, bytes] of Object.entries(sizes)) this.records.set(path, { bytes, received: 0, status: 'pending' });
  },
  notify() {
    let received = 0, total = 0;
    for (const record of this.records.values()) {
      if (record.status === 'unused') continue;
      total += record.bytes;
      received += Math.min(record.received, record.bytes);
    }
    this.listener?.(total ? received / total : 0, { received, total });
  },
  skip(path) {
    const record = this.records.get(path);
    if (record?.status === 'pending') { record.status = 'unused'; this.notify(); }
  },
};

async function trackedBody(path) {
  const response = await fetch(path);
  if (!response.ok) throw Error('Could not load ' + path + ' (' + response.status + ')');
  let record = assets.records.get(path);
  if (!record) {
    record = { bytes: Number(response.headers.get('Content-Length')) || assets.sizes[path] || 0, received: 0, status: 'pending' };
    assets.records.set(path, record);
  }
  record.status = 'loading'; record.received = 0;
  return response.body.pipeThrough(new TransformStream({
    transform(chunk, target) {
      record.received += chunk.byteLength;
      if (!record.bytes) record.bytes = record.received;
      assets.notify(); target.enqueue(chunk);
    },
    flush(){record.bytes=record.received;record.status='complete';assets.notify();},
  }));
}

export async function readAsset(path, type = 'binary') {
  let body;
  if(type!=='json'&&path.endsWith('.parts.json')){
    const descriptor=await readAsset(path,'json');
    if(descriptor.compression!=='gzip'||!Array.isArray(descriptor.parts)||!descriptor.parts.length||descriptor.parts.length>64)throw Error('Invalid asset package '+path);
    let reader=null,index=0;
    body=new ReadableStream({async pull(target){
      for(;;){
        if(!reader){if(index===descriptor.parts.length){target.close();return;}reader=(await trackedBody(descriptor.parts[index++].url)).getReader();}
        const chunk=await reader.read();
        if(chunk.done){reader.releaseLock();reader=null;continue;}
        target.enqueue(chunk.value);return;
      }
    },cancel(reason){return reader?.cancel(reason);}}).pipeThrough(new DecompressionStream('gzip'));
  }else body=await trackedBody(path);
  if (path.endsWith('.gz')) body = body.pipeThrough(new DecompressionStream('gzip'));
  const extension=path.split('.').at(-1),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',avif:'image/avif',webp:'image/webp'}[extension];
  const streamed = new Response(body,mime?{headers:{'Content-Type':mime}}:undefined);
  const result = type === 'json' ? await streamed.json() : type === 'blob' ? await streamed.blob() : await streamed.arrayBuffer();
  return result;
}
