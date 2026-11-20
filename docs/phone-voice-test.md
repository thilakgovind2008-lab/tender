# Tamil voice acceptance test

Physical device result: NOT TESTED. Record the phone model, OS version, browser version and date when running.

1. On Android Chrome or iPhone Safari open https://tenderproject-two.vercel.app/, choose Tamil, open Check my bid, start Sample Mode and open Chat.
2. Tap the microphone, grant microphone access and say “எந்த ஆவணம் தேவை?” Tap again to stop. Expect the same words in the editable composer. Punctuation may vary.
3. Before tapping Send, verify the chat history, findings and uploads are unchanged. Edit the question to “எந்த EMD ஆவணம் தேவை?” and tap Send.
4. Expect a reply grounded in the sample EMD finding explaining the missing declaration or acceptable payment evidence. Verify the finding remains missing.
5. Tap playback. Listen for an intelligible Tamil reply and verify Stop silences it.
6. Repeat playback in a test deployment without Sarvam configured, on a browser with a Tamil synthesis voice. Expect browser speech playback. Record unsupported voice or device separately.
