/** Server-only adapter for the separate AI Studio Express application. */
export class VoiceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function request(path: string, body: BodyInit, json = false): Promise<Record<string, unknown>> {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) throw new VoiceError(503, 'Sarvam is not configured. Text chat is available.');
  let response: Response;
  try {
    response = await fetch(`https://api.sarvam.ai/${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: {'api-subscription-key': key, ...(json ? {'Content-Type': 'application/json'} : {})}, body,
    });
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new VoiceError(timeout ? 504 : 502, timeout ? 'Voice provider timed out.' : 'Voice provider unavailable.');
  }
  if (!response.ok) throw new VoiceError(502, 'Voice provider rejected the request. Check configuration and quota.');
  // Bound the response while streaming; never surface raw upstream error bodies.
  const reader = response.body?.getReader();
  if (!reader) throw new VoiceError(502, 'Voice provider returned no response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 15 * 1024 * 1024) { await reader.cancel(); throw new Error('oversize'); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid');
    return result;
  } catch { throw new VoiceError(502, 'Voice provider returned an unusable response.'); }
}

export async function transcribe(audio: Uint8Array, contentType: string) {
  const extensions: Record<string,string> = {'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'};
  const mime = contentType.split(';')[0].trim();
  if (!extensions[mime] || !audio.byteLength || audio.byteLength > 5 * 1024 * 1024)
    throw new VoiceError(400, 'Use a supported audio clip under 5 MB and 30 seconds.');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], {type:mime}), `voice.${extensions[mime]}`);
  form.append('model','saaras:v3'); form.append('mode','transcribe'); form.append('language_code','ta-IN');
  const result = await request('speech-to-text', form);
  if (typeof result.transcript !== 'string' || !result.transcript.trim() || result.transcript.length > 4000)
    throw new VoiceError(502, 'Voice provider returned an unusable transcript.');
  return {transcript:result.transcript, requires_confirmation:true};
}

export async function speak(text: string, language: 'ta-IN' | 'en-IN' = 'ta-IN') {
  if (typeof text !== 'string' || !text.trim() || text.length > 2500 || !['ta-IN','en-IN'].includes(language))
    throw new VoiceError(400, 'Use Tamil or English text of 1–2500 characters.');
  const result = await request('text-to-speech', JSON.stringify({text,language_code:language,
    model:'bulbul:v3',speaker:'kavitha',output_audio_codec:'wav'}), true);
  const audios = result.audios;
  if (!Array.isArray(audios) || audios.length !== 1 || typeof audios[0] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(audios[0]))
    throw new VoiceError(502, 'Voice provider returned unusable audio.');
  const audio = Buffer.from(audios[0], 'base64');
  if (audio.toString('ascii',0,4) !== 'RIFF' || audio.toString('ascii',8,12) !== 'WAVE')
    throw new VoiceError(502, 'Voice provider returned unusable WAV audio.');
  return {audio_base64:audios[0], mime_type:'audio/wav'};
}
