const endpoint = process.argv[2];

if (!endpoint) throw new Error('Pass the agent-browser CDP WebSocket URL.');

const socket = new WebSocket(endpoint);
let nextId = 1;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = nextId;
  nextId += 1;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify(message));
  return result;
}

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

socket.addEventListener('open', async () => {
  try {
    const { targetInfos } = await send('Target.getTargets');
    const target = targetInfos.find(
      entry => entry.type === 'page' && entry.url.startsWith('http://pyxis.localhost:5174/')
    );
    if (!target) throw new Error('The npm-terminal page is not open.');
    const { sessionId } = await send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await send('Network.enable', {}, sessionId);
    await send('Network.clearBrowserCache', {}, sessionId);
    process.stdout.write(JSON.stringify({ cleared: true, url: target.url }));
  } catch (error) {
    process.stderr.write(String(error));
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
