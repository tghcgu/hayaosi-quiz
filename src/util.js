// 部屋とランクマッチで使う小道具

export function send(socket, data) {
  try {
    socket.ws.send(JSON.stringify(data));
  } catch {
    // すでに切れている接続には送れない
  }
}

export function randomInt(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

export function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
