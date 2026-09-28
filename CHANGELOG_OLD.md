# Older changes
## 0.1.2 (2026-07-06)
* (Alan Paris) Create channel objects for info/volume/video/audio/commands so every state has an intermediate parent object (fixes repochecker E3009)

## 0.1.1 (2026-07-05)
* (Alan Paris) Enabled automated npm publishing via GitHub Actions trusted publishing (OIDC)

## 0.1.0 (2026-07-05)
* (Alan Paris) Initial release: TCP/IP and serial (RS232) control of iiyama ProLite displays
* (Alan Paris) Power, input source, volume, video and audio control with status polling
* (Alan Paris) Wake-on-LAN support for Power Save Modes 3 and 4, with subnet-broadcast derivation
* (Alan Paris) Automatic reconnection with slow standby polling to recover when a display is powered on
