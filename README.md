# Parrot Disco without SC2 only on LTE

I just want to have fun with Parrot Disco and I need something new :) This project is open source.

# Parrot Hardware & Software details

## C.H.U.C.K

-   Connecting to ZeroTier network on startup
-   Don't need to initialize WiFi to 4G reconnect, it's ready out of the box
-   Don't need to modify software (but we will probably need to do this if we want to start flight plan instead of auto landing on connection lost - we want to land precisely using flight plan with linear landing, I don't know if it possible)
-   `ARStream2` is streaming FROM disco to SC2. You need to initialize the stream. Default video ports `55004` and `55005` are CLOSED on Disco! You can't connect to them.
-   Discover port `44444` used to sending controller name, id and stream ports
-   Control UDP? port `54321` (used to receive control actions from SC2)

## SkyController 2

-   Control UDP? port `43210` or `9988` (used to receive events from disco)
-   Triggering video stream on `:7711/video`
-   ADB available on port `9050`

## FreeFlight Pro Android App

-   We can modify it using `APK Easy Tool` and edit some code in `Snail`

# TODO

# WWW as SC2 details

-   Client must be in ZeroZier network (probably)
-   Video feed directly from Disco (if is will be possible), without proxy server
-   Control without proxy server (if is will be possible) directly to Disco using `TCP/UDP` raw sockets in JavaScript API
-   Live map with Disco and all flight parameters
-   If directly connections won't be possible, then use webrtc `P2P` connection for control and video

# Roadmap

1. Gather all possible information in this repository to know if it will be possible at all.
2. Learn how to receive all parameters (battery, altitude, etc.)
3. Create website that will display all the needed informations and could control the API
4. If possible (due to weather) make test flight with starting flight plan from www and tilt the camera
5. Trigger video stream and try to watch it from VLC
6. Connect video feed on the website
7. If possible (due to weather) make test flight with starting flight plan from www and test video stream & camera control latency
8. Add the rest of the functionality under control (mainly stick control, the throttle is unnecessary at this stage)
9. TBA...
