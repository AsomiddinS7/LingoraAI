# Free VM speech hosting

GitHub Pages keeps serving the frontend. Only Uzbek STT and TTS run on the VM;
hand tracking and sign recognition remain in the visitor's browser.

Oracle's current Always Free A1 allowance is **2 OCPUs and 12 GB RAM**, plus
200 GB combined block storage. Select an Always Free eligible Ubuntu image and
stay within the console's allowance. This is a plausible fit for the CPU models
tested locally; ARM/cloud performance has not been benchmarked. Account/card
verification is required, capacity can be unavailable, and idle instances can
be reclaimed. This recipe does not create an account or provision a VM.

- [Oracle limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
- [Account verification and availability](https://www.oracle.com/cloud/free/faq/).

Hugging Face's ordinary new Gradio/Docker compute Spaces require a paid plan.
The free ZeroGPU exception allows up to two Gradio Spaces for verified personal
accounts older than 30 days, with usage quotas. It needs a separate Gradio
adapter; this VM recipe is not a tested ZeroGPU deployment.
[Hugging Face eligibility](https://huggingface.co/docs/hub/spaces-zerogpu).

## Ubuntu setup

Run on the VM as the ordinary login user. These units expect `~/LingoraAI`.
The pinned public models require no API keys. Download helpers retain model
notices; requests and generated speech stay in memory.

```bash
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip git libgomp1
git clone https://github.com/AsomiddinS7/LingoraAI.git "$HOME/LingoraAI"
cd "$HOME/LingoraAI"

python3 -m venv .venv-stt
.venv-stt/bin/python -m pip install -r tools/speech/requirements-candidates.txt
.venv-stt/bin/python tools/speech/download_candidates.py --candidate nvidia-onnx

python3 -m venv .venv-tts
.venv-tts/bin/python -m pip install -r tools/speech/requirements-tts.txt
.venv-tts/bin/python tools/speech/download_tts.py

mkdir -p "$HOME/.config/systemd/user"
cp deploy/speech/lingora-stt.service deploy/speech/lingora-tts.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now lingora-stt lingora-tts
sudo loginctl enable-linger "$USER"
curl --fail http://127.0.0.1:8791/api/health
curl --fail http://127.0.0.1:8792/api/health
```

Both health responses must report `ready: true`. Keep the model ports on
localhost; the existing host/origin checks remain enabled.

## HTTPS

Install Caddy using its [official instructions](https://caddyserver.com/docs/install).
Edit `Caddyfile.example` with a hostname pointing at the VM and copy it to
`/etc/caddy/Caddyfile`. The example uses [sslip.io](https://sslip.io/), a DNS service
that resolves an embedded IP address. Replace `203.0.113.10` with the real public
IP first. Verify actual DNS resolution and certificate issuance on the VM.

Allow inbound TCP 80/443 in cloud and VM firewall rules. Caddy terminates HTTPS
and forwards only speech routes. Its upstream Host rewrite retains loopback host
checks; permitted browser origins include the existing GitHub Pages site. Origin
checks do not authenticate an anonymous public API. Verify load/rate limits
before wider use.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl --fail https://YOUR_SPEECH_HOST/api/health
curl --fail https://YOUR_SPEECH_HOST/api/tts-health
```

Both health routes report actual model state. Test a real WAV transcription and
text-to-WAV synthesis before configuring the website to use the verified HTTPS
URL. Frontend provider settings and public deployment checks then need updating;
the current public app keeps its working browser speech defaults.

These files are deployment preparation, not evidence of a running cloud server.
