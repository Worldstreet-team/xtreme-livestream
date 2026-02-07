LiveKit docs › Media › Overview

---

# Media overview

> An overview of realtime media components for LiveKit.

## Overview

LiveKit provides realtime media exchange between participants using tracks. Each participant can [publish](https://docs.livekit.io/transport/media/publish.md) and [subscribe](https://docs.livekit.io/transport/media/subscribe.md) to as many tracks as makes sense for your application.

### Concepts

The following concepts and use cases are intended to help you understand how to model your application.

#### Audio tracks

Audio tracks are typically published from your microphone and played back on the other participants' speakers. You can also produce custom audio tracks, for instance to add background music or other audio effects.

AI agents can consume an audio track to perform speech-to-text, and can publish their own audio track with synthesized speech or other audio effects.

#### Video tracks

Video tracks are usually published from a webcam or other video source, and rendered on the other participants' screens within your application's UI. LiveKit also supports screen sharing, which commonly results in two video tracks from the same participant.

AI agents can subscribe to video tracks to perform vision-based tasks, and can publish their own video tracks with synthetic video or other visual effects.

### Sample use cases

The following examples demonstrate how to model your application for different use cases.

#### AI voice agent

Each room has two participants: an end-user and an AI agent. They can have a natural conversation with the following setup:

- **End-user**: publishes their microphone track and subscribes to the AI agent's audio track
- **AI agent**: subscribes to the user's microphone track and publishes its own audio track with synthesized speech

The UI may be a simple audio visualizer showing that the AI agent is speaking.

#### Video conference

Each room has multiple users. Each user publishes audio and/or video tracks and subscribes to all tracks published by others. In the UI, the room is typically displayed as a grid of video tiles.

#### Livestreaming

Each room has one broadcaster and a significant number of viewers. The broadcaster publishes audio and video tracks. The viewers subscribe to the broadcaster's tracks but do not publish their own. Interaction is typically performed with a chat component.

An AI agent may also join the room to publish live captions.

#### AI camera monitoring

Each room has one camera participant that publishes its video track, and one agent that monitors the camera feed and calls out to an external API to take action based on contents of the video feed (e.g. send an alert).

Alternatively, one room can have multiple cameras and an agent that monitors all of them, or an end-user could also optionally join the room to monitor the feeds alongside the agent.

## Realtime media components

The following components are available to help you build your application.

| Feature | Description | Use cases |
| **Camera & microphone** | Publish realtime audio and video from any device with automatic permission handling and device management. | Video conferencing, voice calls, and applications requiring camera and microphone access. |
| **Screen sharing** | Share your screen as a video track across all platforms, with browser audio support. | Presentations, remote assistance, and collaborative applications. |
| **Subscribing to tracks** | Play and render realtime media tracks with automatic subscription, adaptive streaming, and quality controls. | Video playback, audio rendering, and dynamic quality adjustment based on UI visibility. |
| **Processing raw tracks** | Read, process, and publish raw media tracks and files with frame-level control. | Media processing pipelines, custom effects, and file-based media publishing. |
| **Noise & echo cancellation** | Achieve crystal-clear audio with built-in noise suppression and echo cancellation. | Voice AI applications, video conferencing, and high-quality audio streaming. |
| **Enhanced noise cancellation** | Advanced noise cancellation capabilities for improving audio quality in noisy environments. | Voice applications, call quality improvement, and audio enhancement. |
| **Codecs & more** | Configure video codecs, simulcast, dynacast, and hi-fi audio settings for optimal quality. | High-quality streaming, bandwidth optimization, and advanced video configurations. |
| **Stream export & import** | Export room content to files and streaming platforms or import external streams into LiveKit rooms. | Recording meetings, livestreaming to YouTube/Twitch, and integrating OBS Studio streams. |

## In this section

Learn how to work with realtime media tracks.

- **[Camera & microphone](https://docs.livekit.io/transport/media/publish.md)**: Publish realtime audio and video from any device.

- **[Screen sharing](https://docs.livekit.io/transport/media/screenshare.md)**: Publish your screen with LiveKit.

- **[Subscribing to tracks](https://docs.livekit.io/transport/media/subscribe.md)**: Play and render realtime media tracks in your application.

- **[Processing raw tracks](https://docs.livekit.io/transport/media/raw-tracks.md)**: How to read, process, and publish raw media tracks and files.

- **[Noise & echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation.md)**: Achieve crystal-clear audio for video conferencing and voice AI.

- **[Enhanced noise cancellation](https://docs.livekit.io/transport/media/enhanced-noise-cancellation.md)**: Improve audio quality with advanced noise cancellation capabilities.

- **[Codecs & more](https://docs.livekit.io/transport/media/advanced.md)**: Advanced audio and video topics.

- **[Stream export & import](https://docs.livekit.io/transport/media/ingress-egress.md)**: Export and import streams to and from LiveKit rooms.

---

This document was rendered at 2026-02-07T02:34:40.313Z.
For the latest version of this document, see [https://docs.livekit.io/transport/media.md](https://docs.livekit.io/transport/media.md).

To explore all LiveKit documentation, see [llms.txt](https://docs.livekit.io/llms.txt).