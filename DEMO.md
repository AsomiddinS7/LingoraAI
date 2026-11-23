# Two-minute Lingora demo

Use the real limited-vocabulary matcher. Mock recognition is not a model demonstration.

1. Open Conversation over HTTPS or localhost in Chrome/Edge. Choose **Oʻzbekcha**, check the supported-sign list, and allow camera/microphone access. Keep hands and shoulders visible.
2. Press **Sign now**, wait for the countdown, perform a supported sign, then press **Done signing**. Review and confirm a reliable match. Ambiguous movements should be rejected.
3. Open **Signed speech** for the six presentation references. Sign one full phrase and press **Finish and recognize**. Each phrase needs a separate turn.
4. Press the conversation microphone, speak a short Uzbek reply, and press it again. Wait for returned text. Use **Edit text** to correct words if needed.
5. Show typed replies and the phrasebook as fallbacks. Check the computer's Uzbek TTS voice before promising audio playback.

Public Pages uses browser speech and needs internet. Local NVIDIA speech requires its separate Python service. Setup and measurements: [MVP.md](MVP.md) and [SPEECH_SETUP.md](SPEECH_SETUP.md).

Describe this as an experimental reference-matching prototype. Similarity is not translation accuracy. Unrestricted Uzbek signing and new-signer accuracy have not been validated.
