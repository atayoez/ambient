/*
    Video live wallpaper layer for the Ambient Plasma plugin.

    Kept in its own file and loaded through a Loader in main.qml, so a system
    without the QtMultimedia QML module (or its GStreamer/FFmpeg backend) only
    loses video playback: an `import QtMultimedia` in main.qml itself would
    fail the whole plugin and blank every pattern with it.
*/
import QtQuick
import QtMultimedia

Item {
    id: layer

    // file:// URL of the imported clip (main.qml builds it from spec.video).
    property url source
    // Global animation-speed multiplier from the spec → playback rate.
    property real rate: 1.0

    MediaPlayer {
        id: player
        source: layer.source
        loops: MediaPlayer.Infinite
        playbackRate: layer.rate
        videoOutput: output
        // No audioOutput: a wallpaper is always silent.
        onSourceChanged: play()
        Component.onCompleted: play()
    }

    VideoOutput {
        id: output
        anchors.fill: parent
        fillMode: VideoOutput.PreserveAspectCrop
    }
}
