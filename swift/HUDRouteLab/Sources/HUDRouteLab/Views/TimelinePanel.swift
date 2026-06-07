import AppKit
import SwiftUI

struct TimelinePanel: View {
    @Bindable var model: RouteLabModel
    @State private var isExpanded = true

    private var spanSeconds: Double { model.timelineHours * 3600 }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    withAnimation(.snappy) { isExpanded.toggle() }
                } label: {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .frame(width: 16, height: 16)
                }
                .buttonStyle(.plain)
                .help(isExpanded ? "收起时间轴" : "展开时间轴")

                VStack(alignment: .leading, spacing: 1) {
                    Text("时间轴")
                        .font(.headline)
                    Text(model.cursorTime.formatted(date: .omitted, time: .standard))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if model.importedTrack != nil {
                    Image(systemName: "location.fill")
                        .foregroundStyle(.blue)
                        .help("正在预览导入轨迹的位置")
                }

                Spacer()

                transportControls

                Spacer()

                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(clock(model.timelineStartSeconds)) – \(clock(model.timelineEndSeconds))")
                        .font(.caption.monospacedDigit())
                    Text("可见跨度 \(durationLabel(spanSeconds))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Button {
                    model.revealCursor()
                } label: {
                    Image(systemName: "scope")
                        .frame(width: 16, height: 16)
                }
                .help("定位当前时间")
            }
            .padding(.horizontal, 12)
            .frame(height: 48)

            if isExpanded {
                Divider()

                timelineTrack
                    .frame(height: 78)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                .padding(.bottom, 8)
            }
        }
        .background(.regularMaterial)
    }

    private var transportControls: some View {
        HStack(spacing: 8) {
            ControlGroup {
                Button {
                    model.shuttleReverse()
                } label: {
                    Image(systemName: "backward.fill")
                        .frame(width: 22)
                }
                .accessibilityLabel("倒放")
                .help("J：倒放；重复按 J 切换 1× / 2× / 4×")

                Button {
                    model.togglePlayback()
                } label: {
                    Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                        .frame(width: 22)
                }
                .accessibilityLabel(model.isPlaying ? "暂停" : "播放")
                .help("空格或 K：播放 / 暂停")

                Button {
                    model.shuttleForward()
                } label: {
                    Image(systemName: "forward.fill")
                        .frame(width: 22)
                }
                .accessibilityLabel("正放")
                .help("L：正放；重复按 L 切换 1× / 2× / 4×")
            }
            .controlSize(.small)
            .fixedSize()

            Text(playbackStatus)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(playbackStatusColor)
                .frame(width: 38)
                .padding(.vertical, 3)
                .background(.quaternary, in: Capsule())
                .accessibilityLabel("播放速度 \(playbackStatus)")
        }
    }

    private var playbackStatus: String {
        guard model.isPlaying else { return "暂停" }
        return "\(model.playbackRate < 0 ? "−" : "")\(Int(abs(model.playbackRate)))×"
    }

    private var playbackStatusColor: Color {
        guard model.isPlaying else { return .secondary }
        return model.playbackRate < 0 ? .orange : .accentColor
    }

    private var timelineTrack: some View {
        GeometryReader { geometry in
            let width = max(1, geometry.size.width)
            let ordered = model.orderedMarks

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(.quaternary.opacity(0.45))
                    .overlay {
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(.separator.opacity(0.7), lineWidth: 1)
                    }

                ForEach(minorTicks, id: \.self) { seconds in
                    let x = xPosition(seconds, width: width)
                    Rectangle()
                        .fill(.separator.opacity(0.32))
                        .frame(width: 1, height: 24)
                        .offset(x: x, y: 30)
                }

                ForEach(majorTicks, id: \.self) { seconds in
                    let x = xPosition(seconds, width: width)
                    Rectangle()
                        .fill(.primary.opacity(0.55))
                        .frame(width: 1, height: 50)
                        .offset(x: x, y: 18)
                    Text(tickLabel(seconds))
                        .font(.caption.monospacedDigit().weight(.medium))
                        .foregroundStyle(.primary.opacity(0.82))
                        .padding(.horizontal, 3)
                        .background(.regularMaterial.opacity(0.75), in: RoundedRectangle(cornerRadius: 3))
                        .offset(x: min(max(2, x - 30), width - 64), y: 2)
                }

                let cursorX = xPosition(model.cursorSeconds, width: width)
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 2, height: 50)
                    .offset(x: cursorX, y: 12)

                if let range = model.importedTimelineRange,
                   range.upperBound >= model.timelineStartSeconds,
                   range.lowerBound <= model.timelineStartSeconds + spanSeconds {
                    let startX = xPosition(range.lowerBound, width: width)
                    let endX = xPosition(range.upperBound, width: width)
                    Capsule()
                        .fill(Color.blue.opacity(0.72))
                        .frame(width: max(3, endX - startX), height: 7)
                        .offset(x: startX, y: 48)
                    if range.contains(model.cursorSeconds) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 9, height: 9)
                            .offset(x: cursorX - 4.5, y: 47)
                    }
                }

                if let range = model.videoTimelineRange,
                   range.upperBound >= model.timelineStartSeconds,
                   range.lowerBound <= model.timelineStartSeconds + spanSeconds {
                    let startX = xPosition(range.lowerBound, width: width)
                    let endX = xPosition(range.upperBound, width: width)
                    Capsule()
                        .fill(Color.purple.opacity(0.78))
                        .frame(width: max(3, endX - startX), height: 8)
                        .overlay(alignment: .leading) {
                            Text("VIDEO")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.leading, 5)
                        }
                        .offset(x: startX, y: 61)
                }

                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, mark in
                    if isVisible(model.secondsForMark(mark.id)) {
                        let x = xPosition(model.secondsForMark(mark.id), width: width)
                        VStack(spacing: 1) {
                            Text("T\(index + 1)")
                                .font(.caption2.bold())
                            Circle()
                                .fill(model.selectedMarkID == mark.id ? Color.green : Color.orange)
                                .frame(width: 10, height: 10)
                        }
                        .offset(x: x - 10, y: 30)
                        .highPriorityGesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    model.updateMarkTime(
                                        mark.id,
                                        seconds: seconds(at: value.location.x, width: width),
                                        rebuild: false
                                    )
                                }
                                .onEnded { _ in model.rebuildCurrentRoute() }
                        )
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                model.scrubTimeline(to: seconds(at: value.location.x, width: width))
            })
            .background {
                TimelineScrollObserver { deltaFraction, zoomFactor, anchorFraction in
                    if let zoomFactor {
                        model.zoomTimeline(by: zoomFactor, anchorFraction: anchorFraction)
                    } else {
                        model.panTimeline(byVisibleFraction: deltaFraction)
                    }
                }
            }
        }
    }

    private var majorTickInterval: Double {
        let target = spanSeconds / 8
        return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800, 3_600, 7_200, 10_800, 21_600]
            .first(where: { $0 >= target }) ?? 43_200
    }

    private var majorTicks: [Double] {
        tickValues(interval: majorTickInterval)
    }

    private var minorTicks: [Double] {
        let majorSet = Set(majorTicks)
        return tickValues(interval: majorTickInterval / 4).filter { !majorSet.contains($0) }
    }

    private func tickValues(interval: Double) -> [Double] {
        guard interval > 0 else { return [] }
        let first = ceil(model.timelineStartSeconds / interval) * interval
        var values: [Double] = []
        var value = first
        while value <= model.timelineEndSeconds {
            values.append(value)
            value += interval
        }
        return values
    }

    private func isVisible(_ seconds: Double) -> Bool {
        seconds >= model.timelineStartSeconds && seconds <= model.timelineStartSeconds + spanSeconds
    }

    private func xPosition(_ seconds: Double, width: Double) -> Double {
        min(width, max(0, (seconds - model.timelineStartSeconds) / spanSeconds * width))
    }

    private func seconds(at x: Double, width: Double) -> Double {
        min(86_399, max(0, model.timelineStartSeconds + min(1, max(0, x / width)) * spanSeconds))
    }

    private func clock(_ seconds: Double, includeSeconds: Bool = true) -> String {
        let value = max(0, min(86_399, Int(seconds.rounded())))
        let hour = value / 3600
        let minute = value % 3600 / 60
        let second = value % 60
        return includeSeconds
            ? String(format: "%02d:%02d:%02d", hour, minute, second)
            : String(format: "%02d:%02d", hour, minute)
    }

    private func tickLabel(_ seconds: Double) -> String {
        clock(seconds, includeSeconds: majorTickInterval < 60)
    }

    private func durationLabel(_ seconds: Double) -> String {
        if seconds >= 3_600 {
            return String(format: seconds >= 36_000 ? "%.0f 小时" : "%.1f 小时", seconds / 3_600)
        }
        if seconds >= 60 {
            return String(format: seconds >= 600 ? "%.0f 分钟" : "%.1f 分钟", seconds / 60)
        }
        return String(format: "%.0f 秒", seconds)
    }
}

private struct TimelineScrollObserver: NSViewRepresentable {
    var onScroll: (_ deltaFraction: Double, _ zoomFactor: Double?, _ anchorFraction: Double) -> Void

    func makeNSView(context: Context) -> TimelineScrollNSView {
        let view = TimelineScrollNSView()
        view.onScroll = onScroll
        return view
    }

    func updateNSView(_ view: TimelineScrollNSView, context: Context) {
        view.onScroll = onScroll
    }
}

private final class TimelineScrollNSView: NSView {
    var onScroll: ((_ deltaFraction: Double, _ zoomFactor: Double?, _ anchorFraction: Double) -> Void)?
    private var eventMonitor: Any?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            removeEventMonitor()
        } else if eventMonitor == nil {
            eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                guard let self, event.window === self.window else { return event }
                let location = self.convert(event.locationInWindow, from: nil)
                guard self.bounds.contains(location) else { return event }
                self.handleScroll(event, location: location)
                return nil
            }
        }
    }

    private func removeEventMonitor() {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
    }

    private func handleScroll(_ event: NSEvent, location: CGPoint) {
        let anchor = bounds.width > 0 ? min(1, max(0, location.x / bounds.width)) : 0.5
        if event.modifierFlags.contains(.option) {
            let delta = abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX)
                ? event.scrollingDeltaY
                : event.scrollingDeltaX
            onScroll?(0, exp(-delta * 0.025), anchor)
        } else {
            let delta = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY)
                ? event.scrollingDeltaX
                : event.scrollingDeltaY
            let divisor = event.hasPreciseScrollingDeltas ? max(1, bounds.width) : 25
            onScroll?(-delta / divisor, nil, anchor)
        }
    }
}
