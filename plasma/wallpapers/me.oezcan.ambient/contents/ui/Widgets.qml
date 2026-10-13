/*
    Live-wallpaper widgets for the Ambient Plasma plugin: clock, weather,
    calendar, countdown and note. Mirrors src/components/widgets/ (the
    desktop-layer webview on Windows / macOS / other Linux draws the same
    thing) from the `clock` and `widgets` blocks the app stamps into the spec
    from the Widgets tab (live.rs build_spec).

    Placement is anchor + free position: a widget's `position` corner (or
    centre) is pinned at (x%, y%) of the screen; `size` is its headline text
    height in % of the shorter screen edge, and everything else in a widget
    is sized relative to that. `widgets.style` "glass" draws each widget on a
    translucent card instead of bare shadowed text.

    Weather comes from Open-Meteo (no key), fetched here with XMLHttpRequest;
    the WMO code table matches src/lib/weather.ts, the icons are the
    desktop's own weather-* theme icons.
*/
import QtQuick
import org.kde.kirigami as Kirigami

Item {
    id: widgetLayer

    property var spec: ({})
    // The pattern's base colour — picks light vs dark text.
    property color background: "#000000"

    readonly property var clockCfg: (spec.clock && typeof spec.clock === "object") ? spec.clock : ({})
    readonly property var widgetsCfg: (spec.widgets && typeof spec.widgets === "object") ? spec.widgets : ({})
    function cfgOf(name) {
        var w = widgetsCfg[name];
        return (w && typeof w === "object") ? w : ({});
    }
    readonly property var weatherCfg: cfgOf("weather")
    readonly property var calendarCfg: cfgOf("calendar")
    readonly property var countdownCfg: cfgOf("countdown")
    readonly property var noteCfg: cfgOf("note")

    readonly property bool glass: widgetsCfg.style === "glass"
    readonly property real unit: Math.min(width, height) / 100
    // Dark text on light base colours, light text otherwise — the same rule
    // (sRGB luminance > 0.6) as the webview layer.
    readonly property bool onLight: {
        var k = Qt.color(background);
        return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b > 0.6;
    }
    readonly property color ink: onLight ? "#1a1a1f" : "#ffffff"
    readonly property color inkInverse: onLight ? "#ffffff" : "#1a1a1f"
    readonly property color inkShadow: onLight ? "#40ffffff" : "#80000000"
    readonly property int textStyle: glass ? Text.Normal : Text.Raised

    readonly property bool anyVisible: clockCfg.enabled === true || weatherCfg.enabled === true
        || calendarCfg.enabled === true || countdownCfg.enabled === true || noteCfg.enabled === true

    property date now: new Date()
    Timer {
        interval: 1000
        repeat: true
        running: widgetLayer.anyVisible
        triggeredOnStart: true
        onTriggered: widgetLayer.now = new Date()
    }

    // One placed widget: pins its anchor corner at (x%, y%), sizes off
    // `size`, and draws the glass card behind its content when asked.
    component Frame: Item {
        id: frame
        // Inline components don't see this file's ids, so the layer comes in
        // as a property.
        required property Item host
        property var cfg: ({})
        property real defaultSize: 6
        property string defaultPosition: "top-left"
        property real padFactor: 0.4
        default property alias content: inner.data

        readonly property string position: (typeof cfg.position === "string") ? cfg.position : defaultPosition
        readonly property bool atLeft: position.indexOf("left") >= 0
        readonly property bool atRight: position.indexOf("right") >= 0
        readonly property bool atTop: position.indexOf("top") >= 0
        readonly property bool atBottom: position.indexOf("bottom") >= 0
        readonly property bool centered: !atLeft && !atRight
        readonly property real ax: (typeof cfg.x === "number") ? cfg.x : (atLeft ? 4 : (atRight ? 96 : 50))
        readonly property real ay: (typeof cfg.y === "number") ? cfg.y : (atTop ? 4 : (atBottom ? 96 : 50))
        // Headline text height in px; the "em" of everything inside.
        readonly property real px: frame.host.unit * ((typeof cfg.size === "number") ? cfg.size : defaultSize)
        readonly property real pad: frame.host.glass ? px * padFactor : 0
        readonly property int hAlign: atRight ? Text.AlignRight : (atLeft ? Text.AlignLeft : Text.AlignHCenter)

        visible: cfg.enabled === true
        width: inner.childrenRect.width + 2 * pad
        height: inner.childrenRect.height + 2 * pad
        x: frame.host.width * ax / 100 - (atRight ? width : (atLeft ? 0 : width / 2))
        y: frame.host.height * ay / 100 - (atBottom ? height : (atTop ? 0 : height / 2))

        Rectangle {
            anchors.fill: parent
            visible: frame.host.glass
            radius: Math.min(frame.pad * 1.2, height / 2)
            color: frame.host.onLight ? "#61ffffff" : "#57141420"
            border.width: 1
            border.color: frame.host.onLight ? "#a6ffffff" : "#33ffffff"
        }
        Item {
            id: inner
            x: frame.pad
            y: frame.pad
            width: childrenRect.width
            height: childrenRect.height
        }
    }

    // A line of widget text, aligned to the frame's anchored side.
    component Line: Text {
        required property Item frame
        color: frame.host.ink
        style: frame.host.textStyle
        styleColor: frame.host.inkShadow
        anchors.right: frame && frame.atRight ? parent.right : undefined
        anchors.horizontalCenter: frame && frame.centered ? parent.horizontalCenter : undefined
    }

    // --- Clock --------------------------------------------------------
    Frame {
        id: clockFrame
        host: widgetLayer
        cfg: widgetLayer.clockCfg
        defaultSize: 9
        defaultPosition: "top-right"
        padFactor: 0.32
        readonly property string timeFormat: (cfg.hour12 === true ? "h:mm" : "HH:mm")
            + (cfg.showSeconds === true ? ":ss" : "")
            + (cfg.hour12 === true ? " AP" : "")

        Column {
            spacing: clockFrame.px * 0.12
            Line {
                frame: clockFrame
                text: Qt.formatTime(widgetLayer.now, clockFrame.timeFormat)
                font.pixelSize: clockFrame.px
                font.weight: Font.DemiBold
                font.letterSpacing: -clockFrame.px * 0.02
            }
            Line {
                frame: clockFrame
                visible: clockFrame.cfg.showDate !== false
                text: Qt.formatDate(widgetLayer.now, "dddd, d MMMM")
                font.pixelSize: clockFrame.px * 0.3
                font.weight: Font.Medium
                opacity: 0.85
            }
        }
    }

    // --- Weather ------------------------------------------------------
    Frame {
        id: weatherFrame
        host: widgetLayer
        cfg: widgetLayer.weatherCfg
        defaultSize: 6
        readonly property string place: (typeof cfg.location === "string") ? cfg.location.split(",")[0].trim() : ""
        readonly property bool hasLocation: place.length > 0
        readonly property bool fahrenheit: cfg.unit === "fahrenheit"
        readonly property string url: !hasLocation ? "" :
            "https://api.open-meteo.com/v1/forecast?latitude=" + Number(cfg.latitude || 0).toFixed(4)
            + "&longitude=" + Number(cfg.longitude || 0).toFixed(4)
            + "&current=temperature_2m,apparent_temperature,weather_code,is_day"
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4"
            + (fahrenheit ? "&temperature_unit=fahrenheit" : "")
        property var forecast: null
        property bool failed: false

        function refresh() {
            if (!visible || url === "")
                return;
            var xhr = new XMLHttpRequest();
            var asked = url;
            xhr.onreadystatechange = function() {
                if (xhr.readyState !== XMLHttpRequest.DONE || asked !== weatherFrame.url)
                    return;
                try {
                    var j = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && j.current && typeof j.current.temperature_2m === "number") {
                        weatherFrame.forecast = j;
                        weatherFrame.failed = false;
                        return;
                    }
                } catch (e) {}
                // Keep the last good reading through a failed refresh.
                weatherFrame.failed = true;
            };
            xhr.open("GET", asked);
            xhr.send();
        }
        onUrlChanged: { forecast = null; failed = false; refresh(); }
        onVisibleChanged: refresh()
        Timer {
            interval: 15 * 60 * 1000
            repeat: true
            running: weatherFrame.visible && weatherFrame.hasLocation
            onTriggered: weatherFrame.refresh()
        }
        Component.onCompleted: refresh()

        function temp(t) { return (Math.round(t) || 0) + "°"; }
        function kind(code, isDay) {
            if (code === 0 || code === 1) return isDay ? "weather-clear" : "weather-clear-night";
            if (code === 2) return isDay ? "weather-few-clouds" : "weather-few-clouds-night";
            if (code === 45 || code === 48) return "weather-fog";
            if (code >= 51 && code <= 57) return "weather-showers-scattered";
            if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "weather-showers";
            if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "weather-snow";
            if (code >= 95) return "weather-storm";
            return "weather-overcast";
        }
        function label(code) {
            if (code === 0) return "Clear";
            if (code === 1) return "Mostly clear";
            if (code === 2) return "Partly cloudy";
            if (code === 3) return "Overcast";
            if (code === 45 || code === 48) return "Fog";
            if (code >= 51 && code <= 55) return "Drizzle";
            if (code === 56 || code === 57) return "Freezing drizzle";
            if (code >= 61 && code <= 65) return "Rain";
            if (code === 66 || code === 67) return "Freezing rain";
            if (code >= 71 && code <= 75) return "Snow";
            if (code === 77) return "Snow grains";
            if (code >= 80 && code <= 82) return "Showers";
            if (code === 85 || code === 86) return "Snow showers";
            if (code === 95) return "Thunderstorm";
            if (code >= 96) return "Thunderstorm, hail";
            return "Cloudy";
        }
        readonly property var cur: forecast ? forecast.current : null
        readonly property var daily: (forecast && forecast.daily && forecast.daily.time instanceof Array) ? forecast.daily : null

        Column {
            spacing: weatherFrame.px * 0.1

            Line {
                frame: weatherFrame
                visible: !weatherFrame.cur
                text: !weatherFrame.hasLocation ? "Set a location for the weather"
                    : (weatherFrame.failed ? "Weather unavailable · " + weatherFrame.place : weatherFrame.place)
                font.pixelSize: weatherFrame.px * 0.3
                font.weight: Font.Medium
                opacity: 0.85
            }
            Row {
                visible: !!weatherFrame.cur
                spacing: weatherFrame.px * 0.18
                anchors.right: weatherFrame.atRight ? parent.right : undefined
                anchors.horizontalCenter: weatherFrame.centered ? parent.horizontalCenter : undefined
                Kirigami.Icon {
                    anchors.verticalCenter: parent.verticalCenter
                    width: weatherFrame.px * 0.95
                    height: width
                    source: weatherFrame.cur ? weatherFrame.kind(weatherFrame.cur.weather_code, weatherFrame.cur.is_day !== 0) : ""
                }
                Text {
                    text: weatherFrame.cur ? weatherFrame.temp(weatherFrame.cur.temperature_2m) : ""
                    font.pixelSize: weatherFrame.px
                    font.weight: Font.DemiBold
                    font.letterSpacing: -weatherFrame.px * 0.02
                    color: widgetLayer.ink
                    style: widgetLayer.textStyle
                    styleColor: widgetLayer.inkShadow
                }
            }
            Line {
                frame: weatherFrame
                visible: !!weatherFrame.cur
                text: weatherFrame.cur ? weatherFrame.label(weatherFrame.cur.weather_code) + " · " + weatherFrame.place : ""
                font.pixelSize: weatherFrame.px * 0.27
                font.weight: Font.Medium
            }
            Line {
                frame: weatherFrame
                visible: !!weatherFrame.cur && !!weatherFrame.daily
                text: (weatherFrame.cur && weatherFrame.daily)
                    ? "H " + weatherFrame.temp(weatherFrame.daily.temperature_2m_max[0])
                      + " L " + weatherFrame.temp(weatherFrame.daily.temperature_2m_min[0])
                      + " · Feels " + weatherFrame.temp(weatherFrame.cur.apparent_temperature)
                    : ""
                font.pixelSize: weatherFrame.px * 0.22
                opacity: 0.8
            }
            Row {
                visible: !!weatherFrame.cur && !!weatherFrame.daily && weatherFrame.cfg.showForecast !== false
                topPadding: weatherFrame.px * 0.12
                spacing: weatherFrame.px * 0.4
                anchors.right: weatherFrame.atRight ? parent.right : undefined
                anchors.horizontalCenter: weatherFrame.centered ? parent.horizontalCenter : undefined
                Repeater {
                    model: weatherFrame.daily ? Math.min(3, weatherFrame.daily.time.length - 1) : 0
                    delegate: Column {
                        required property int index
                        readonly property int i: index + 1
                        spacing: weatherFrame.px * 0.06
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: Qt.formatDate(new Date(weatherFrame.daily.time[parent.i] + "T12:00:00"), "ddd")
                            font.pixelSize: weatherFrame.px * 0.22
                            color: widgetLayer.ink
                            opacity: 0.8
                            style: widgetLayer.textStyle
                            styleColor: widgetLayer.inkShadow
                        }
                        Kirigami.Icon {
                            anchors.horizontalCenter: parent.horizontalCenter
                            width: weatherFrame.px * 0.45
                            height: width
                            source: weatherFrame.kind(weatherFrame.daily.weather_code[parent.i], true)
                        }
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: weatherFrame.temp(weatherFrame.daily.temperature_2m_max[parent.i])
                                + " " + weatherFrame.temp(weatherFrame.daily.temperature_2m_min[parent.i])
                            font.pixelSize: weatherFrame.px * 0.22
                            font.weight: Font.Medium
                            color: widgetLayer.ink
                            style: widgetLayer.textStyle
                            styleColor: widgetLayer.inkShadow
                        }
                    }
                }
            }
        }
    }

    // --- Calendar -----------------------------------------------------
    Frame {
        id: calendarFrame
        host: widgetLayer
        cfg: widgetLayer.calendarCfg
        defaultSize: 2
        defaultPosition: "bottom-left"
        padFactor: 0.9
        readonly property bool mondayFirst: cfg.weekStartsMonday !== false
        readonly property int today: widgetLayer.now.getDate()
        // 7 weekday headers, then whole weeks of day numbers (0 = blank).
        readonly property var cells: {
            var y = widgetLayer.now.getFullYear(), m = widgetLayer.now.getMonth();
            var start = mondayFirst ? 1 : 0;
            var out = [];
            for (var i = 0; i < 7; i++) {
                var dow = (start + i) % 7;
                var label = Qt.locale().dayName(dow, Locale.NarrowFormat);
                // The C locale's narrow names are digits; fall back to an initial.
                if (/^[0-9]+$/.test(label))
                    label = Qt.locale().dayName(dow, Locale.ShortFormat).charAt(0);
                out.push({ t: label, head: true, day: 0 });
            }
            var lead = (new Date(y, m, 1).getDay() - start + 7) % 7;
            var days = new Date(y, m + 1, 0).getDate();
            for (var b = 0; b < lead; b++) out.push({ t: "", head: false, day: 0 });
            for (var d = 1; d <= days; d++) out.push({ t: String(d), head: false, day: d });
            while ((out.length - 7) % 7 !== 0) out.push({ t: "", head: false, day: 0 });
            return out;
        }

        Column {
            spacing: calendarFrame.px * 0.5
            Line {
                frame: calendarFrame
                text: Qt.formatDate(widgetLayer.now, "MMMM yyyy")
                font.pixelSize: calendarFrame.px * 1.1
                font.weight: Font.DemiBold
            }
            Grid {
                columns: 7
                Repeater {
                    model: calendarFrame.cells
                    delegate: Item {
                        required property var modelData
                        readonly property bool isToday: modelData.day === calendarFrame.today
                        width: calendarFrame.px * 1.9
                        height: calendarFrame.px * 1.75
                        Rectangle {
                            visible: parent.isToday
                            anchors.centerIn: parent
                            width: calendarFrame.px * 1.6
                            height: width
                            radius: width / 2
                            color: widgetLayer.ink
                        }
                        Text {
                            anchors.centerIn: parent
                            text: modelData.t
                            font.pixelSize: modelData.head ? calendarFrame.px * 0.75 : calendarFrame.px
                            font.weight: (modelData.head || parent.isToday) ? Font.DemiBold : Font.Normal
                            opacity: modelData.head ? 0.7 : 1
                            color: parent.isToday ? widgetLayer.inkInverse : widgetLayer.ink
                            style: parent.isToday ? Text.Normal : widgetLayer.textStyle
                            styleColor: widgetLayer.inkShadow
                        }
                    }
                }
            }
        }
    }

    // --- Countdown ----------------------------------------------------
    Frame {
        id: countdownFrame
        host: widgetLayer
        cfg: widgetLayer.countdownCfg
        defaultSize: 6
        defaultPosition: "center"
        readonly property string name: (typeof cfg.label === "string") ? cfg.label.trim() : ""
        // Whole local calendar days to the date (negative once past), or NaN.
        readonly property real days: {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof cfg.date === "string" ? cfg.date : "");
            if (!m) return NaN;
            var target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
            var n = widgetLayer.now;
            return Math.round((target - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
        }
        readonly property int count: Math.abs(days)
        readonly property string unitText: isNaN(days) || days === 0 ? "" : (count === 1 ? " day" : " days")

        Column {
            spacing: countdownFrame.px * 0.12
            Row {
                anchors.right: countdownFrame.atRight ? parent.right : undefined
                anchors.horizontalCenter: countdownFrame.centered ? parent.horizontalCenter : undefined
                Text {
                    id: countValue
                    text: isNaN(countdownFrame.days) ? "–" : (countdownFrame.days === 0 ? "Today" : String(countdownFrame.count))
                    font.pixelSize: countdownFrame.px
                    font.weight: Font.DemiBold
                    color: widgetLayer.ink
                    style: widgetLayer.textStyle
                    styleColor: widgetLayer.inkShadow
                }
                Text {
                    visible: countdownFrame.unitText.length > 0
                    anchors.baseline: countValue.baseline
                    text: countdownFrame.unitText
                    font.pixelSize: countdownFrame.px * 0.4
                    font.weight: Font.Medium
                    color: widgetLayer.ink
                    style: widgetLayer.textStyle
                    styleColor: widgetLayer.inkShadow
                }
            }
            Line {
                frame: countdownFrame
                readonly property string caption: isNaN(countdownFrame.days) ? "Pick a date"
                    : countdownFrame.days === 0 ? countdownFrame.name
                    : countdownFrame.days > 0 ? (countdownFrame.name ? "until " + countdownFrame.name : "to go")
                    : (countdownFrame.name ? "since " + countdownFrame.name : "ago")
                visible: caption.length > 0
                text: caption
                font.pixelSize: countdownFrame.px * 0.3
                font.weight: Font.Medium
                opacity: 0.85
            }
        }
    }

    // --- Note ---------------------------------------------------------
    Frame {
        id: noteFrame
        host: widgetLayer
        readonly property string body: (typeof widgetLayer.noteCfg.text === "string") ? widgetLayer.noteCfg.text.trim() : ""
        // An empty note has nothing to show.
        cfg: body.length > 0 ? widgetLayer.noteCfg : ({})
        defaultSize: 2.5
        defaultPosition: "bottom-right"
        padFactor: 0.6

        Column {
            Line {
                frame: noteFrame
                text: noteFrame.body
                textFormat: Text.PlainText
                horizontalAlignment: noteFrame.hAlign
                wrapMode: Text.Wrap
                width: Math.min(implicitWidth, noteFrame.px * 24)
                font.pixelSize: noteFrame.px
                font.weight: Font.Medium
                lineHeight: 1.25
            }
        }
    }
}
