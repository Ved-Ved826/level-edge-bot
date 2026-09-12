// Работа с Discord API: проверка Ed25519-подписи и отправка отложенных ответов.

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

export async function verifyDiscordSignature(sig: string, ts: string, body: string, pk: string): Promise<boolean> {
  try {
    const tsData = new TextEncoder().encode(ts);
    const bData = new TextEncoder().encode(body);
    const msgData = new Uint8Array(tsData.length + bData.length);
    msgData.set(tsData);
    msgData.set(bData, tsData.length);
    const pkBytes = hexToBytes(pk);
    const sigBytes = hexToBytes(sig);
    const key = await crypto.subtle.importKey("raw", pkBytes, { name: "Ed25519" } as any, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sigBytes, msgData);
  } catch (err) {
    console.error("[Error] Sig verify failed:", err);
    return false;
  }
}

export async function sendFollowUp(token: string, appId: string, result: { png: Uint8Array; username: string } | { error: string }): Promise<Response> {
  const wurl = "https://discord.com/api/v10/webhooks/" + appId + "/" + token + "/messages/@original";
  const fd = new FormData();
  if ("error" in result) {
    fd.append("payload_json", JSON.stringify({ content: result.error }));
  } else {
    fd.append("payload_json", JSON.stringify({ attachments: [{ id: 0, filename: "rank-" + result.username + ".png" }] }));
    fd.append("files[0]", new Blob([result.png], { type: "image/png" }), "rank-" + result.username + ".png");
  }
  return fetch(wurl, { method: "PATCH", body: fd });
}
