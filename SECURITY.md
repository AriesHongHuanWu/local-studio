# Security Policy · 安全政策

## Reporting a vulnerability · 回報漏洞

If you discover a security issue in Ai Caption, please report it **privately** first — do not open a public issue for an exploitable vulnerability.

如果你發現 Ai Caption 的安全問題,請先**私下**回報 —— 不要為可被利用的漏洞開公開 issue。

- Preferred: GitHub **Security Advisories** → <https://github.com/AriesHongHuanWu/local-studio/security/advisories/new>
- Or open a minimal issue asking the maintainer to make contact, without exploit details.

Please include: affected version, OS, reproduction steps, and impact. We aim to acknowledge within a few days.

## Scope · 範圍

Ai Caption is **local-first**: it has no backend servers and collects no data, so the attack surface is mostly local. Things worth reporting:
- The local FastAPI service (`127.0.0.1:8756`) being reachable beyond localhost, or accepting unsafe input.
- The Tauri desktop shell spawning/handling the Python sidecar unsafely.
- Path-traversal / arbitrary-write in file export or model download/extraction.
- Any code path that sends user video/audio/subtitles/lyrics off-device (this should never happen — report it if it does).

## Supported versions · 支援版本

The latest release on `main` is supported. Ai Caption is pre-1.0 — fixes land in the next release.

## Dependencies · 相依套件

Ai Caption builds on third-party open-source projects (PyTorch, faster-whisper, Demucs, torchaudio, Tauri, React). Vulnerabilities in those are best reported upstream; we will bump pinned versions when fixes are available.
